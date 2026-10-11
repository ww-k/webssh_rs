use std::{net::TcpStream, sync::Mutex, time::Duration};

use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::CommandChild;

struct ServerProcess(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if !cfg!(debug_assertions) {
                use tauri_plugin_shell::ShellExt;

                let db_path = app
                    .path()
                    .app_data_dir()
                    .expect("failed to resolve app data directory")
                    .join("db.sqlite");
                std::fs::create_dir_all(db_path.parent().expect("database path has no parent"))
                    .expect("failed to create app data directory");

                let (mut rx, child) = app
                    .shell()
                    .sidecar("webssh_rs_server")
                    .expect("failed to configure server sidecar")
                    .env("WEBSSH_RS_DB_PATH", db_path)
                    .spawn()
                    .expect("failed to start server sidecar");
                *app.state::<ServerProcess>()
                    .0
                    .lock()
                    .expect("server process state is poisoned") = Some(child);

                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_shell::process::CommandEvent;
                    while let Some(event) = rx.recv().await {
                        if let CommandEvent::Error(error) = event {
                            eprintln!("server sidecar error: {error}");
                        }
                    }
                });

                let window = app
                    .get_webview_window("main")
                    .expect("main window is not configured");
                tauri::async_runtime::spawn(async move {
                    for _ in 0..100 {
                        let healthy = tauri::async_runtime::spawn_blocking(|| {
                            TcpStream::connect(("127.0.0.1", 8080)).is_ok()
                        })
                        .await
                        .unwrap_or(false);
                        if healthy {
                            let _ = window.navigate(
                                "http://127.0.0.1:8080/".parse().expect("valid server URL"),
                            );
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    eprintln!("server sidecar did not become ready");
                });
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                if let Some(child) = window
                    .state::<ServerProcess>()
                    .0
                    .lock()
                    .expect("server process state is poisoned")
                    .take()
                {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
