use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail};
use russh::{
    Preferred, cipher,
    client::{self, DisconnectReason},
    compression,
    keys::{HashAlg, PrivateKeyWithHashAlg, decode_secret_key, ssh_key},
};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
};
use webssh_rs_server::sftp_client::FastSftpClient;

#[derive(Debug)]
struct Cli {
    threads: usize,
    port: u16,
    identity_file: Option<PathBuf>,
    password: Option<String>,
    key_passphrase: Option<String>,
    chunk_size: usize,
    in_flight: usize,
    ssh_pool: usize,
    sftp_pool: usize,
    write_timeout_secs: u64,
    source: String,
    target: String,
}

#[derive(Debug, Clone)]
struct RemoteSpec {
    user: Option<String>,
    host: String,
    path: String,
}

#[derive(Debug, Clone)]
enum Endpoint {
    Local(PathBuf),
    Remote(RemoteSpec),
}

#[derive(Debug, Clone, Copy)]
enum Direction {
    Upload,
    Download,
}

struct TransferConfig {
    chunk_size: usize,
    max_in_flight: usize,
    write_timeout: Duration,
}

struct TransferStats {
    bytes: u64,
    connect_elapsed: Duration,
    elapsed: Duration,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = parse_args(std::env::args().skip(1))?;
    let source = parse_endpoint(&cli.source);
    let target = parse_endpoint(&cli.target);
    let direction = match (&source, &target) {
        (Endpoint::Local(_), Endpoint::Remote(_)) => Direction::Upload,
        (Endpoint::Remote(_), Endpoint::Local(_)) => Direction::Download,
        _ => bail!("exactly one endpoint must be remote, for example: file user@host:/tmp/file"),
    };

    validate_options(&cli)?;

    let remote = match (&source, &target) {
        (Endpoint::Remote(remote), _) | (_, Endpoint::Remote(remote)) => remote,
        _ => unreachable!(),
    };
    let user = remote
        .user
        .clone()
        .or_else(|| std::env::var("USER").ok())
        .context("missing SSH user, use user@host:/path")?;

    let config = TransferConfig {
        chunk_size: cli.chunk_size.min(255 * 1024),
        max_in_flight: cli.in_flight,
        write_timeout: Duration::from_secs(cli.write_timeout_secs),
    };
    let connect_started = Instant::now();
    let sftp = connect_sftp(
        &remote.host,
        cli.port,
        &user,
        cli.identity_file.as_deref(),
        cli.key_passphrase.as_deref(),
        cli.password.as_deref(),
    )
    .await?;
    let connect_elapsed = connect_started.elapsed();

    let mut stats = match (direction, &source, &target) {
        (Direction::Upload, Endpoint::Local(local_path), Endpoint::Remote(remote)) => {
            let remote_path = resolve_upload_remote_path(local_path, &remote.path)?;
            upload(&sftp, local_path, &remote_path, &config).await?
        }
        (Direction::Download, Endpoint::Remote(remote), Endpoint::Local(local_path)) => {
            download(&sftp, &remote.path, local_path, &config).await?
        }
        _ => unreachable!(),
    };
    stats.connect_elapsed = connect_elapsed;

