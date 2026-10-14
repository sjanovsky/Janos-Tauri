mod db;
mod networth;
mod sankey;
mod spending;
mod taxes;

use db::{init_db, DbState};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");

            let conn = Connection::open(app_data_dir.join("janos.sqlite"))
                .expect("failed to open database");
            init_db(&conn).expect("failed to initialize database schema");

            app.manage(DbState(Mutex::new(conn)));

            let show_item = MenuItem::with_id(app, "show", "Show Janos", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    eprintln!("tray menu event: {:?}", event.id);
                    match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    eprintln!("tray icon event: {:?}", event);
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            if visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            spending::list_uploads,
            spending::add_upload,
            spending::delete_upload,
            spending::rename_upload,
            spending::update_transaction_category,
            spending::update_transaction_categories,
            spending::list_categories,
            spending::upsert_category,
            spending::set_category_placement,
            spending::set_category_positions,
            spending::list_banks,
            spending::upsert_bank,
            spending::delete_bank,
            spending::set_bank_spending_positive,
            spending::list_buckets,
            spending::upsert_bucket,
            spending::set_bucket_positions,
            spending::delete_bucket,
            spending::delete_category,
            networth::list_networth_buckets,
            networth::upsert_networth_bucket,
            networth::set_networth_bucket_positions,
            networth::delete_networth_bucket,
            networth::list_networth_accounts,
            networth::upsert_networth_account,
            networth::set_networth_account_placement,
            networth::set_networth_account_positions,
            networth::delete_networth_account,
            networth::list_networth_balances,
            networth::set_networth_balance,
            networth::rename_networth_month,
            networth::delete_networth_month,
            networth::import_networth,
            taxes::get_taxes_data,
            taxes::add_taxes_year,
            taxes::delete_taxes_year,
            taxes::set_taxes_household_value,
            taxes::upsert_taxes_item,
            taxes::delete_taxes_item,
            sankey::get_sankey_data,
            sankey::upsert_sankey_bucket,
            sankey::set_sankey_bucket_positions,
            sankey::delete_sankey_bucket,
            sankey::upsert_sankey_category,
            sankey::set_sankey_category_positions,
            sankey::delete_sankey_category,
            sankey::set_paycheck_line,
            sankey::upsert_sankey_rule,
            sankey::delete_sankey_rule,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
