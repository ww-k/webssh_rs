use std::{net::TcpStream, time::Duration};

use tauri::{Manager, WindowEvent};
use tokio::sync::oneshot;

struct ServerShutdown(std::sync::Mutex<Option<oneshot::Sender<()>>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerShutdown(std::sync::Mutex::new(None)))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory")
                .join("db.sqlite");
            std::fs::create_dir_all(db_path.parent().expect("database path has no parent"))
                .expect("failed to create app data directory");

            unsafe { std::env::set_var("WEBSSH_RS_DB_PATH", &db_path) };
            webssh_rs_server::init_logging();

            let (shutdown_tx, shutdown_rx) = oneshot::channel();
            *app.state::<ServerShutdown>()
                .0
                .lock()
                .expect("server shutdown state is poisoned") = Some(shutdown_tx);

            let window = app
                .get_webview_window("main")
                .expect("main window is not configured");

            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
                    .await
                    .expect("failed to bind embedded server");
                let address = listener
                    .local_addr()
                    .expect("failed to resolve embedded server address");

                tauri::async_runtime::spawn(async move {
                    webssh_rs_server::run_server_with_listener(listener, async move {
                        let _ = shutdown_rx.await;
                    })
                    .await;
                });

                for _ in 0..100 {
                    let healthy = tauri::async_runtime::spawn_blocking(move || {
                        TcpStream::connect(address).is_ok()
                    })
                    .await
                    .unwrap_or(false);
                    if healthy {
                        if !cfg!(debug_assertions) {
                            let server_url = format!("http://{address}/");
                            let _ = window
                                .navigate(server_url.parse().expect("valid embedded server URL"));
                        }
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                eprintln!("embedded server did not become ready");
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                if let Some(shutdown) = window
                    .state::<ServerShutdown>()
                    .0
                    .lock()
                    .expect("server shutdown state is poisoned")
                    .take()
                {
                    let _ = shutdown.send(());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
