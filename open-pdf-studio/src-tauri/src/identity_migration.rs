//! Copy local editor settings from the earlier desktop profile on first use.
//!
//! The source is retained for older installations. Existing destination files
//! always win, so a later install cannot reset a user's current preferences.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

const OLD_PROFILE: &str = "OpenPDFStudio";
const PROFILE: &str = "OcuDrawCommunity";

fn copy_regular_if_missing(source: &Path, destination: &Path) -> io::Result<()> {
    let metadata = match fs::symlink_metadata(source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !metadata.file_type().is_file() || destination.exists() {
        return Ok(());
    }
    let mut input = File::open(source)?;
    let mut output = match OpenOptions::new().write(true).create_new(true).open(destination) {
        Ok(output) => output,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => return Err(error),
    };
    let result = io::copy(&mut input, &mut output).and_then(|_| output.flush());
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result.map(|_| ())
}

pub fn migrate_profile(base: &Path) -> io::Result<()> {
    let source = base.join(OLD_PROFILE);
    if !fs::symlink_metadata(&source).is_ok_and(|meta| meta.file_type().is_dir()) {
        return Ok(());
    }
    let destination = base.join(PROFILE);
    if fs::symlink_metadata(&destination).is_ok_and(|meta| !meta.file_type().is_dir()) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "destination profile is not a directory"));
    }
    fs::create_dir_all(&destination)?;
    for file in ["preferences.json", "session.json"] {
        copy_regular_if_missing(&source.join(file), &destination.join(file))?;
    }
    let old_catalogs = source.join("catalogs");
    if fs::symlink_metadata(&old_catalogs).is_ok_and(|meta| meta.file_type().is_dir()) {
        let new_catalogs = destination.join("catalogs");
        if fs::symlink_metadata(&new_catalogs).is_ok_and(|meta| !meta.file_type().is_dir()) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "destination catalogs is not a directory"));
        }
        fs::create_dir_all(&new_catalogs)?;
        for entry in fs::read_dir(old_catalogs)? {
            let entry = entry?;
            let name = entry.file_name();
            if Path::new(&name).extension().is_some_and(|ext| ext.eq_ignore_ascii_case("json")) {
                copy_regular_if_missing(&entry.path(), &new_catalogs.join(name))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn migration_keeps_both_profiles_and_never_overwrites() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("oculith-identity-test-{}-{nonce}", std::process::id()));
        let old = base.join(OLD_PROFILE);
        let current = base.join(PROFILE);
        fs::create_dir_all(old.join("catalogs")).unwrap();
        fs::create_dir_all(&current).unwrap();
        fs::write(old.join("preferences.json"), b"old preferences").unwrap();
        fs::write(old.join("session.json"), b"old session").unwrap();
        fs::write(old.join("catalogs").join("saved.json"), b"old catalog").unwrap();
        fs::write(current.join("preferences.json"), b"new preferences").unwrap();

        migrate_profile(&base).unwrap();
        migrate_profile(&base).unwrap();

        assert_eq!(fs::read(current.join("preferences.json")).unwrap(), b"new preferences");
        assert_eq!(fs::read(current.join("session.json")).unwrap(), b"old session");
        assert_eq!(fs::read(current.join("catalogs").join("saved.json")).unwrap(), b"old catalog");
        assert_eq!(fs::read(old.join("preferences.json")).unwrap(), b"old preferences");
        fs::remove_dir_all(base).unwrap();
    }
}
