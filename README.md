# WebSSH RS

WebSSH RS 是一个基于 Web 的 SSH 客户端，支持终端连接、远程文件管理、SFTP 文件传输和多目标配置。项目可以作为浏览器应用运行，也可以通过 Tauri 打包为桌面应用。

## 技术栈

- **前端**：React 18、TypeScript、Rsbuild、Ant Design、Zustand、xterm.js、Socket.IO Client
- **后端**：Rust、Axum、Tokio、SeaORM、SQLite、russh、socketioxide
- **桌面端**：Tauri 2，内嵌 Rust 后端并加载前端界面
- **格式化与检查**：Biome

## 项目结构

```text
.
├── src-client/       # React 前端
├── src-server/       # Axum 后端和 Rust 测试
├── src-tauri/        # Tauri 桌面应用
├── scripts/          # 根目录开发和构建编排脚本
├── agents/           # 与具体 AI 工具无关的开发角色说明
├── biome.json        # Biome 配置
└── package.json      # 根目录命令
```

后端的主要模块位于 `src-server/src/apis/`，包括 SSH、SFTP、本地文件系统、目标管理、收藏目录、偏好设置和传输任务。前端组件位于 `src-client/src/components/`。

## 环境要求

- Node.js 22 或更高版本
- pnpm 10 或更高版本
- Rust stable toolchain
- 桌面开发或打包需要满足 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)

## 安装

在仓库根目录执行：

```bash
pnpm install
```

根目录依赖包含 Tauri CLI，前端依赖单独安装在 `src-client/`。首次运行 `pnpm dev` 或 `pnpm build` 时，编排脚本也会检查并安装前端依赖。

## 开发

### 桌面模式

启动前端开发服务器、Rust 后端和 Tauri 桌面窗口：

```bash
pnpm dev
```

### 浏览器模式

只启动 Rust 后端和前端开发服务器，然后在浏览器访问 `http://localhost:<客户端端口>`：

```bash
pnpm run dev:browser
```

如需修改前端开发端口，可复制 `.env.template` 为根目录的 `.env` 后调整 `WEBSSH_RS_CLIENT_PORT`。

开发脚本会加载项目根目录的 `.env` 文件，为后端始终分配动态可用端口，并通过环境变量传给前端和后端。开发启动时不会使用 `WEBSSH_RS_SERVER_PORT`。前端开发服务器默认使用 3000 端口，也可以通过 `WEBSSH_RS_CLIENT_PORT` 修改；后端单独运行时默认使用 8080 端口。

### 单独运行前端

```bash
cd src-client
pnpm dev
```

单独运行前端时，默认会把 `/api` 和 `/api/ssh` 代理到 `127.0.0.1:8080`。如果后端使用其他端口，需要先设置环境变量：

```bash
WEBSSH_RS_SERVER_PORT=18080 pnpm dev
```

## 构建和检查

根目录命令：

```bash
pnpm build                # 构建前端并打包 Tauri 应用
pnpm build:nobundle       # 构建前端和 Tauri 二进制，但不生成安装包
pnpm gen-docs             # 生成 OpenAPI 文档
```

前端命令：

```bash
cd src-client
pnpm build                # 构建前端到 dist/
pnpm preview              # 预览前端生产构建
pnpm test                 # 运行前端测试
pnpm check                # Biome 检查并自动修复
pnpm format               # Biome 格式化
```

后端命令：

```bash
cd src-server
cargo run                 # 启动后端，默认监听 127.0.0.1:8080
cargo test                # 运行 Rust 测试
cargo fmt --check         # 检查 Rust 格式
```

生产构建时，前端静态文件会被编译进 Rust 后端。构建后的后端可以直接提供前端页面和 API。

## 配置

后端支持以下环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEBSSH_RS_SERVER_PORT` | `8080` | 后端监听端口 |
| `WEBSSH_RS_CLIENT_PORT` | `3000` | 前端开发服务器端口（`pnpm dev`） |
| `WEBSSH_RS_DB_PATH` | 系统数据目录下的 `webssh_rs_server/db.sqlite` | SQLite 数据库路径；Tauri 会使用应用数据目录中的 `db.sqlite` |
| `WEBSSH_RS_CHECK_SERVER_KEY` | `accept-new` | SSH 主机密钥策略，可选 `accept-new`、`strict`、`disabled` |
| `WEBSSH_RS_TRANSFER_TASK_CONCURRENCY` | `3` | 并行传输任务数量，必须是正整数 |
| `WEBSSH_RS_TRANSFER_CHUNK_SIZE` | `10485760` | 传输分块大小，单位为字节，必须是正整数 |

例如：

```bash
WEBSSH_RS_SERVER_PORT=18080 \
WEBSSH_RS_CHECK_SERVER_KEY=strict \
cargo run --manifest-path src-server/Cargo.toml
```

## API 和文档

后端 API 统一使用 `/api` 前缀，主要接口分组如下：

- `/api/health`：健康检查
- `/api/ssh`：SSH 终端和命令执行
- `/api/ssh_connection`：SSH 连接管理
- `/api/sftp`：远程目录、文件和 SFTP 操作
- `/api/fs`：本地文件系统操作
- `/api/target`：SSH 目标配置
- `/api/favorite_directory`：收藏目录
- `/api/transfer`：上传、下载和传输任务
- `/api/preferences`：用户偏好设置

启动后端后，可以访问：

- `http://127.0.0.1:8080/api-docs`：ReDoc API 文档
- `http://127.0.0.1:8080/api-docs/openapi.json`：OpenAPI JSON

如果端口通过 `WEBSSH_RS_SERVER_PORT` 修改，请将地址中的 `8080` 替换为实际端口。

## 数据库和迁移

后端使用 SQLite 和 SeaORM。服务启动时会自动创建数据库目录、连接数据库并执行迁移。迁移文件位于 `src-server/src/migrations/`。

## 发布

GitHub Actions 会在推送 `v*` 格式的 tag 后构建并创建 GitHub Release，构建目标包括：

- macOS Apple Silicon：`.dmg`
- Windows：`.msi` 和 `.exe`
- Linux：`.AppImage`、`.deb` 和 `.rpm`

发布示例：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流文件位于 `.github/workflows/release.yml`。

## 许可证

许可证信息见仓库根目录的 [LICENSE](LICENSE) 文件。