    sftp.shutdown().await;
    print_stats(stats);
    Ok(())
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Result<Cli> {
    let mut cli = Cli {
        threads: 1,
        port: 22,
        identity_file: None,
        password: None,
        key_passphrase: None,
        chunk_size: 255 * 1024,
        in_flight: 64,
        ssh_pool: 1,
        sftp_pool: 1,
        write_timeout_secs: 2,
        source: String::new(),
        target: String::new(),
    };
    let mut positionals = Vec::new();
    let mut args = args.into_iter().peekable();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-P" | "--threads" => cli.threads = parse_next(&mut args, &arg)?,
            "-p" | "--port" => cli.port = parse_next(&mut args, &arg)?,
            "-i" | "--identity-file" => {
                cli.identity_file = Some(PathBuf::from(next(&mut args, &arg)?))
            }
            "--password" => cli.password = Some(next(&mut args, &arg)?),
            "--key-passphrase" => cli.key_passphrase = Some(next(&mut args, &arg)?),
            "--chunk-size" => cli.chunk_size = parse_next(&mut args, &arg)?,
            "--in-flight" => cli.in_flight = parse_next(&mut args, &arg)?,
            "--ssh-pool" => cli.ssh_pool = parse_next(&mut args, &arg)?,
            "--sftp-pool" => cli.sftp_pool = parse_next(&mut args, &arg)?,
            "--write-timeout-secs" => cli.write_timeout_secs = parse_next(&mut args, &arg)?,
            "--help" | "-h" => bail!("{}", usage()),
            value if value.starts_with("--chunk-size=") => {
                cli.chunk_size = parse_value(value, "--chunk-size=")?
            }
            value if value.starts_with("--in-flight=") => {
                cli.in_flight = parse_value(value, "--in-flight=")?
            }
            value if value.starts_with("--ssh-pool=") => {
                cli.ssh_pool = parse_value(value, "--ssh-pool=")?
            }
            value if value.starts_with("--sftp-pool=") => {
                cli.sftp_pool = parse_value(value, "--sftp-pool=")?
            }
            value if value.starts_with("--write-timeout-secs=") => {
                cli.write_timeout_secs = parse_value(value, "--write-timeout-secs=")?
            }
            value if value.starts_with("--password=") => {
                cli.password = Some(value["--password=".len()..].to_string())
            }
            value if value.starts_with("--key-passphrase=") => {
                cli.key_passphrase = Some(value["--key-passphrase=".len()..].to_string())
            }
            value if value.starts_with('-') => bail!("unknown option {value}\n{}", usage()),
            value => positionals.push(value.to_string()),
        }
    }

    if positionals.len() != 2 {
        bail!("{}", usage());
    }
    cli.source = positionals.remove(0);
    cli.target = positionals.remove(0);
    Ok(cli)
}

fn next(args: &mut impl Iterator<Item = String>, option: &str) -> Result<String> {
    args.next()
        .with_context(|| format!("missing value for {option}"))
}

fn parse_next<T>(args: &mut impl Iterator<Item = String>, option: &str) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    next(args, option)?
        .parse()
        .map_err(|err| anyhow::anyhow!("invalid value for {option}: {err}"))
}

fn parse_value<T>(value: &str, prefix: &str) -> Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    value[prefix.len()..]
        .parse()
        .map_err(|err| anyhow::anyhow!("invalid value for {}: {err}", prefix.trim_end_matches('=')))
}

fn usage() -> &'static str {
    "usage: webssh-transfer-cli [flags] <source> <target>"
}

fn validate_options(cli: &Cli) -> Result<()> {
    if cli.chunk_size == 0 {
        bail!("--chunk-size must be greater than 0");
    }
    if cli.in_flight == 0 {
        bail!("--in-flight must be greater than 0");
    }
    if cli.threads == 0 {
        bail!("--threads must be greater than 0");
    }
    if cli.threads != 1 || cli.ssh_pool != 1 || cli.sftp_pool != 1 {
        bail!("this verifier currently supports only -P 1 --ssh-pool=1 --sftp-pool=1");
    }
    Ok(())
}

fn parse_endpoint(value: &str) -> Endpoint {
    match parse_remote(value) {
        Some(remote) => Endpoint::Remote(remote),
        None => Endpoint::Local(PathBuf::from(value)),
    }
}

fn parse_remote(value: &str) -> Option<RemoteSpec> {
    let (left, path) = value.split_once(':')?;
    if left.is_empty() || path.is_empty() || left.contains('/') {
        return None;
    }
    let (user, host) = match left.split_once('@') {
        Some((user, host)) => (Some(user.to_string()), host.to_string()),
        None => (None, left.to_string()),
    };
    if host.is_empty() {
        return None;
    }

    Some(RemoteSpec {
        user,
        host,
        path: path.to_string(),
    })
}

async fn connect_sftp(
    host: &str,
    port: u16,
    user: &str,
    identity_file: Option<&Path>,
    key_passphrase: Option<&str>,
    password: Option<&str>,
) -> Result<FastSftpClient> {
    let config = build_ssh_config();
    let handler = ClientHandler;
    let mut handle = client::connect(Arc::new(config), (host, port), handler)
        .await
        .with_context(|| format!("connect {host}:{port}"))?;

    if let Some(identity_file) = identity_file {
        if authenticate_publickey(&mut handle, user, identity_file, key_passphrase).await? {
            let channel = handle.channel_open_session().await?;
            return FastSftpClient::new_from_channel(channel).await;
        }
        bail!(
            "publickey authentication failed with {}",
            identity_file.display()
        );
    }

    for identity_file in default_identity_files() {
        if !identity_file.exists() {
            continue;
        }
        if authenticate_publickey(&mut handle, user, &identity_file, key_passphrase).await? {
            let channel = handle.channel_open_session().await?;
            return FastSftpClient::new_from_channel(channel).await;
        }
    }

    if let Some(password) = password
        .map(ToOwned::to_owned)
        .or_else(|| std::env::var("WEBSSH_TEST_CLI_PASSWORD").ok())
    {
        let auth_result = handle
            .authenticate_password(user.to_string(), password)
            .await
            .context("authenticate password")?;
        if auth_result.success() {
            let channel = handle.channel_open_session().await?;
            return FastSftpClient::new_from_channel(channel).await;
        }
    }

    bail!(
        "authentication failed, tried default SSH keys; use -i, --password, or WEBSSH_TEST_CLI_PASSWORD"
    )
}

