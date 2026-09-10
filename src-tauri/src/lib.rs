use serde::Serialize;

/// A file-system entry returned by `read_dir`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEntry {
    path: String,
    name: String,
    is_dir: bool,
}

/// Native "pick a folder" dialog. Returns the chosen folder path, or None.
#[tauri::command]
fn open_folder_dialog() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Open folder")
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Lists the entries of a directory (directories first, then by name).
#[tauri::command]
fn read_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let mut entries: Vec<FsEntry> = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let is_dir = p.is_dir();
        entries.push(FsEntry {
            path: p.to_string_lossy().into_owned(),
            name,
            is_dir,
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// Reads a UTF-8 text file.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Writes text to a file.
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

/// Platform-specific "reveal this folder" implementation.
/// std::process only — no extra crates required.
#[cfg(target_os = "windows")]
fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open {path}: {e}"))
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open {path}: {e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open {path}: {e}"))
}

/// Reveals a folder in the OS file manager (Explorer on Windows).
#[tauri::command]
fn open_in_file_manager(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    reveal_in_file_manager(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            read_dir,
            read_file,
            write_file,
            open_in_file_manager
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
