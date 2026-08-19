use std::time::Duration;
use tracing::info;

/// Returns the current resident set size (RSS) in bytes, or None if unavailable.
#[cfg(target_os = "macos")]
fn get_current_rss() -> Option<u64> {
    use std::mem;

    #[repr(C)]
    struct MachTaskBasicInfo {
        virtual_size: u64,
        resident_size: u64,
        resident_size_max: u64,
        user_time: libc::time_value_t,
        system_time: libc::time_value_t,
        policy: i32,
        suspend_count: i32,
    }

    const MACH_TASK_BASIC_INFO: u32 = 20;

    unsafe {
        let mut info: MachTaskBasicInfo = mem::zeroed();
        let mut count = (mem::size_of::<MachTaskBasicInfo>() / mem::size_of::<u32>()) as u32;
        #[allow(deprecated)]
        let task = libc::mach_task_self();
        let kr = libc::task_info(
            task,
            MACH_TASK_BASIC_INFO,
            &mut info as *mut _ as *mut i32,
            &mut count,
        );
        if kr == 0 {
            Some(info.resident_size)
        } else {
            None
        }
    }
}

#[cfg(target_os = "linux")]
fn get_current_rss() -> Option<u64> {
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let rss_pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page_size > 0 {
        Some(rss_pages * page_size as u64)
    } else {
        None
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn get_current_rss() -> Option<u64> {
    None
}

#[cfg(target_os = "linux")]
fn parse_status_kb(value: &str) -> Option<u64> {
    value
        .split_whitespace()
        .next()?
        .parse::<u64>()
        .ok()
        .map(|kb| kb * 1024)
}

/// Reads VmRSS/VmSize/VmData/VmSwap (in bytes) from /proc/self/status.
///
/// VmRSS alone can look flat and healthy while VmSize/VmData/VmSwap grow
/// unbounded, because pages that leak and go cold get pushed to swap and drop
/// out of RSS. Watch all four together, not just RSS.
#[cfg(target_os = "linux")]
fn get_proc_status() -> Option<(u64, u64, u64, u64)> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;

    let mut vm_rss = 0u64;
    let mut vm_size = 0u64;
    let mut vm_data = 0u64;
    let mut vm_swap = 0u64;

    for line in status.lines() {
        if let Some(v) = line.strip_prefix("VmRSS:") {
            vm_rss = parse_status_kb(v).unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("VmSize:") {
            vm_size = parse_status_kb(v).unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("VmData:") {
            vm_data = parse_status_kb(v).unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("VmSwap:") {
            vm_swap = parse_status_kb(v).unwrap_or(0);
        }
    }

    Some((vm_rss, vm_size, vm_data, vm_swap))
}

#[cfg(not(target_os = "linux"))]
fn get_proc_status() -> Option<(u64, u64, u64, u64)> {
    None
}

fn format_bytes(bytes: u64) -> String {
    const MB: u64 = 1024 * 1024;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    }
}

/// Spawns a background task that logs peak memory usage every minute.
/// Samples RSS every 5 seconds and reports the peak over the last minute.
pub fn start_memory_monitor() {
    tokio::spawn(async {
        let mut peak_rss: u64 = 0;
        let mut samples = 0u32;

        let mut interval = tokio::time::interval(Duration::from_secs(5));

        loop {
            interval.tick().await;

            if let Some(rss) = get_current_rss() {
                if rss > peak_rss {
                    peak_rss = rss;
                }
            }

            samples += 1;

            // Log every 12 ticks (60 seconds)
            if samples >= 12 {
                if peak_rss > 0 {
                    info!(
                        peak_rss_bytes = peak_rss,
                        "Peak memory usage (last 60s): {}",
                        format_bytes(peak_rss)
                    );
                }
                if let Some((vm_rss, vm_size, vm_data, vm_swap)) = get_proc_status() {
                    info!(
                        vm_rss_bytes = vm_rss,
                        vm_size_bytes = vm_size,
                        vm_data_bytes = vm_data,
                        vm_swap_bytes = vm_swap,
                        "Memory footprint: VmRSS={} VmSize={} VmData={} VmSwap={}",
                        format_bytes(vm_rss),
                        format_bytes(vm_size),
                        format_bytes(vm_data),
                        format_bytes(vm_swap)
                    );
                }
                peak_rss = 0;
                samples = 0;
            }
        }
    });
}
