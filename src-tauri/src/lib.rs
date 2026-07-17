mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            storage::init_store,
            storage::read_all_streams,
            storage::write_stream,
            storage::delete_stream,
            storage::read_root_file,
            storage::write_root_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
