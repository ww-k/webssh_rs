use std::fs;
use std::path::PathBuf;
use utoipa::OpenApi;
use webssh_rs_server::api_doc::ApiDoc;

const REDOC_HTML: &str = r#"<!DOCTYPE html>
<html>

<head>
    <title>WebSSH RS API Documentation</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            margin: 0;
            padding: 0;
        }
    </style>
</head>

<body>
    <redoc spec-url="./openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>

</html>"#;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let output_dir = if args.len() > 1 {
        PathBuf::from(&args[1])
    } else {
        PathBuf::from("./docs")
    };

    // 创建输出目录
    if let Err(e) = fs::create_dir_all(&output_dir) {
        eprintln!("创建输出目录失败: {}", e);
        std::process::exit(1);
    }

    // 生成 OpenAPI JSON 文件
    let openapi_json = ApiDoc::openapi().to_pretty_json().unwrap();
    let json_path = output_dir.join("openapi.json");

    if let Err(e) = fs::write(&json_path, openapi_json) {
        eprintln!("写入 OpenAPI JSON 文件失败: {}", e);
        std::process::exit(1);
    }

    println!("✓ OpenAPI JSON 文件已生成: {}", json_path.display());

    // 生成 ReDoc HTML 文件
    let html_path = output_dir.join("index.html");

    if let Err(e) = fs::write(&html_path, REDOC_HTML) {
        eprintln!("写入 ReDoc HTML 文件失败: {}", e);
        std::process::exit(1);
    }

    println!("✓ ReDoc HTML 文件已生成: {}", html_path.display());
    println!("\n文档已成功生成到目录: {}", output_dir.display());
    println!("可以通过浏览器打开 {} 查看文档", html_path.display());
}
