use std::{net::TcpStream, path::PathBuf, time::Duration};

use tauri::{AppHandle, Manager, WindowEvent};
use tokio::sync::oneshot;

const DEFAULT_SERVER_PORT: u16 = 10086;
const SERVER_PORT_CONFIG_FILE: &str = "server-port";

struct ServerShutdown(std::sync::Mutex<Option<oneshot::Sender<()>>>);

fn server_port_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(SERVER_PORT_CONFIG_FILE))
        .map_err(|error| format!("failed to resolve server port config path: {error}"))
}

fn parse_server_port(value: &str) -> Option<u16> {
    value.parse::<u16>().ok().filter(|port| *port > 0)
}

fn server_port(app: &AppHandle) -> u16 {
    server_port_config_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|value| parse_server_port(value.trim()))
        .or_else(|| {
            std::env::var("WEBSSH_RS_SERVER_PORT")
                .ok()
                .and_then(|value| parse_server_port(value.as_str()))
        })
        .unwrap_or(DEFAULT_SERVER_PORT)
}

#[tauri::command]
fn get_server_port(app: AppHandle) -> u16 {
    server_port(&app)
}

#[tauri::command]
fn set_server_port(app: AppHandle, port: u16) -> Result<(), String> {
    if port == 0 {
        return Err("server port must be between 1 and 65535".to_string());
    }

    let path = server_port_config_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create server port config directory: {error}"))?;
    }
    std::fs::write(path, port.to_string())
        .map_err(|error| format!("failed to save server port: {error}"))
}

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
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let client_port = std::env::var("WEBSSH_RS_CLIENT_PORT")
                    .ok()
                    .and_then(|value| value.parse::<u16>().ok())
                    .unwrap_or(3000);

                let requested_port = server_port(&app_handle);
                let listener = match tokio::net::TcpListener::bind(("127.0.0.1", requested_port))
                    .await
                {
                    Ok(listener) => listener,
                    Err(error) => {
                        eprintln!(
                            "failed to bind embedded server on port {requested_port}: {error}; falling back to a dynamic port"
                        );
                        tokio::net::TcpListener::bind(("127.0.0.1", 0))
                            .await
                            .expect("failed to bind embedded server on a dynamic port")
                    }
                };
                let address = listener
                    .local_addr()
                    .expect("failed to resolve embedded server address");

                tauri::async_runtime::spawn(async move {
                    webssh_rs_server::run_server_with_listener(listener, async move {
                        let _ = shutdown_rx.await;
                    })
                    .await;
                });

                for _ in 1..=100 {
                    let (server_ready, frontend_ready) =
                        tauri::async_runtime::spawn_blocking(move || {
                            let server_ready = TcpStream::connect(address).is_ok();
                            let frontend_ready = !cfg!(debug_assertions)
                                || TcpStream::connect(("localhost", client_port)).is_ok();
                            (server_ready, frontend_ready)
                        })
                        .await
                        .unwrap_or((false, false));

                    if server_ready && frontend_ready {
                        let app_url = if cfg!(debug_assertions) {
                            format!("http://localhost:{client_port}/")
                        } else {
                            format!("http://{address}/")
                        };
                        let _ =
                            window.navigate(app_url.parse().expect("valid embedded server URL"));
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
        .invoke_handler(tauri::generate_handler![get_server_port, set_server_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
