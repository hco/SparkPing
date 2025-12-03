use crate::config::Target;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use toml_edit::{DocumentMut, Item, Table, Value};
use uuid::Uuid;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

/// Read the config file and parse it as a TOML document
pub fn read_config_file(path: &Path) -> Result<DocumentMut, Box<dyn std::error::Error>> {
    let content = std::fs::read_to_string(path)?;
    let doc = content.parse::<DocumentMut>()?;
    Ok(doc)
}

/// Write the config file atomically (with fallback for Docker bind mounts)
pub fn write_config_file(
    path: &Path,
    doc: &DocumentMut,
    write_flag: &Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Set write flag before writing
    write_flag.store(true, Ordering::SeqCst);

    let content = doc.to_string();

    // Try atomic rename approach first
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, &content)?;

    // Preserve permissions and owner from original file if it exists
    if path.exists() {
        let metadata = std::fs::metadata(path)?;
        let permissions = metadata.permissions();
        std::fs::set_permissions(&temp_path, permissions)?;

        #[cfg(unix)]
        {
            use std::ffi::CString;
            use std::os::unix::ffi::OsStrExt;
            let path_cstr = CString::new(temp_path.as_os_str().as_bytes())?;
            let uid = metadata.uid();
            let gid = metadata.gid();
            // Ignore chown errors - not critical and may fail in containers
            unsafe { libc::chown(path_cstr.as_ptr(), uid, gid) };
        }
    }

    // Try atomic rename, fall back to direct write if it fails
    // (rename fails on Docker bind mounts with EBUSY)
    match std::fs::rename(&temp_path, path) {
        Ok(()) => {}
        Err(e) => {
            // Clean up temp file
            let _ = std::fs::remove_file(&temp_path);

            // Fall back to direct write (works with Docker bind mounts)
            std::fs::write(path, &content)?;

            // Log that we used fallback (but don't fail)
            tracing::debug!(
                "Used direct write fallback for config file (rename failed: {})",
                e
            );
        }
    }

    // Clear write flag after writing
    write_flag.store(false, Ordering::SeqCst);

    Ok(())
}

/// Generate a new unique ID for a target
fn generate_target_id() -> String {
    Uuid::new_v4().to_string()
}

/// Ensure the targets array exists in the document, creating it if necessary
fn ensure_targets_array(doc: &mut DocumentMut) {
    if doc.get("targets").is_none() {
        doc["targets"] = Item::ArrayOfTables(toml_edit::ArrayOfTables::new());
    }
}

/// Add a target to the config document
pub fn add_target(
    doc: &mut DocumentMut,
    target: &Target,
) -> Result<String, Box<dyn std::error::Error>> {
    // Ensure targets array exists
    ensure_targets_array(doc);

    let targets_array = doc
        .get_mut("targets")
        .and_then(|item| item.as_array_of_tables_mut())
        .ok_or("targets array not found or invalid")?;

    // Generate ID if not provided
    let id = if target.id.is_empty() {
        generate_target_id()
    } else {
        target.id.clone()
    };

    // Create new target table
    let mut target_table = Table::new();
    target_table["id"] = Item::Value(Value::String(toml_edit::Formatted::new(id.clone())));
    target_table["address"] = Item::Value(Value::String(toml_edit::Formatted::new(
        target.address.clone(),
    )));

    if let Some(ref name) = target.name {
        target_table["name"] = Item::Value(Value::String(toml_edit::Formatted::new(name.clone())));
    }

    if target.ping_count != 3 {
        target_table["ping_count"] = Item::Value(Value::Integer(toml_edit::Formatted::new(
            target.ping_count as i64,
        )));
    }

    if target.ping_interval != 1 {
        target_table["ping_interval"] = Item::Value(Value::Integer(toml_edit::Formatted::new(
            target.ping_interval as i64,
        )));
    }

    targets_array.push(target_table);

    Ok(id)
}

/// Update a target in the config document by ID
pub fn update_target(
    doc: &mut DocumentMut,
    id: &str,
    target: &Target,
) -> Result<(), Box<dyn std::error::Error>> {
    let targets_array = doc
        .get_mut("targets")
        .and_then(|item| item.as_array_of_tables_mut())
        .ok_or("targets array not found or invalid")?;

    // Find the target by ID
    for target_table in targets_array.iter_mut() {
        if let Some(Item::Value(Value::String(existing_id))) = target_table.get("id") {
            if existing_id.value() == id {
                // Update fields
                target_table["id"] =
                    Item::Value(Value::String(toml_edit::Formatted::new(target.id.clone())));
                target_table["address"] = Item::Value(Value::String(toml_edit::Formatted::new(
                    target.address.clone(),
                )));

                if let Some(ref name) = target.name {
                    target_table["name"] =
                        Item::Value(Value::String(toml_edit::Formatted::new(name.clone())));
                } else {
                    target_table.remove("name");
                }

                target_table["ping_count"] = Item::Value(Value::Integer(
                    toml_edit::Formatted::new(target.ping_count as i64),
                ));
                target_table["ping_interval"] = Item::Value(Value::Integer(
                    toml_edit::Formatted::new(target.ping_interval as i64),
                ));

                return Ok(());
            }
        }
    }

    Err(format!("Target with id '{}' not found", id).into())
}

/// Remove a target from the config document by ID
pub fn remove_target(doc: &mut DocumentMut, id: &str) -> Result<(), Box<dyn std::error::Error>> {
    let targets_array = doc
        .get_mut("targets")
        .and_then(|item| item.as_array_of_tables_mut())
        .ok_or("targets array not found or invalid")?;

    // Find and remove the target by ID
    let mut index_to_remove = None;
    for (idx, target_table) in targets_array.iter().enumerate() {
        if let Some(Item::Value(Value::String(existing_id))) = target_table.get("id") {
            if existing_id.value() == id {
                index_to_remove = Some(idx);
                break;
            }
        }
    }

    if let Some(idx) = index_to_remove {
        targets_array.remove(idx);
        Ok(())
    } else {
        Err(format!("Target with id '{}' not found", id).into())
    }
}
