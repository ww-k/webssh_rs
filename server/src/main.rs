#[tokio::main]
async fn main() {
    webssh_rs_server::run_server().await;
}
