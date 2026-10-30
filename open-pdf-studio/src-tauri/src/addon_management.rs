//! Offline, per-user management of independent packages. The editor still
//! chooses and verifies its active package set only when it starts.
use super::{addon_file, atomic_file, datamap, valid_addon_id, valid_addon_version,
    verified_package, AddonManifest, EnabledAddons, HOST_API_VERSION, MAX_ENABLED_PACKAGES};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static STAGE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    id: String,
    version: String,
    enabled: bool,
    valid: bool,
}

struct Lock { path: PathBuf, file: Option<File> }
impl Drop for Lock {
    fn drop(&mut self) { drop(self.file.take()); let _ = fs::remove_file(&self.path); }
}

fn real_directory(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_dir() || meta.file_type().is_symlink() { return Err("Add-on path is not a real directory.".into()); }
    Ok(())
}

fn checked_paths(data: &Path) -> Result<(PathBuf, PathBuf), String> {
    if !data.exists() { fs::create_dir_all(data).map_err(|e| e.to_string())?; }
    real_directory(data)?;
    let addons = data.join("addons");
    if addons.exists() { real_directory(&addons)?; }
    else { fs::create_dir(&addons).map_err(|e| e.to_string())?; }
    let packages = addons.join("packages");
    if packages.exists() { real_directory(&packages)?; }
    else { fs::create_dir(&packages).map_err(|e| e.to_string())?; }
    Ok((addons, packages))
}

fn lock(addons: &Path) -> Result<Lock, String> {
    let path = addons.join(".install.lock");
    let mut file = OpenOptions::new().write(true).create_new(true).open(&path)
        .map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists {
            "Another add-on operation is running. Close the editor and retry after checking the stale lock.".to_string()
        } else { e.to_string() })?;
    writeln!(file, "{}", std::process::id()).map_err(|e| e.to_string())?;
    Ok(Lock { path, file: Some(file) })
}

fn read_index(addons: &Path) -> Result<Vec<String>, String> {
    let path = addons.join("enabled.json");
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 64 * 1024 {
        return Err("Invalid add-on index. Repair it before changing packages.".into());
    }
    let index: EnabledAddons = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid add-on index. Repair it before changing packages.")?;
    let mut seen = HashSet::new();
    if index.schema_version != 1 || index.ids.len() > MAX_ENABLED_PACKAGES
        || index.ids.iter().any(|id| !valid_addon_id(id) || !seen.insert(id)) {
        return Err("Invalid add-on index. Repair it before changing packages.".into());
    }
    Ok(index.ids)
}

fn write_index(addons: &Path, ids: &[String]) -> Result<(), String> {
    if ids.len() > MAX_ENABLED_PACKAGES { return Err("Too many enabled add-ons.".into()); }
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({ "schemaVersion": 1, "ids": ids }))
        .map_err(|e| e.to_string())?;
    atomic_file::write(&addons.join("enabled.json"), &bytes).map_err(|e| e.to_string())
}

fn manifest(root: &Path) -> Result<AddonManifest, String> {
    real_directory(root)?;
    let path = addon_file(root, "manifest.json").ok_or("Invalid add-on manifest.")?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() == 0 || meta.len() > 1024 * 1024 { return Err("Invalid add-on manifest.".into()); }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "Invalid add-on manifest.".into())
}

