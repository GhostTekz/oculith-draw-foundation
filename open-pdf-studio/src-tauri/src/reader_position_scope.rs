//! Exact filesystem grant for the reader-position sidecar of an authorized PDF.

use std::path::{Component, Path, PathBuf};

use tauri_plugin_fs::FsExt;

fn sidecar_path(pdf: &Path) -> Result<PathBuf, String> {
    if !pdf.is_absolute()
        || pdf.file_name().is_none()
        || !pdf
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
        || pdf
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("reader-position source must be an absolute PDF path".to_string());
    }
    let mut name = pdf.as_os_str().to_os_string();
    name.push(".readerpos.json");
    Ok(PathBuf::from(name))
}

fn checked_sidecar_path(pdf: &Path) -> Result<PathBuf, String> {
    let sidecar = sidecar_path(pdf)?;
    if !pdf.is_file() || dunce::canonicalize(pdf).map_err(|error| error.to_string())? != pdf {
        return Err("reader-position PDF must be a direct, existing file path".to_string());
    }

    // Reject links before granting a path to the renderer. This also rejects a
    // broken link, which `Path::exists` would otherwise mistake for a new file.
    match sidecar.symlink_metadata() {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("reader-position sidecar must not be a symbolic link".to_string());
        }
        Ok(_) => {
            if dunce::canonicalize(&sidecar).map_err(|error| error.to_string())? != sidecar {
                return Err("reader-position sidecar must be a direct file path".to_string());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    Ok(sidecar)
}

#[tauri::command]
pub fn allow_reader_position_scope(
    app: tauri::AppHandle,
    pdf_path: String,
) -> Result<bool, String> {
    let pdf = Path::new(&pdf_path);
    let sidecar = checked_sidecar_path(pdf)?;
    if !app.fs_scope().is_allowed(pdf) {
        return Err("PDF path is outside the authorized filesystem scope".to_string());
    }
    app.fs_scope()
        .allow_file(&sidecar)
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{checked_sidecar_path, sidecar_path};
    use std::path::{Path, PathBuf};

    #[test]
    fn derives_only_one_sibling_path_from_an_absolute_source() {
        #[cfg(unix)]
        {
            assert_eq!(
                sidecar_path(Path::new("/drawings/A.pdf")).unwrap(),
                PathBuf::from("/drawings/A.pdf.readerpos.json")
            );
            for path in ["A.pdf", "/drawings/../secret.pdf", "/drawings/A.txt", "/"] {
                assert!(sidecar_path(Path::new(path)).is_err(), "{path}");
            }
        }
        #[cfg(windows)]
        {
            assert_eq!(
                sidecar_path(Path::new(r"C:\drawings\A.pdf")).unwrap(),
                PathBuf::from(r"C:\drawings\A.pdf.readerpos.json")
            );
            for path in [
                r"A.pdf",
                r"C:\drawings\..\secret.pdf",
                r"C:\drawings\A.txt",
                r"C:\",
            ] {
                assert!(sidecar_path(Path::new(path)).is_err(), "{path}");
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_linked_pdf_and_sidecar_paths() {
        use std::os::unix::fs::symlink;
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "ocudraw-reader-scope-{}-{nonce}",
            std::process::id()
        ));
        let drawings = root.join("drawings");
        std::fs::create_dir_all(&drawings).unwrap();
        let pdf = drawings.join("A.pdf");
        std::fs::write(&pdf, b"%PDF-1.7\n").unwrap();
        let sidecar = sidecar_path(&pdf).unwrap();
        assert_eq!(checked_sidecar_path(&pdf).unwrap(), sidecar);

        let pdf_link = drawings.join("alias.pdf");
        symlink(&pdf, &pdf_link).unwrap();
        assert!(checked_sidecar_path(&pdf_link).is_err());
        let linked_dir = root.join("alias-dir");
        symlink(&drawings, &linked_dir).unwrap();
        assert!(checked_sidecar_path(&linked_dir.join("A.pdf")).is_err());

        let outside = root.join("outside.json");
        std::fs::write(&outside, b"private").unwrap();
        symlink(&outside, &sidecar).unwrap();
        assert!(checked_sidecar_path(&pdf).is_err());
        std::fs::remove_file(&sidecar).unwrap();
        symlink(root.join("missing.json"), &sidecar).unwrap();
        assert!(checked_sidecar_path(&pdf).is_err());
        std::fs::remove_file(&sidecar).unwrap();
        std::fs::write(&sidecar, b"{}").unwrap();
        assert_eq!(checked_sidecar_path(&pdf).unwrap(), sidecar);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
