//! On-disk persistence (SPEC §6).
//!
//! The whole job of this module is one guarantee: **a reader can never observe a
//! half-written file.** Everything else here is in service of that.
//!
//! Layout:
//! ```text
//! <root>/
//!   streams/<uuid>.json
//!   areas.json
//!   settings.json
//!   .tmp/            <- scratch, never synced (see below)
//! ```

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tempfile::NamedTempFile;

const STREAMS_SUBDIR: &str = "streams";
const TMP_SUBDIR: &str = ".tmp";

/// Root-level files the frontend may touch. An allowlist, not a sanitiser --
/// the frontend never gets to name an arbitrary path.
const ALLOWED_ROOT_FILES: &[&str] = &["areas.json", "settings.json"];

#[derive(Serialize)]
pub struct LoadedFile {
    /// File stem -- for streams this is the uuid.
    pub name: String,
    pub contents: String,
}

fn err(context: &str, e: impl std::fmt::Display) -> String {
    format!("{context}: {e}")
}

/// A uuid and nothing else. This is the path-traversal guard: no separators, no
/// `..`, no absolute paths can survive it.
fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.as_bytes()
            .iter()
            .enumerate()
            .all(|(i, &b)| match i {
                8 | 13 | 18 | 23 => b == b'-',
                _ => b.is_ascii_hexdigit(),
            })
}

fn streams_dir(root: &Path) -> PathBuf {
    root.join(STREAMS_SUBDIR)
}

fn tmp_dir(root: &Path) -> PathBuf {
    root.join(TMP_SUBDIR)
}

pub fn ensure_layout(root: &Path) -> Result<(), String> {
    fs::create_dir_all(streams_dir(root)).map_err(|e| err("create streams dir", e))?;
    fs::create_dir_all(tmp_dir(root)).map_err(|e| err("create tmp dir", e))?;
    Ok(())
}

/// Write `contents` to `target` such that `target` is either the old bytes or
/// the new bytes, never a mixture.
///
/// Two deliberate choices:
///
/// 1. **The scratch file lives in `<root>/.tmp`, not beside the target.** It has
///    to be on the same filesystem for `rename` to be atomic, which `<root>` is.
///    Keeping it out of `streams/` means a sync daemon watching that folder --
///    and our own directory watcher -- never see transient scratch files appear
///    and vanish. Add `/.tmp` to `.stignore` so Syncthing skips it entirely.
///
/// 2. **fsync before rename.** Without it a crash can leave the rename durable
///    while the contents are not, producing exactly the truncated file this
///    function exists to prevent.
pub fn atomic_write(root: &Path, target: &Path, contents: &str) -> Result<(), String> {
    ensure_layout(root)?;
    atomic_write_at(&tmp_dir(root), target, contents)
}

/// `atomic_write` with an explicit scratch directory, for callers outside the
/// store (see `config.rs`). The scratch dir must share a filesystem with the
/// target, or the rename stops being atomic.
pub fn atomic_write_at(scratch: &Path, target: &Path, contents: &str) -> Result<(), String> {
    fs::create_dir_all(scratch).map_err(|e| err("create scratch dir", e))?;

    let mut tmp = NamedTempFile::new_in(scratch).map_err(|e| err("create temp file", e))?;
    tmp.write_all(contents.as_bytes())
        .map_err(|e| err("write temp file", e))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| err("fsync temp file", e))?;

    tmp.persist(target)
        .map_err(|e| err("atomic rename", e.error))?;

    // fsync the directory so the rename itself survives a crash.
    if let Some(parent) = target.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn init_store(root: String) -> Result<(), String> {
    ensure_layout(Path::new(&root))
}

