//! Exact filesystem access to the bundled font used by OCR PDF saves.

use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_plugin_fs::FsExt;

fn bundled_ocr_font(resources: &Path) -> PathBuf {
    resources.join("fonts").join("NotoSansTC-Regular.ttf")
}

#[tauri::command]
pub fn allow_ocr_font_scope(app: tauri::AppHandle) -> Result<String, String> {
    // The renderer supplies no path. The resource resolver is the same one
    // used by bundled frames, but this grant covers a single file.
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let font = bundled_ocr_font(&resources);
    app.fs_scope()
        .allow_file(&font)
        .map_err(|e| e.to_string())?;
    Ok(font.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::bundled_ocr_font;
    use std::path::Path;

    #[test]
    fn resolves_only_the_fixed_bundled_font() {
        let resources = Path::new("app-resources");
        assert_eq!(
            bundled_ocr_font(resources),
            resources.join("fonts").join("NotoSansTC-Regular.ttf")
        );
    }
}
