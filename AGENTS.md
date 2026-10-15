# WebSSH RS 开发说明

## 项目结构

- `src-client/`：React 18 + TypeScript 前端，使用 Rsbuild、Ant Design、Zustand 和 Biome。
- `src-server/`：Rust 后端，使用 Axum，提供 REST、WebSocket、SSH 和 SFTP 能力。
- `src-tauri/`：Tauri 2 桌面应用壳。
- `scripts/`：根目录的开发和构建编排脚本。
- `agents/`：与具体 AI 工具无关的后端和前端开发角色说明。

## 开发命令

根目录：

```bash
pnpm dev                 # 启动桌面开发模式
pnpm dev:browser         # 启动浏览器开发模式
pnpm build               # 构建前端和桌面应用
pnpm build:nobundle      # 构建但不打包桌面安装包
pnpm gen-docs            # 生成后端 API 文档
```

前端：

```bash
cd src-client
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm check                  # Biome 检查并自动修复
pnpm format                 # Biome 格式化
```

后端：

```bash
cd src-server
cargo run
cargo test
cargo fmt --check
```

## 修改约定

- 修改前先阅读目标模块及其调用方，优先复用现有组件、服务、类型和错误处理方式。
- 前端遵循 `biome.json`：4 空格缩进、双引号，并保持自动导入分组规则。
- Rust 代码遵循现有模块结构、命名和错误处理模式；修改 API 时同步检查相关类型、路由和文档。
- 新增功能时同时考虑前端、后端和 Tauri 集成边界，避免重复实现已有能力。
- 不修改 `.env`、`node_modules/`、`target/`、`dist/` 等敏感或生成目录。
- 提交前根据改动范围运行对应的格式检查、构建或测试命令。