/// Read every stream file. Unreadable files are an error, not a silent skip --
/// a store that quietly loses a stream is the exact failure this app exists to
/// prevent (SPEC §8).
#[tauri::command]
pub fn read_all_streams(root: String) -> Result<Vec<LoadedFile>, String> {
    let root = Path::new(&root);
    ensure_layout(root)?;

    let mut out = Vec::new();
    let entries = fs::read_dir(streams_dir(root)).map_err(|e| err("read streams dir", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| err("read dir entry", e))?;
        let path = entry.path();

        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // Conflicted copies ("<uuid> (conflicted copy).json", "<uuid>.sync-conflict-...")
        // are not plain uuids, so they land here. M6 resolves them; M1 must not
        // pretend they're streams.
        if !is_uuid(stem) {
            continue;
        }

        let contents = fs::read_to_string(&path).map_err(|e| err(&format!("read {stem}"), e))?;
        out.push(LoadedFile {
            name: stem.to_string(),
            contents,
        });
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct ConflictFile {
    /// Full filename, needed to delete it once merged.
    pub filename: String,
    /// The uuid the conflicted copy belongs to.
    pub id: String,
    pub contents: String,
}

/// The uuid a conflicted-copy filename is derived from, if any.
///
/// Every sync tool decorates the *end* of the stem and leaves the original name
/// in front:
///   Dropbox    `<uuid> (conflicted copy 2026-07-17).json`
///   Syncthing  `<uuid>.sync-conflict-20260717-120000-ABCDEF.json`
///   iCloud     `<uuid> 2.json`
/// So rather than pattern-match three vendors' formats -- and miss the fourth --
/// take the leading uuid and treat anything trailing as decoration.
fn conflict_base_id(stem: &str) -> Option<String> {
    if stem.len() <= 36 {
        return None;
    }
    let (head, tail) = stem.split_at(36);
    if !is_uuid(head) {
        return None;
    }
    // Guard against a stem that merely starts with 36 uuid-ish chars: the next
    // character must be a separator, not more name.
    let next = tail.chars().next()?;
    if next.is_ascii_alphanumeric() || next == '-' {
        return None;
    }
    Some(head.to_string())
}

/// Conflicted copies the sync daemon left behind (SPEC §6).
#[tauri::command]
pub fn read_conflicts(root: String) -> Result<Vec<ConflictFile>, String> {
    let root = Path::new(&root);
    ensure_layout(root)?;

    let mut out = Vec::new();
    for entry in fs::read_dir(streams_dir(root)).map_err(|e| err("read streams dir", e))? {
        let entry = entry.map_err(|e| err("read dir entry", e))?;
        let path = entry.path();

        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(id) = conflict_base_id(stem) else {
            continue;
        };

        let contents = fs::read_to_string(&path).map_err(|e| err("read conflict", e))?;
        out.push(ConflictFile {
            filename: entry.file_name().to_string_lossy().to_string(),
            id,
            contents,
        });
    }
    Ok(out)
}

/// Remove a conflicted copy once its contents have been merged and written.
#[tauri::command]
pub fn delete_conflict(root: String, filename: String) -> Result<(), String> {
    // Only ever a file this module itself identified as a conflict: re-derive
    // rather than trust the caller, so no path can be smuggled through.
    let stem = Path::new(&filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("not a filename: {filename:?}"))?;
    if conflict_base_id(stem).is_none() {
        return Err(format!("refusing to delete non-conflict file: {filename:?}"));
    }
    if filename.contains('/') || filename.contains("..") {
        return Err(format!("refusing suspicious filename: {filename:?}"));
    }

    let target = streams_dir(Path::new(&root)).join(&filename);
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err("delete conflict", e)),
    }
}

#[tauri::command]
pub fn write_stream(root: String, id: String, contents: String) -> Result<(), String> {
    if !is_uuid(&id) {
        return Err(format!("refusing to write non-uuid stream id: {id:?}"));
    }
    let root = Path::new(&root);
    let target = streams_dir(root).join(format!("{id}.json"));
    atomic_write(root, &target, &contents)
}

#[tauri::command]
pub fn delete_stream(root: String, id: String) -> Result<(), String> {
    if !is_uuid(&id) {
        return Err(format!("refusing to delete non-uuid stream id: {id:?}"));
    }
    let target = streams_dir(Path::new(&root)).join(format!("{id}.json"));
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err("delete stream", e)),
    }
}

#[tauri::command]
pub fn read_root_file(root: String, name: String) -> Result<Option<String>, String> {
    if !ALLOWED_ROOT_FILES.contains(&name.as_str()) {
        return Err(format!("not an allowed root file: {name:?}"));
    }
    let path = Path::new(&root).join(&name);
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(&format!("read {name}"), e)),
    }
}

