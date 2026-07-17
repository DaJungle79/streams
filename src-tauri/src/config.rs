//! Where the store lives (SPEC §6).
//!
//! This is the one setting that cannot live in `settings.json`, because
//! `settings.json` lives *inside* the store. It is also the one setting that
//! must **not** sync: each Mac has its own path to the same sync folder, and a
//! synced path would have one machine overwrite the other's with a directory it
//! doesn't have.
//!
//! So it sits alone in the app-data dir, next to (eventually) the M7
//! reminder-map, which is machine-local for the same family of reasons.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Serialize, Deserialize, Default)]
pub struct LocalConfig {
    /// Absolute path to the store root. None = use the default.
    pub store_root: Option<String>,

    /// SPEC §4.5's single-writer rule: exactly one Mac mirrors to Reminders.
    ///
    /// Machine-local and default-off, both deliberately. Reminders syncs itself
    /// via iCloud, so a second mirroring Mac would produce duplicates -- and if
    /// this flag lived in the synced settings, turning it on once would turn it
    /// on everywhere, which is precisely the failure it exists to prevent.
    #[serde(default)]
    pub mirror_to_reminders: bool,
}

fn config_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join("local-config.json"))
}

/// The default store root: app-data, not a sync folder. M6 makes syncing a
/// choice; it must never be one made *for* the user by an upgrade.
fn default_root<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    Ok(dir.join("Streams").to_string_lossy().to_string())
}

fn load<R: Runtime>(app: &AppHandle<R>) -> LocalConfig {
    let Ok(path) = config_path(app) else {
        return LocalConfig::default();
    };
    match fs::read_to_string(&path) {
        // A missing or unreadable config means "not configured yet", never an
        // error: the app must always be able to open *some* store.
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => LocalConfig::default(),
    }
}

fn save<R: Runtime>(app: &AppHandle<R>, cfg: &LocalConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let path = config_path(app)?;
    // Same guarantee as the store itself: never a half-written config, or the
    // app forgets where its data is.
    let dir = path.parent().ok_or("no parent dir")?.to_path_buf();
    crate::storage::atomic_write_at(&dir, &path, &json)
}

#[tauri::command]
pub fn get_store_root<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    match load(&app).store_root {
        Some(r) => Ok(r),
        None => default_root(&app),
    }
}

#[tauri::command]
pub fn set_store_root<R: Runtime>(app: AppHandle<R>, root: Option<String>) -> Result<String, String> {
    let mut cfg = load(&app);
    cfg.store_root = root.clone();
    save(&app, &cfg)?;
    match root {
        Some(r) => Ok(r),
        None => default_root(&app),
    }
}

#[tauri::command]
pub fn get_mirror_enabled<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    Ok(load(&app).mirror_to_reminders)
}

#[tauri::command]
pub fn set_mirror_enabled<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let mut cfg = load(&app);
    cfg.mirror_to_reminders = enabled;
    save(&app, &cfg)
}

fn map_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app data dir: {e}"))?;
    Ok(dir.join("reminder-map.json"))
}

/// The reminder↔stream map (SPEC §4.5).
///
/// Held here, outside the sync folder, because it is machine-local state: the
/// ids belong to the reminders *this* Mac created. Putting it in the store would
/// drag §6's conflict policy into a third-party writer for no benefit.
#[tauri::command]
pub fn read_reminder_map<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    match fs::read_to_string(map_path(&app)?) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".to_string()),
        Err(e) => Err(format!("read reminder map: {e}")),
    }
}

#[tauri::command]
pub fn write_reminder_map<R: Runtime>(app: AppHandle<R>, contents: String) -> Result<(), String> {
    let path = map_path(&app)?;
    let dir = path.parent().ok_or("no parent dir")?.to_path_buf();
    crate::storage::atomic_write_at(&dir, &path, &contents)
}
