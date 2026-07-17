//! Menu-bar presence (SPEC §4.1).
//!
//! The tray shows the attention count and the top five items. It is driven
//! entirely from the frontend via `update_tray` -- the AttentionEngine lives in
//! TypeScript, and having Rust re-derive the count would give us two sources of
//! truth for the one number the whole app is about.

use serde::Deserialize;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// One row of the dropdown: enough to label it and route a click back.
#[derive(Deserialize, Clone)]
pub struct TrayItem {
    pub id: String,
    pub title: String,
    pub detail: String,
}

pub const TRAY_ID: &str = "main";

fn build_menu<R: Runtime>(app: &AppHandle<R>, items: &[TrayItem]) -> tauri::Result<Menu<R>> {
    let mut b = MenuBuilder::new(app);

    if items.is_empty() {
        // The reward state (§2), said out loud rather than shown as a blank menu.
        b = b.item(
            &MenuItemBuilder::with_id("none", "Nothing needs you")
                .enabled(false)
                .build(app)?,
        );
    } else {
        for it in items {
            // "stream:<uuid>" so the click handler can route without a lookup table.
            b = b.item(
                &MenuItemBuilder::with_id(
                    format!("stream:{}", it.id),
                    format!("{}  —  {}", it.title, it.detail),
                )
                .build(app)?,
            );
        }
    }

    b.separator()
        .item(&MenuItemBuilder::with_id("open", "Open Streams").build(app)?)
        .item(&MenuItemBuilder::with_id("capture", "Quick capture…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "Quit").build(app)?)
        .build()
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn show_capture<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.show();
        let _ = w.set_focus();
        // Tell the field to clear itself: a capture window that opens holding
        // last week's half-typed thought is worse than useless.
        let _ = w.emit("capture:focus", ());
    }
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app, &[])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        // macOS renders the icon as a template so it follows light/dark menu bars.
        .icon_as_template(true)
        .menu(&menu)
        // The count is the point of the tray; opening a window on left-click
        // would bury it behind the thing §4.1 exists to avoid opening.
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "quit" => app.exit(0),
                "open" => show_main(app),
                "capture" => show_capture(app),
                _ => {
                    if let Some(stream_id) = id.strip_prefix("stream:") {
                        show_main(app);
                        let _ = app.emit("tray:open-stream", stream_id.to_string());
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

/// Called from the frontend whenever the attention set changes.
#[tauri::command]
pub fn update_tray<R: Runtime>(
    app: AppHandle<R>,
    count: usize,
    items: Vec<TrayItem>,
) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray not found".to_string())?;

    // PLAN called a menu-bar badge a risk, since macOS has no Dock-style badge
    // for tray icons. `set_title` is the first-class answer: text beside the
    // icon. Empty string (not "0") when nothing needs you -- a lingering grey
    // zero is noise, and §2's empty state is supposed to feel like a reward.
    let title = if count == 0 { String::new() } else { count.to_string() };
    tray.set_title(Some(title)).map_err(|e| e.to_string())?;

    let menu = build_menu(&app, &items).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    Ok(())
}