fn build_ssh_config() -> client::Config {
    client::Config {
        window_size: 16 * 1024 * 1024,
        maximum_packet_size: 65535,
        nodelay: true,
        preferred: Preferred {
            cipher: std::borrow::Cow::Borrowed(&[
                cipher::AES_128_GCM,
                cipher::AES_256_GCM,
                cipher::AES_128_CTR,
                cipher::AES_256_CTR,
                cipher::CHACHA20_POLY1305,
            ]),
            compression: std::borrow::Cow::Borrowed(&[compression::NONE]),
            ..Default::default()
        },
        ..Default::default()
    }
}

async fn authenticate_publickey(
    handle: &mut client::Handle<ClientHandler>,
    user: &str,
    identity_file: &Path,
    key_passphrase: Option<&str>,
) -> Result<bool> {
    let key_data = tokio::fs::read_to_string(identity_file)
        .await
        .with_context(|| format!("read identity file {}", identity_file.display()))?;
    let private_key = decode_secret_key(&key_data, key_passphrase)
        .with_context(|| format!("decode identity file {}", identity_file.display()))?;
    let private_key = PrivateKeyWithHashAlg::new(Arc::new(private_key), Some(HashAlg::Sha256));
    let auth_result = handle
        .authenticate_publickey(user.to_string(), private_key)
        .await
        .with_context(|| format!("authenticate publickey {}", identity_file.display()))?;
    Ok(auth_result.success())
}

fn default_identity_files() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME") else {
        return Vec::new();
    };
    let ssh_dir = PathBuf::from(home).join(".ssh");
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .into_iter()
        .map(|name| ssh_dir.join(name))
        .collect()
}

fn resolve_upload_remote_path(local_path: &Path, remote_path: &str) -> Result<String> {
    if !remote_path.ends_with('/') {
        return Ok(remote_path.to_string());
    }

    let file_name = local_path
        .file_name()
        .and_then(|name| name.to_str())
        .with_context(|| format!("missing local file name: {}", local_path.display()))?;
    Ok(format!("{remote_path}{file_name}"))
}

async fn upload(
    sftp: &FastSftpClient,
    local_path: &Path,
    remote_path: &str,
    config: &TransferConfig,
) -> Result<TransferStats> {
    let total = tokio::fs::metadata(local_path)
        .await
        .with_context(|| format!("stat {}", local_path.display()))?
        .len();
    let mut local_file = File::open(local_path)
        .await
        .with_context(|| format!("open {}", local_path.display()))?;
    let handle = sftp.open_upload(remote_path, total).await?;
    sftp.set_size(&handle, total).await?;

    let started = Instant::now();
    let upload_result = send_pipelined_writes(sftp, &handle, &mut local_file, total, config).await;
    let close_result = sftp.close(handle).await;

    upload_result?;
    close_result?;

    Ok(TransferStats {
        bytes: total,
        connect_elapsed: Duration::ZERO,
        elapsed: started.elapsed(),
    })
}

async fn download(
    sftp: &FastSftpClient,
    remote_path: &str,
    local_path: &Path,
    config: &TransferConfig,
) -> Result<TransferStats> {
    let attrs = sftp.metadata(remote_path).await?;
    let total = attrs
        .size
        .with_context(|| format!("remote path has no size metadata: {remote_path}"))?;
    let handle = sftp.open_read_handle(remote_path).await?;
    let mut local_file = File::options()
        .create(true)
        .write(true)
        .read(true)
        .truncate(false)
        .open(local_path)
        .await
        .with_context(|| format!("open {}", local_path.display()))?;
    local_file.set_len(total).await?;

    let started = Instant::now();
    let download_result = recv_pipelined_reads(sftp, &handle, &mut local_file, total, config).await;
    let close_result = sftp.close(handle).await;

    download_result?;
    close_result?;
    local_file.flush().await?;

    Ok(TransferStats {
        bytes: total,
        connect_elapsed: Duration::ZERO,
        elapsed: started.elapsed(),
    })
}

