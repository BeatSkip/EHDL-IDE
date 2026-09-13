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

/// Native "pick a file" dialog. Returns the chosen file path, or None.
#[tauri::command]
fn open_file_dialog() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Open file")
        .pick_file()
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

/// Creates a directory (and any missing parents). Succeeds if it already exists.
#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Renames / moves a file or directory.
#[tauri::command]
fn rename_entry(from: String, to: String) -> Result<(), String> {
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Deletes a file, or a directory recursively.
#[tauri::command]
fn delete_entry(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

/// Recursively copies a file or directory (with its contents).
fn copy_recursive(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    if from.is_dir() {
        std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
            let src = entry.path();
            let dst = to.join(entry.file_name());
            copy_recursive(&src, &dst)?;
        }
        Ok(())
    } else {
        std::fs::copy(from, to).map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Recursively copies a file or directory to a new path.
#[tauri::command]
fn copy_entry(from: String, to: String) -> Result<(), String> {
    copy_recursive(std::path::Path::new(&from), std::path::Path::new(&to))
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

/// Opens a URL — or any file — with the OS default application. Used by the
/// Part editor for vendor part links and datasheets.
#[tauri::command]
fn open_external(target: String) -> Result<(), String> {
    reveal_in_file_manager(&target)
}

/// Result of running a Node generator.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationResult {
    ok: bool,
    /// Combined stdout/stderr, shown in the app's build log.
    output: String,
}

/// Folders that may hold the repository (in dev the app runs from src-tauri).
fn candidate_roots() -> Vec<std::path::PathBuf> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(explicit) = std::env::var("EHDL_ROOT") {
        roots.push(std::path::PathBuf::from(explicit));
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            roots.push(parent.to_path_buf());
            if let Some(grand) = parent.parent() {
                roots.push(grand.to_path_buf());
            }
        }
    }
    roots
}

/// Runs a Node generator script — tscircuit cannot run inside the webview.
fn run_generator(script_name: &str, args: &[String]) -> Result<GenerationResult, String> {
    let mut script: Option<std::path::PathBuf> = None;
    let mut root: Option<std::path::PathBuf> = None;
    for candidate in candidate_roots() {
        let path = candidate.join("scripts").join(script_name);
        if path.is_file() {
            script = Some(path);
            root = Some(candidate);
            break;
        }
    }
    let (script, root) = match (script, root) {
        (Some(script), Some(root)) => (script, root),
        _ => {
            return Err(format!(
                "could not find scripts/{script_name} — run from the repository, or set EHDL_ROOT"
            ))
        }
    };

    let output = std::process::Command::new("node")
        .arg(&script)
        .args(args)
        .current_dir(&root)
        .output()
        .map_err(|e| format!("failed to run node (is Node.js installed?): {e}"))?;

    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !stderr.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&stderr);
    }
    Ok(GenerationResult {
        ok: output.status.success(),
        output: text,
    })
}

/// Generate the schematic for a project: VHDL in, tscircuit SVG + netlist out.
#[tauri::command]
fn generate_schematic(
    lib_dir: String,
    top_file: String,
    out_dir: String,
) -> Result<GenerationResult, String> {
    run_generator(
        "generate-schematic.mjs",
        &[
            "--lib".into(),
            lib_dir,
            "--top".into(),
            top_file,
            "--out".into(),
            out_dir,
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            open_file_dialog,
            read_dir,
            read_file,
            write_file,
            create_dir,
            rename_entry,
            delete_entry,
            copy_entry,
            open_in_file_manager,
            open_external,
            generate_schematic
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
