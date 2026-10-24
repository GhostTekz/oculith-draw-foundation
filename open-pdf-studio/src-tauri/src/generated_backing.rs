//! Exact filesystem grants for app-generated PDF backing files.
//!
//! The renderer does not choose the path. Native code reserves an empty file
//! under the app cache and grants just that file to the FS plugin. The PDF
//! writer fills it immediately. Untitled documents remove their backing file
//! on Save As or close; snippet previews live in the app's managed cache.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri_plugin_fs::FsExt;

use crate::datamap::{self, TauriMap};

fn reserve_pdf(cache_root: &Path, subdir: &str, prefix: &str) -> Result<PathBuf, String> {
    let dir = cache_root.join(subdir);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    for _ in 0..8 {
        let path = dir.join(format!("{prefix}-{now}-{:016x}.pdf", rand::random::<u64>()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("could not reserve a generated PDF path".to_string())
}

fn reserve_and_grant(app: &tauri::AppHandle, subdir: &str, prefix: &str) -> Result<String, String> {
    let cache = datamap::tauri_map(app, TauriMap::Cache).map_err(|e| e.to_string())?;
    let path = reserve_pdf(&cache, subdir, prefix)?;
    if let Err(e) = app.fs_scope().allow_file(&path) {
        let _ = fs::remove_file(&path);
        return Err(e.to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn create_untitled_pdf_backing(app: tauri::AppHandle) -> Result<String, String> {
    reserve_and_grant(&app, "untitled", "opds-untitled")
}

#[tauri::command]
pub fn create_vector_snippet_backing(app: tauri::AppHandle) -> Result<String, String> {
    reserve_and_grant(&app, "snippets", "opds-snippet")
}

#[cfg(test)]
mod tests {
    use super::reserve_pdf;
    use std::fs;

    #[test]
    fn reserves_distinct_private_files_in_separate_app_cache_directories() {
        let root = std::env::temp_dir().join(format!(
            "ocudraw-untitled-scope-test-{:016x}",
            rand::random::<u64>()
        ));
        let first = reserve_pdf(&root, "untitled", "opds-untitled").unwrap();
        let second = reserve_pdf(&root, "untitled", "opds-untitled").unwrap();
        let snippet = reserve_pdf(&root, "snippets", "opds-snippet").unwrap();
        assert_ne!(first, second);
        for (path, subdir, prefix) in [
            (&first, "untitled", "opds-untitled"),
            (&second, "untitled", "opds-untitled"),
            (&snippet, "snippets", "opds-snippet"),
        ] {
            assert_eq!(path.parent().unwrap(), root.join(subdir));
            assert!(path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(prefix));
            assert_eq!(fs::metadata(path).unwrap().len(), 0);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o077, 0);
                assert_eq!(
                    fs::metadata(path.parent().unwrap())
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o077,
                    0
                );
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
}
