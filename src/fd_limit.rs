/// Soft and hard RLIMIT_NOFILE values before and after raising.
#[derive(Debug, Clone, Copy)]
pub struct NofileLimits {
    pub previous_soft: u64,
    pub soft: u64,
    pub hard: u64,
}

/// Raise the soft open-files limit to the hard limit.
///
/// Containers commonly start with a soft limit of 1024 while the hard limit is
/// much higher. The storage engine and ping sockets share that budget, so a low
/// soft limit turns into EMFILE on every ping once enough files are open.
/// Must run before anything opens files in bulk (storage, sockets).
pub fn raise_nofile_limit() -> std::io::Result<NofileLimits> {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } != 0 {
        return Err(std::io::Error::last_os_error());
    }

    let previous_soft = limit.rlim_cur;
    let target = max_settable_soft_limit(limit.rlim_max);

    if limit.rlim_cur < target {
        let raised = libc::rlimit {
            rlim_cur: target,
            rlim_max: limit.rlim_max,
        };
        if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &raised) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        limit.rlim_cur = target;
    }

    Ok(NofileLimits {
        previous_soft,
        soft: limit.rlim_cur,
        hard: limit.rlim_max,
    })
}

/// macOS rejects soft limits above OPEN_MAX (10240, `<sys/syslimits.h>`) even
/// when the hard limit is unlimited.
#[cfg(target_os = "macos")]
fn max_settable_soft_limit(hard: libc::rlim_t) -> libc::rlim_t {
    const OPEN_MAX: libc::rlim_t = 10240;
    hard.min(OPEN_MAX)
}

#[cfg(not(target_os = "macos"))]
fn max_settable_soft_limit(hard: libc::rlim_t) -> libc::rlim_t {
    hard
}

/// Current soft open-files limit, or None if it cannot be read.
pub fn current_soft_limit() -> Option<u64> {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } != 0 {
        return None;
    }
    Some(limit.rlim_cur)
}

/// Number of file descriptors currently open by this process.
pub fn open_fd_count() -> Option<usize> {
    #[cfg(target_os = "linux")]
    let dir = "/proc/self/fd";
    #[cfg(not(target_os = "linux"))]
    let dir = "/dev/fd";

    // read_dir itself holds one descriptor while iterating
    std::fs::read_dir(dir)
        .ok()
        .map(|entries| entries.count().saturating_sub(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raising_never_lowers_the_soft_limit() {
        let limits = raise_nofile_limit().expect("raise");
        assert!(limits.soft >= limits.previous_soft);
        assert!(limits.soft <= limits.hard);
    }
}