fn recover_staged(packages: &Path, ids: &[String]) -> Result<(), String> {
    for entry in fs::read_dir(packages).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        if let Some(id) = name.strip_prefix(".previous-") {
            if !valid_addon_id(id) { return Err("Invalid staged add-on replacement.".into()); }
            real_directory(&entry.path())?;
            let target = packages.join(id);
            if target.exists() {
                // The new package reached its destination. Keep the committed
                // version if backup cleanup was interrupted after the index write.
                real_directory(&target)?;
                let _ = fs::remove_dir_all(entry.path()); // An open helper can delay cleanup on Windows.
            } else {
                // The replacement stopped after moving the old package away.
                fs::rename(entry.path(), target).map_err(|e| e.to_string())?;
            }
        } else if let Some(id) = name.strip_prefix(".remove-") {
            if !valid_addon_id(id) { return Err("Invalid staged add-on removal.".into()); }
            real_directory(&entry.path())?;
            if ids.iter().any(|item| item == id) && !packages.join(id).exists() {
                fs::rename(entry.path(), packages.join(id)).map_err(|e| e.to_string())?;
            } else {
                // A helper held open by the editor may make this retry fail on Windows.
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    Ok(())
}

fn with_lock<T>(data: &Path, operation: impl FnOnce(&Path, &Path) -> Result<T, String>) -> Result<T, String> {
    let (addons, packages) = checked_paths(data)?;
    let _lock = lock(&addons)?;
    let ids = read_index(&addons)?;
    recover_staged(&packages, &ids)?;
    operation(&addons, &packages)
}

fn list_at(data: &Path, editor_version: &str) -> Result<Vec<PackageInfo>, String> {
    let (addons, packages) = checked_paths(data)?;
    let ids = read_index(&addons)?;
    let mut rows = Vec::new();
    for entry in fs::read_dir(packages).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(id) = name.to_str() else { continue; };
        if !valid_addon_id(id) { continue; }
        let valid = verified_package(&entry.path(), id, editor_version).is_some();
        let version = manifest(&entry.path()).ok().map(|item| item.version)
            .filter(|version| valid_addon_version(version)).unwrap_or_default();
        rows.push(PackageInfo { id: id.to_string(), version, enabled: ids.iter().any(|item| item == id), valid });
        if rows.len() >= 128 { break; }
    }
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(rows)
}

fn install_at(data: &Path, source: &Path, editor_version: &str) -> Result<String, String> {
    let package = manifest(source)?;
    if !valid_addon_id(&package.id) || package.host_api_version != HOST_API_VERSION
        || verified_package(source, &package.id, editor_version).is_none() {
        return Err("The selected folder is not a compatible, verified add-on package.".into());
    }
    with_lock(data, |addons, packages| {
        let source = dunce::canonicalize(source).map_err(|e| e.to_string())?;
        let installed = dunce::canonicalize(addons).map_err(|e| e.to_string())?;
        if source.starts_with(installed) { return Err("Choose a package outside the app's add-ons directory.".into()); }
        let mut ids = read_index(addons)?;
        if !ids.contains(&package.id) && ids.len() >= MAX_ENABLED_PACKAGES { return Err("Too many enabled add-ons.".into()); }
        let stage = packages.join(format!(".install-stage-{}-{}", std::process::id(), STAGE_ID.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&stage).map_err(|e| e.to_string())?;
        let result = (|| {
            for name in std::iter::once("manifest.json").chain(package.files.keys().map(String::as_str)) {
                let from = addon_file(&source, name).ok_or("Package changed during installation.")?;
                fs::copy(from, stage.join(name)).map_err(|e| e.to_string())?;
            }
            if verified_package(&stage, &package.id, editor_version).is_none() {
                return Err("Package changed during installation.".into());
            }
            let destination = packages.join(&package.id);
            let backup = packages.join(format!(".previous-{}", package.id));
            if backup.exists() { return Err("A previous package replacement needs recovery.".into()); }
            let old = destination.exists();
            if old { real_directory(&destination)?; fs::rename(&destination, &backup).map_err(|e| e.to_string())?; }
            if let Err(error) = fs::rename(&stage, &destination) {
                if old { let _ = fs::rename(&backup, &destination); }
                return Err(error.to_string());
            }
            if !ids.contains(&package.id) { ids.push(package.id.clone()); }
            if let Err(error) = write_index(addons, &ids) {
                let _ = fs::remove_dir_all(&destination);
                if old { let _ = fs::rename(&backup, &destination); }
                return Err(error);
            }
            if old { let _ = fs::remove_dir_all(backup); }
            Ok(package.id.clone())
        })();
        let _ = fs::remove_dir_all(stage);
        result
    })
}

fn set_enabled_at(data: &Path, id: &str, enabled: bool, editor_version: &str) -> Result<(), String> {
    if !valid_addon_id(id) { return Err("Invalid add-on ID.".into()); }
    with_lock(data, |addons, packages| {
        let mut ids = read_index(addons)?;
        if enabled && verified_package(&packages.join(id), id, editor_version).is_none() {
            return Err("This package is missing or incompatible with the editor.".into());
        }
        if enabled {
            if !ids.iter().any(|item| item == id) {
                ids.push(id.to_string());
                write_index(addons, &ids)?;
            }
        } else if ids.iter().any(|item| item == id) {
            ids.retain(|item| item != id);
            write_index(addons, &ids)?;
        }
        Ok(())
    })
}

fn remove_at(data: &Path, id: &str) -> Result<(), String> {
    if !valid_addon_id(id) { return Err("Invalid add-on ID.".into()); }
    with_lock(data, |addons, packages| {
        let target = packages.join(id);
        real_directory(&target)?;
        let staged = packages.join(format!(".remove-{id}"));
        if staged.exists() { return Err("A previous removal is waiting for the editor to close.".into()); }
        fs::rename(&target, &staged).map_err(|e| e.to_string())?;
        let mut ids = read_index(addons)?;
        ids.retain(|item| item != id);
        if let Err(error) = write_index(addons, &ids) {
            let _ = fs::rename(&staged, &target);
            return Err(error);
        }
        let _ = fs::remove_dir_all(staged); // Retried after restart if a helper is still open.
        Ok(())
    })
}

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    datamap::tauri_map(app, datamap::TauriMap::Data).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn addon_packages_list(app: tauri::AppHandle) -> Result<Vec<PackageInfo>, String> {
    list_at(&app_data(&app)?, &app.package_info().version.to_string())
}

#[tauri::command(async)]
pub fn addon_package_install(app: tauri::AppHandle, source: String) -> Result<String, String> {
    install_at(&app_data(&app)?, Path::new(&source), &app.package_info().version.to_string())
}

#[tauri::command(async)]
pub fn addon_package_set_enabled(app: tauri::AppHandle, id: String, enabled: bool) -> Result<(), String> {
    set_enabled_at(&app_data(&app)?, &id, enabled, &app.package_info().version.to_string())
}

#[tauri::command(async)]
pub fn addon_package_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    remove_at(&app_data(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn fixture() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("addon-manager-{}-{}", std::process::id(), STAGE_ID.fetch_add(1, Ordering::Relaxed)));
        let data = root.join("data");
        let source = root.join("source");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir(&source).unwrap();
        let script = b"export function createAddon() { return {}; }";
        fs::write(source.join("plugin.js"), script).unwrap();
        fs::write(source.join("manifest.json"), serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 2, "id": "example.tools", "version": "1.0.0", "hostApiVersion": 1,
            "editorVersion": "2026.68.0", "files": { "plugin.js": format!("{:x}", Sha256::digest(script)) }
        })).unwrap()).unwrap();
        (data, source)
    }

    #[test]
    fn install_toggle_remove_preserves_other_packages_and_refuses_tampering() {
        let (data, source) = fixture();
        let root = data.parent().unwrap();
        assert_eq!(install_at(&data, &source, "2026.68.0").unwrap(), "example.tools");
        assert_eq!(list_at(&data, "2026.68.0").unwrap().len(), 1);
        assert!(list_at(&data, "2026.68.0").unwrap()[0].enabled);
        set_enabled_at(&data, "example.tools", false, "2026.68.0").unwrap();
        assert!(!list_at(&data, "2026.68.0").unwrap()[0].enabled);
        set_enabled_at(&data, "example.tools", true, "2026.68.0").unwrap();
        fs::write(source.join("plugin.js"), b"tampered").unwrap();
        assert!(install_at(&data, &source, "2026.68.0").is_err());
        assert!(list_at(&data, "2026.68.0").unwrap()[0].valid);
        remove_at(&data, "example.tools").unwrap();
        assert!(list_at(&data, "2026.68.0").unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bad_index_and_symlinked_source_cannot_be_installed() {
        let (data, source) = fixture();
        let root = data.parent().unwrap();
        let (addons, _) = checked_paths(&data).unwrap();
        fs::write(addons.join("enabled.json"), b"broken").unwrap();
        assert!(install_at(&data, &source, "2026.68.0").is_err());
        assert!(source.join("plugin.js").is_file());
        fs::remove_file(addons.join("enabled.json")).unwrap();
        #[cfg(unix)] {
            use std::os::unix::fs::symlink;
            fs::remove_file(source.join("plugin.js")).unwrap();
            symlink(root.join("elsewhere.js"), source.join("plugin.js")).unwrap();
            assert!(install_at(&data, &source, "2026.68.0").is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_recovery_keeps_committed_package_and_restores_interrupted_move() {
        let (data, source) = fixture();
        let root = data.parent().unwrap();
        install_at(&data, &source, "2026.68.0").unwrap();
        let (addons, packages) = checked_paths(&data).unwrap();
        let destination = packages.join("example.tools");
        let backup = packages.join(".previous-example.tools");

        fs::rename(&destination, &backup).unwrap();
        recover_staged(&packages, &read_index(&addons).unwrap()).unwrap();
        assert!(destination.join("plugin.js").is_file());
        assert!(!backup.exists());

        fs::rename(&destination, &backup).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("marker"), b"committed new package").unwrap();
        recover_staged(&packages, &read_index(&addons).unwrap()).unwrap();
        assert_eq!(fs::read(destination.join("marker")).unwrap(), b"committed new package");
        assert!(!backup.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn redundant_enable_preserves_package_order() {
        let (data, source) = fixture();
        let root = data.parent().unwrap();
        install_at(&data, &source, "2026.68.0").unwrap();
        let second = root.join("second");
        fs::create_dir(&second).unwrap();
        fs::copy(source.join("plugin.js"), second.join("plugin.js")).unwrap();
        let mut second_manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(source.join("manifest.json")).unwrap()).unwrap();
        second_manifest["id"] = "second.tools".into();
        fs::write(second.join("manifest.json"), serde_json::to_vec(&second_manifest).unwrap()).unwrap();
        install_at(&data, &second, "2026.68.0").unwrap();
        let (addons, _) = checked_paths(&data).unwrap();
        let original = read_index(&addons).unwrap();
        assert_eq!(original, ["example.tools", "second.tools"]);
        set_enabled_at(&data, "example.tools", true, "2026.68.0").unwrap();
        assert_eq!(read_index(&addons).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }
}
