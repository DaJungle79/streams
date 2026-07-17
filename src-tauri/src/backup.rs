//! Snapshot backups.
//!
//! A snapshot is the **whole store in one file**, timestamped, written one-way
//! and never read back automatically. That shape is deliberate:
//!
//! - **One file** makes it atomic and eviction-proof. iCloud replaces an evicted
//!   file with a hidden `.name.icloud` placeholder and the original vanishes
//!   from the directory listing — which is why the *live* store must never live
//!   there. A backup is cold by definition: you don't need it until you need it,
//!   and then macOS fetches it. The property that makes iCloud a terrible home
//!   for the store makes it a fine home for snapshots.
//! - **Never auto-loaded.** Two Macs each restoring each other's snapshots would
//!   be whole-store last-write-wins — one Mac's snapshot silently erasing a
//!   stream created on the other. That is exactly what SPEC §6's per-file merge
//!   exists to prevent, so restore stays a manual, deliberate act.
//!
//! Backup is not sync. Sync is a folder the store lives in; this is a parachute.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

const PREFIX: &str = "streams-";
const SUFFIX: &str = ".json";

#[derive(Serialize)]
pub struct BackupFile {
    pub filename: String,
    pub bytes: u64,
    /// Seconds since the epoch, so the frontend can format it.
    pub modified: u64,
}

fn err(context: &str, e: impl std::fmt::Display) -> String {
    format!("{context}: {e}")
}

/// Only our own snapshot names. The guard against a caller naming any path.
fn is_snapshot(name: &str) -> bool {
    name.starts_with(PREFIX)
        && name.ends_with(SUFFIX)
        && !name.contains('/')
        && !name.contains("..")
}

/// iCloud Drive, if it's set up on this Mac.
#[tauri::command]
pub fn backup_default_dir<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("no home dir: {e}"))?;
    let icloud = home
        .join("Library/Mobile Documents/com~apple~CloudDocs")
        .join("Streams Backups");

    // Only offer it if iCloud Drive actually exists; creating this folder on a
    // Mac with iCloud off would just make a local dir pretending to be a backup.
    let root = icloud.parent().ok_or("bad path")?;
    if !root.exists() {
        return Ok(None);
    }
    Ok(Some(icloud.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn backup_write(dir: String, filename: String, contents: String) -> Result<(), String> {
    if !is_snapshot(&filename) {
        return Err(format!("not a snapshot name: {filename:?}"));
    }
    let dir = PathBuf::from(&dir);
    fs::create_dir_all(&dir).map_err(|e| err("create backup dir", e))?;

    // Same guarantee as the store: a half-written backup is worse than none,
    // because you'd only find out at restore time.
    let scratch = dir.join(".tmp");
    crate::storage::atomic_write_at(&scratch, &dir.join(&filename), &contents)?;
    let _ = fs::remove_dir(&scratch);
    Ok(())
}

#[tauri::command]
pub fn backup_list(dir: String) -> Result<Vec<BackupFile>, String> {
    let dir = Path::new(&dir);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| err("read backup dir", e))? {
        let entry = entry.map_err(|e| err("read entry", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_snapshot(&name) {
            continue;
        }
        let meta = entry.metadata().map_err(|e| err("stat", e))?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(BackupFile {
            filename: name,
            bytes: meta.len(),
            modified,
        });
    }
    // Newest first. Names are ISO-ish, so lexical order is chronological.
    out.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(out)
}

#[tauri::command]
pub fn backup_read(dir: String, filename: String) -> Result<String, String> {
    if !is_snapshot(&filename) {
        return Err(format!("not a snapshot name: {filename:?}"));
    }
    // Reading an evicted file blocks while macOS downloads it, which is the
    // whole bargain: cold storage is fine for something you rarely read.
    fs::read_to_string(Path::new(&dir).join(&filename)).map_err(|e| err("read backup", e))
}

/// Keep the newest `keep` snapshots; delete the rest.
#[tauri::command]
pub fn backup_prune(dir: String, keep: usize) -> Result<usize, String> {
    let files = backup_list(dir.clone())?;
    let mut removed = 0;
    for f in files.into_iter().skip(keep) {
        if fs::remove_file(Path::new(&dir).join(&f.filename)).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_name_guard_rejects_anything_else() {
        assert!(is_snapshot("streams-2026-07-17T15-30-00.json"));
        assert!(!is_snapshot("../../evil.json"));
        assert!(!is_snapshot("streams-../evil.json"));
        assert!(!is_snapshot("notes.json"));
        assert!(!is_snapshot("streams-x.txt"));
        assert!(!is_snapshot(""));
    }

    #[test]
    fn write_list_read_prune_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_string_lossy().to_string();

        for n in ["streams-2026-07-17T10-00-00.json", "streams-2026-07-17T11-00-00.json", "streams-2026-07-17T12-00-00.json"] {
            backup_write(p.clone(), n.into(), format!("{{\"n\":\"{n}\"}}")).unwrap();
        }

        let listed = backup_list(p.clone()).unwrap();
        assert_eq!(listed.len(), 3);
        // Newest first.
        assert_eq!(listed[0].filename, "streams-2026-07-17T12-00-00.json");

        let contents = backup_read(p.clone(), listed[0].filename.clone()).unwrap();
        assert!(contents.contains("12-00-00"));

        assert_eq!(backup_prune(p.clone(), 2).unwrap(), 1);
        let after = backup_list(p.clone()).unwrap();
        assert_eq!(after.len(), 2);
        // Pruning removed the OLDEST, never the newest.
        assert_eq!(after[0].filename, "streams-2026-07-17T12-00-00.json");
    }

    #[test]
    fn scratch_is_not_left_behind_in_the_backup_dir() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_string_lossy().to_string();
        backup_write(p.clone(), "streams-2026-07-17T10-00-00.json".into(), "{}".into()).unwrap();

        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["streams-2026-07-17T10-00-00.json"]);
    }

    #[test]
    fn write_refuses_a_bad_name() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_string_lossy().to_string();
        assert!(backup_write(p, "../evil.json".into(), "{}".into()).is_err());
    }

    #[test]
    fn listing_a_missing_dir_is_empty_not_an_error() {
        assert_eq!(backup_list("/nope/definitely/not/here".into()).unwrap().len(), 0);
    }
}
