//! Renderer access to the app-owned drawing frames and title blocks.
//!
//! The renderer chooses only which of the two template collections it needs.
//! Rust resolves both roots so document content cannot nominate an arbitrary
//! path for a filesystem scope grant.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

use crate::datamap::{self, TauriMap};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDirs {
    user_dir: String,
    bundled_dir: String,
}

fn template_subdir(kind: &str) -> Result<&'static str, String> {
    match kind {
        "kaders" => Ok("kaders"),
        "onderhoeken" => Ok("onderhoeken"),
        _ => Err("unknown template collection".to_string()),
    }
}

fn template_paths(
    app_data: &Path,
    resources: &Path,
    kind: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let subdir = template_subdir(kind)?;
    Ok((app_data.join(subdir), resources.join(subdir)))
}

#[tauri::command]
pub fn allow_template_scope(app: tauri::AppHandle, kind: String) -> Result<TemplateDirs, String> {
    // Reject an invalid collection before resolving or granting any path.
    template_subdir(&kind)?;
    let app_data = datamap::tauri_map(&app, TauriMap::Data).map_err(|e| e.to_string())?;
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let (user_dir, bundled_dir) = template_paths(&app_data, &resources, &kind)?;

    // Scans descend into user-created subfolders, so each collection needs a
    // recursive grant. Neither root is supplied by the renderer.
    app.fs_scope()
        .allow_directory(&user_dir, true)
        .map_err(|e| e.to_string())?;
    app.fs_scope()
        .allow_directory(&bundled_dir, true)
        .map_err(|e| e.to_string())?;

    Ok(TemplateDirs {
        user_dir: user_dir.to_string_lossy().into_owned(),
        bundled_dir: bundled_dir.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::template_paths;
    use std::path::Path;

    #[test]
    fn only_known_collections_can_select_native_roots() {
        let data = Path::new("app-data");
        let resources = Path::new("resources");
        for kind in ["kaders", "onderhoeken"] {
            let (user, bundled) = template_paths(data, resources, kind).unwrap();
            assert_eq!(user, data.join(kind));
            assert_eq!(bundled, resources.join(kind));
        }
        for kind in ["../secrets", "/tmp", "kaders/other", "KADERS", ""] {
            assert!(template_paths(data, resources, kind).is_err(), "{kind}");
        }
    }
}