#[tauri::command]
pub fn write_root_file(root: String, name: String, contents: String) -> Result<(), String> {
    if !ALLOWED_ROOT_FILES.contains(&name.as_str()) {
        return Err(format!("not an allowed root file: {name:?}"));
    }
    let root = Path::new(&root);
    let target = root.join(&name);
    atomic_write(root, &target, &contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_root() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn uuid_guard_rejects_traversal() {
        assert!(is_uuid("11111111-1111-4111-8111-111111111111"));
        assert!(!is_uuid("../../etc/passwd"));
        assert!(!is_uuid("11111111-1111-4111-8111-11111111111"));
        assert!(!is_uuid("11111111_1111_4111_8111_111111111111"));
        assert!(!is_uuid("zzzzzzzz-1111-4111-8111-111111111111"));
        assert!(!is_uuid(""));
    }

    #[test]
    fn atomic_write_creates_then_replaces() {
        let root = tmp_root();
        let target = root.path().join("streams").join("a.json");

        atomic_write(root.path(), &target, "first").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "first");

        atomic_write(root.path(), &target, "second").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "second");
    }

    /// The core promise: a reader either sees the whole old file or the whole
    /// new one. Since we never open the target for writing, the old bytes stay
    /// intact until rename swaps them in one step.
    #[test]
    fn target_is_never_opened_for_writing() {
        let root = tmp_root();
        let target = root.path().join("streams").join("a.json");
        atomic_write(root.path(), &target, "old contents").unwrap();

        let before_inode = fs::metadata(&target).unwrap();
        atomic_write(root.path(), &target, "new").unwrap();
        let after_inode = fs::metadata(&target).unwrap();

        // A fresh inode proves it was replaced by rename, not truncated in place.
        // In-place truncation is what produces torn reads under a sync daemon.
        use std::os::unix::fs::MetadataExt;
        assert_ne!(before_inode.ino(), after_inode.ino());
    }

    #[test]
    fn scratch_files_never_land_in_streams_dir() {
        let root = tmp_root();
        let target = root.path().join("streams").join("a.json");
        atomic_write(root.path(), &target, "x").unwrap();

        let stray: Vec<_> = fs::read_dir(root.path().join("streams"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(stray, vec!["a.json"]);
    }

    #[test]
    fn tmp_dir_is_left_clean_after_write() {
        let root = tmp_root();
        let target = root.path().join("streams").join("a.json");
        atomic_write(root.path(), &target, "x").unwrap();

        let leftovers = fs::read_dir(root.path().join(".tmp")).unwrap().count();
        assert_eq!(leftovers, 0, "temp file should have been renamed away");
    }

    const UUID: &str = "11111111-1111-4111-8111-111111111111";

    #[test]
    fn conflict_base_id_reads_every_vendor_and_no_plain_file() {
        // Dropbox
        assert_eq!(
            conflict_base_id(&format!("{UUID} (conflicted copy 2026-07-17)")).as_deref(),
            Some(UUID)
        );
        // Dropbox, with a user name in it
        assert_eq!(
            conflict_base_id(&format!("{UUID} (Ivo's conflicted copy 2026-07-17)")).as_deref(),
            Some(UUID)
        );
        // Syncthing
        assert_eq!(
            conflict_base_id(&format!("{UUID}.sync-conflict-20260717-120000-ABCDEF")).as_deref(),
            Some(UUID)
        );
        // iCloud
        assert_eq!(conflict_base_id(&format!("{UUID} 2")).as_deref(), Some(UUID));

        // A plain stream file is NOT a conflict.
        assert_eq!(conflict_base_id(UUID), None);
        // Nor is an unrelated name.
        assert_eq!(conflict_base_id("notes"), None);
        // Nor is a longer hex string that merely starts uuid-shaped.
        assert_eq!(conflict_base_id(&format!("{UUID}aaaa")), None);
        assert_eq!(conflict_base_id(&format!("{UUID}-extra")), None);
    }

    #[test]
    fn read_conflicts_finds_copies_and_ignores_real_streams() {
        let root = tmp_root();
        ensure_layout(root.path()).unwrap();
        let dir = root.path().join("streams");
        fs::write(dir.join(format!("{UUID}.json")), "{\"real\":true}").unwrap();
        fs::write(
            dir.join(format!("{UUID} (conflicted copy 2026-07-17).json")),
            "{\"conflict\":true}",
        )
        .unwrap();
        fs::write(
            dir.join(format!("{UUID}.sync-conflict-20260717-120000-ABCDEF.json")),
            "{\"conflict\":true}",
        )
        .unwrap();

        let found = read_conflicts(root.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|c| c.id == UUID));
    }

    #[test]
    fn delete_conflict_refuses_a_real_stream_file() {
        let root = tmp_root();
        ensure_layout(root.path()).unwrap();
        let p = root.path().to_string_lossy().to_string();
        let real = root.path().join("streams").join(format!("{UUID}.json"));
        fs::write(&real, "{}").unwrap();

        // The guard that stops a merge bug from eating the surviving stream.
        assert!(delete_conflict(p.clone(), format!("{UUID}.json")).is_err());
        assert!(real.exists());

        assert!(delete_conflict(p.clone(), "../../evil.json".into()).is_err());
    }

    #[test]
    fn delete_conflict_removes_a_conflicted_copy() {
        let root = tmp_root();
        ensure_layout(root.path()).unwrap();
        let p = root.path().to_string_lossy().to_string();
        let name = format!("{UUID} (conflicted copy 2026-07-17).json");
        let f = root.path().join("streams").join(&name);
        fs::write(&f, "{}").unwrap();

        delete_conflict(p, name).unwrap();
        assert!(!f.exists());
    }

    #[test]
    fn read_all_skips_conflicted_copies() {
        let root = tmp_root();
        ensure_layout(root.path()).unwrap();
        let dir = root.path().join("streams");
        let id = "11111111-1111-4111-8111-111111111111";
        fs::write(dir.join(format!("{id}.json")), "{}").unwrap();
        fs::write(dir.join(format!("{id} (conflicted copy).json")), "{}").unwrap();
        fs::write(dir.join("notes.txt"), "ignore me").unwrap();

        let found = read_all_streams(root.path().to_string_lossy().to_string()).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, id);
    }

    #[test]
    fn write_stream_rejects_bad_id() {
        let root = tmp_root();
        let r = write_stream(
            root.path().to_string_lossy().to_string(),
            "../../evil".into(),
            "{}".into(),
        );
        assert!(r.is_err());
    }

    #[test]
    fn root_file_allowlist_is_enforced() {
        let root = tmp_root();
        let p = root.path().to_string_lossy().to_string();
        assert!(write_root_file(p.clone(), "areas.json".into(), "{}".into()).is_ok());
        assert!(write_root_file(p.clone(), "../evil.json".into(), "{}".into()).is_err());
        assert!(read_root_file(p.clone(), "/etc/passwd".into()).is_err());
    }

    #[test]
    fn missing_root_file_is_none_not_error() {
        let root = tmp_root();
        let p = root.path().to_string_lossy().to_string();
        assert_eq!(read_root_file(p, "areas.json".into()).unwrap(), None);
    }

    /// PLAN M1's done-criterion, tested rather than asserted.
    ///
    /// A sync daemon reads our files on its own schedule, concurrently with our
    /// writes. This hammers that exact race: readers must always observe one
    /// *complete* generation, never a mixture and never a truncation. Payloads
    /// are large enough that a non-atomic write would be interrupted mid-stream.
    #[test]
    fn concurrent_readers_never_observe_a_torn_file() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        use std::thread;

        let root = tmp_root();
        let root_path = root.path().to_path_buf();
        let target = root_path.join("streams").join("hot.json");

        let gen_a = "a".repeat(200_000);
        let gen_b = "b".repeat(200_000);
        atomic_write(&root_path, &target, &gen_a).unwrap();

        let stop = Arc::new(AtomicBool::new(false));

        let writer = {
            let (root_path, target, stop) = (root_path.clone(), target.clone(), stop.clone());
            let (a, b) = (gen_a.clone(), gen_b.clone());
            thread::spawn(move || {
                for i in 0..200 {
                    let payload = if i % 2 == 0 { &b } else { &a };
                    atomic_write(&root_path, &target, payload).unwrap();
                }
                stop.store(true, Ordering::SeqCst);
            })
        };

        let readers: Vec<_> = (0..4)
            .map(|_| {
                let (target, stop) = (target.clone(), stop.clone());
                thread::spawn(move || {
                    let mut reads = 0u32;
                    while !stop.load(Ordering::SeqCst) {
                        // A missing file would mean the target vanished between
                        // generations -- rename must never expose that gap.
                        let s = fs::read_to_string(&target)
                            .expect("target disappeared mid-rename");
                        let clean = s.len() == 200_000
                            && (s.bytes().all(|c| c == b'a') || s.bytes().all(|c| c == b'b'));
                        assert!(
                            clean,
                            "TORN READ: {} bytes, {} a's, {} b's",
                            s.len(),
                            s.bytes().filter(|&c| c == b'a').count(),
                            s.bytes().filter(|&c| c == b'b').count()
                        );
                        reads += 1;
                    }
                    reads
                })
            })
            .collect();

        writer.join().unwrap();
        let total: u32 = readers.into_iter().map(|r| r.join().unwrap()).sum();
        assert!(total > 0, "readers never actually observed the file");
    }
}
