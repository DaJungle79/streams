mod config;
mod storage;
mod tray;

use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

/// SPEC §4.2's default: ⌥⌘S. A fn, not a const — `Shortcut::new` isn't const.
fn capture_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::KeyS)
}

/// Passed by the login item so a launch-at-login can be told apart from a launch
/// by the user (SPEC §4.4).
const AUTOSTART_FLAG: &str = "--autostart";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // The flag is how a login launch identifies itself, so §4.4's "main
        // window stays closed" can be honoured without suppressing the window
        // when *you* open the app.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Fire on press only. Without this the handler runs twice --
                    // once down, once up -- and the window toggles shut again.
                    if event.state() == ShortcutState::Pressed && shortcut == &capture_shortcut() {
                        tray::show_capture(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            storage::init_store,
            storage::read_all_streams,
            storage::write_stream,
            storage::delete_stream,
            storage::read_root_file,
            storage::write_root_file,
            storage::read_conflicts,
            storage::delete_conflict,
            config::get_store_root,
            config::set_store_root,
            tray::update_tray,
            hide_capture,
        ])
        .setup(|app| {
            // SPEC §4.4: an accessory app -- menu bar only, no Dock icon. The
            // tray is the app's real presence; a Dock icon would imply a window
            // you're supposed to keep open, which is the opposite of the point.
            // Must run before `app.handle()` is borrowed: this needs &mut app.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            tray::init(&handle)?;

            // §4.4: on a login launch the window stays closed and only the tray
            // is live. The webview still loads (hidden), which is what keeps the
            // tray count and the daily digest running -- both are computed in
            // TypeScript, so a dead webview would mean a dead menu bar.
            if std::env::args().any(|a| a == AUTOSTART_FLAG) {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            // Non-fatal: another app may already own ⌥⌘S. Losing the hotkey is
            // an inconvenience; refusing to start over it would be absurd.
            if let Err(e) = handle.global_shortcut().register(capture_shortcut()) {
                eprintln!("could not register capture shortcut: {e}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // §4.4: closing the window must not quit. The tray count and the
                // daily digest are computed in the webview, so killing it would
                // silently stop the two features that make the app ambient.
                // Quit lives in the tray menu.
                api.prevent_close();
                let _ = window.hide();
                if window.label() == "capture" {
                    let _ = window.emit("capture:closed", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn hide_capture(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
}
