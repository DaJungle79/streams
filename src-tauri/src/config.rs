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

#[tauri::command]
pub fn get_store_root<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let path = config_path(&app)?;
    let cfg: LocalConfig = match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        // A missing or unreadable config means "not configured yet", never an
        // error: the app must always be able to open *some* store.
        Err(_) => LocalConfig::default(),
    };
    match cfg.store_root {
        Some(r) => Ok(r),
        None => default_root(&app),
    }
}

#[tauri::command]
pub fn set_store_root<R: Runtime>(app: AppHandle<R>, root: Option<String>) -> Result<String, String> {
    let cfg = LocalConfig {
        store_root: root.clone(),
    };
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    let path = config_path(&app)?;

    // Same guarantee as the store itself: never a half-written config, or the
    // app forgets where its data is.
    let dir = path.parent().ok_or("no parent dir")?.to_path_buf();
    crate::storage::atomic_write_at(&dir, &path, &json)?;

    match root {
        Some(r) => Ok(r),
        None => default_root(&app),
    }
}