async fn send_pipelined_writes(
    sftp: &FastSftpClient,
    handle: &[u8],
    local_file: &mut File,
    total: u64,
    config: &TransferConfig,
) -> Result<()> {
    let mut buffer = vec![0; config.chunk_size];
    let handle: Arc<[u8]> = Arc::from(handle.to_vec());
    let mut next_offset = 0u64;
    let mut contiguous_done = 0u64;
    let mut pending = VecDeque::new();

    loop {
        while pending.len() < config.max_in_flight && next_offset < total {
            let offset = next_offset;
            let current_chunk_size = std::cmp::min(buffer.len() as u64, total - next_offset);
            local_file
                .read_exact(&mut buffer[..current_chunk_size as usize])
                .await?;
            let data: Box<[u8]> = buffer[..current_chunk_size as usize].into();
            let end = offset + data.len() as u64;
            let write = sftp.begin_write(Arc::clone(&handle), offset, data).await?;
            pending.push_back((offset, end, write));
            next_offset += current_chunk_size;
        }

        let Some((start, end, write)) = pending.pop_front() else {
            break;
        };
        tokio::time::timeout(config.write_timeout, write.wait())
            .await
            .context("sftp write response timeout")??;

        if start != contiguous_done {
            bail!("sftp upload progress mismatch: expected {contiguous_done}, got {start}");
        }
        contiguous_done = end;
    }

    if contiguous_done != total {
        bail!("sftp upload progress mismatch: expected {total}, got {contiguous_done}");
    }

    Ok(())
}

async fn recv_pipelined_reads(
    sftp: &FastSftpClient,
    handle: &[u8],
    local_file: &mut File,
    total: u64,
    config: &TransferConfig,
) -> Result<()> {
    let handle: Arc<[u8]> = Arc::from(handle.to_vec());
    let mut next_offset = 0u64;
    let mut contiguous_done = 0u64;
    let mut local_write_offset = 0u64;
    let mut pending = VecDeque::new();

    loop {
        while pending.len() < config.max_in_flight && next_offset < total {
            let offset = next_offset;
            let current_chunk_size = std::cmp::min(config.chunk_size as u64, total - next_offset);
            let read = sftp
                .begin_read(Arc::clone(&handle), offset, current_chunk_size as usize)
                .await?;
            pending.push_back((offset, read));
            next_offset += current_chunk_size;
        }

        let Some((offset, read)) = pending.pop_front() else {
            break;
        };
        if offset != contiguous_done {
            bail!("sftp download progress mismatch: expected {contiguous_done}, got {offset}");
        }

        let buffer = read.wait().await?;
        if buffer.is_empty() && contiguous_done < total {
            bail!("sftp download reached eof before offset {total}");
        }

        if local_write_offset != offset {
            local_file.seek(std::io::SeekFrom::Start(offset)).await?;
        }
        local_file.write_all(&buffer).await?;
        contiguous_done += buffer.len() as u64;
        local_write_offset = contiguous_done;
    }

    if contiguous_done != total {
        bail!("sftp download progress mismatch: expected {total}, got {contiguous_done}");
    }

    Ok(())
}

fn print_stats(stats: TransferStats) {
    let connect_seconds = stats.connect_elapsed.as_secs_f64();
    let seconds = stats.elapsed.as_secs_f64();
    let total_seconds = (stats.connect_elapsed + stats.elapsed).as_secs_f64();
    let mib = stats.bytes as f64 / 1024.0 / 1024.0;
    let mib_per_sec = if seconds > 0.0 { mib / seconds } else { 0.0 };
    let total_mib_per_sec = if total_seconds > 0.0 {
        mib / total_seconds
    } else {
        0.0
    };

    println!("bytes={}", stats.bytes);
    println!("connect_sec={connect_seconds:.3}");
    println!("elapsed_sec={seconds:.3}");
    println!("throughput_mib_s={mib_per_sec:.2}");
    println!("total_sec={total_seconds:.3}");
    println!("total_throughput_mib_s={total_mib_per_sec:.2}");
}

struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = anyhow::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        async { Ok(true) }
    }

    fn disconnected(
        &mut self,
        reason: DisconnectReason<Self::Error>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        async move {
            match reason {
                DisconnectReason::ReceivedDisconnect(_) => Ok(()),
                DisconnectReason::Error(err) => Err(err),
            }
        }
    }
}
