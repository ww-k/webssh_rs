use std::{
    env,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};

use anyhow::{Context, Result};
use axum::Router;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Deserialize;
use socketioxide::{
    SocketIo,
    extract::{Data, SocketRef},
};
use tokio::sync::mpsc;
use tracing::{debug, error, info};

type SharedChild = Arc<Mutex<Box<dyn Child + Send + Sync>>>;
type SharedMaster = Arc<Mutex<Box<dyn MasterPty + Send>>>;
type SharedWriter = Arc<Mutex<Box<dyn Write + Send>>>;

#[derive(Debug, Deserialize)]
struct Resize {
    col: u32,
    row: u32,
}

pub(crate) fn router_builder() -> Router {
    let (svc, io) = SocketIo::builder().build_svc();
    io.ns("/", async move |socket: SocketRef| {
        let sid = socket.id;
        if let Err(err) = LocalTerminalSession::start(socket.clone()).await {
            error!("sid={} local terminal start failed: {:?}", sid, err);
            let _ = socket.disconnect();
        }
    });
    Router::new()
        .nest("/terminal", Router::new().fallback_service(svc))
        .fallback(|| async { "not supported" })
}

struct LocalTerminalSession {
    socket: SocketRef,
}

impl LocalTerminalSession {
    async fn start(socket: SocketRef) -> Result<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 25,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to open local pty")?;

        let shell = if cfg!(windows) {
            env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string())
        } else {
            env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        };
        let mut command = CommandBuilder::new(shell);
        command.env("TERM", "xterm-256color");
        if let Ok(lang) = env::var("LANG") {
            command.env("LANG", lang);
        }

        let child = pair
            .slave
            .spawn_command(command)
            .context("failed to spawn local shell")?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .context("failed to open local pty reader")?;
        let writer = pair
            .master
            .take_writer()
            .context("failed to open local pty writer")?;
        let master: SharedMaster = Arc::new(Mutex::new(pair.master));
        let child: SharedChild = Arc::new(Mutex::new(child));
        let writer: SharedWriter = Arc::new(Mutex::new(writer));
        let (output_tx, mut output_rx) = mpsc::channel::<Vec<u8>>(32);

        thread::spawn(move || read_pty(reader, output_tx));

        let sid = socket.id;
        info!("sid={} local terminal started", sid);
        let session = Self { socket };
        session.run(master, writer, child, &mut output_rx).await;
        info!("sid={} local terminal closed", sid);
        Ok(session)
    }

    async fn run(
        &self,
        master: SharedMaster,
        writer: SharedWriter,
        child: SharedChild,
        output_rx: &mut mpsc::Receiver<Vec<u8>>,
    ) {
        let socket = self.socket.clone();
        let sid = socket.id;
        let disconnect_child = child.clone();
        socket.on_disconnect(move |reason: socketioxide::socket::DisconnectReason| {
            let child = disconnect_child.clone();
            async move {
                debug!("sid={} local terminal disconnect: {:?}", sid, reason);
                kill_child(&child);
            }
        });

        let resize_master = master.clone();
        socket.on("resize", move |Data::<Resize>(data)| {
            let master = resize_master.clone();
            async move {
                if data.col == 0 || data.row == 0 {
                    return;
                }
                if let Ok(master) = master.lock() {
                    let _ = master.resize(PtySize {
                        rows: data.row.min(u16::MAX as u32) as u16,
                        cols: data.col.min(u16::MAX as u32) as u16,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            }
        });

        let input_writer = writer.clone();
        socket.on("input", move |Data::<String>(data)| {
            let writer = input_writer.clone();
            async move {
                if let Ok(mut writer) = writer.lock() {
                    let _ = writer.write_all(data.as_bytes());
                    let _ = writer.flush();
                }
            }
        });

        let system = if cfg!(windows) { "windows" } else { "linux" };
        let _ = socket.emit("server_ready", &serde_json::json!({ "system": system }));

        while let Some(data) = output_rx.recv().await {
            let output = String::from_utf8_lossy(&data);
            if socket.emit("output", output.as_ref()).is_err() {
                break;
            }
        }

        kill_child(&child);
        let _ = socket.disconnect();
    }
}

fn read_pty(mut reader: Box<dyn Read + Send>, output_tx: mpsc::Sender<Vec<u8>>) {
    let mut buffer = [0_u8; 8192];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        if output_tx.blocking_send(buffer[..count].to_vec()).is_err() {
            break;
        }
    }
}

fn kill_child(child: &SharedChild) {
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
