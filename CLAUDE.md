# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebSSH RS is a web-based SSH client with file management capabilities, built with a React frontend and Rust backend. The application provides terminal access and SFTP file operations through a tabbed web interface. It can be deployed as a web application or as a desktop application using Tauri.

## Architecture

The project is split into three main components:

### Client (`/src-client/`)
- **Framework**: React 18 with TypeScript
- **Build Tool**: Rsbuild with Less support
- **State Management**: Zustand store
- **UI Library**: Ant Design 5
- **Terminal**: xterm.js with Socket.IO for real-time communication
- **File Management**: Custom SFTP file browser with drag-and-drop support
- **Internationalization**: i18next with English and Chinese translations

### Server (`/src-server/`)
- **Language**: Rust
- **Framework**: Axum web framework
- **Database**: SQLite with Sea-ORM
- **SSH/SFTP**: russh and russh-sftp libraries
- **Real-time**: Socket.IO integration via socketioxide
- **Session Management**: Custom SSH session pooling

### Desktop App (`/src-tauri/`)
- **Framework**: Tauri v2 for cross-platform desktop applications
- **Language**: Rust
- **Frontend Integration**: Serves the React client in a native window
- **Build**: Uses the client's dist output as frontend distribution
- **Configuration**: Window settings, bundling, and app metadata in `tauri.conf.json`

## Key Components

### Client Architecture
- **App.tsx**: Main application with tabbed interface routing
- **Store (store.ts)**: Central state management for tabs and application state
- **Components**:
  - `Terminal/`: xterm.js terminal with Socket.IO backend connection
  - `Filesview/`: SFTP file browser with upload/download capabilities
  - `Target/`: SSH connection target selection and management
- **API Layer**: Axios-based API client with type definitions

### Server Architecture
- **Services**: Modular service architecture for SSH, SFTP, and target management
- **Session Pool**: SSH connection pooling for efficient resource management
- **Database**: SQLite with Sea-ORM migrations for target storage
- **WebSocket**: Socket.IO integration for real-time terminal communication

### Desktop Architecture
- **Tauri Core**: Rust-based native application wrapper
- **Window Management**: Native window with configurable dimensions and properties
- **Security**: CSP configuration and secure frontend-backend communication
- **Distribution**: Cross-platform bundling for macOS, Windows, and Linux

## Common Development Commands

### Unified Development (Recommended)
```bash
# Install dependencies (run once)
npm install

# Start all services (server + client + desktop app)
npm run dev

# Build production version (client + desktop app)
npm run build
```

### Component-Specific Development

#### Client Development
```bash
# Navigate to client directory
cd src-client

# Install dependencies
pnpm install

# Start development server (with proxy to Rust backend)
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Code formatting and linting
pnpm format  # Biome formatter
pnpm check   # Biome linter with auto-fix
```

#### Server Development
```bash
# Navigate to server directory
cd src-server

# Run development server
cargo run

# Build for production
cargo build --release

# Run tests
cargo test
```

#### Desktop Development
```bash
# Navigate to Tauri directory
cd src-tauri

# Run desktop app in development mode (requires server to be running)
cargo tauri dev

# Build desktop app for production
cargo tauri build

# Build desktop app with specific target
cargo tauri build --target universal-apple-darwin
```

## Development Workflow

### Unified Development (Recommended)
1. **Install Dependencies**: Run `npm install` in the project root
2. **Start Development**: Run `npm run dev` to start all services simultaneously
   - Starts the Rust server on port 8080
   - Starts the React development server with proxy
   - Launches the Tauri desktop application
3. **Build Production**: Run `npm run build` to build both web and desktop versions

### Manual Component Development
#### Web Application
1. **Backend First**: Start the Rust server on port 8080
2. **Frontend Development**: Use `pnpm dev` which proxies API calls to the backend
3. **Database**: SQLite database is auto-created in `src-server/target/db.sqlite`

#### Desktop Application
1. **Backend First**: Start the Rust server on port 8080
2. **Build Frontend**: Run `pnpm build` in the client directory
3. **Desktop Development**: Use `cargo tauri dev` for development or `cargo tauri build` for production

## Code Style and Standards

- **Frontend**: Uses Biome for formatting (4-space indentation, double quotes)
- **Import Organization**: Automatic import grouping with blank lines between package, local, and type imports
- **CSS Modules**: Enabled for component-scoped styling
- **Type Safety**: Full TypeScript coverage on frontend, strong typing on backend

## Key Configuration Files

- `package.json`: Root package file with unified development and build scripts
- `scripts/dev.mjs`: Development orchestration script (starts all services)
- `scripts/build.mjs`: Production build orchestration script
- `src-client/rsbuild.config.ts`: Frontend build configuration with proxy setup
- `biome.json`: Code formatting and linting rules
- `src-server/Cargo.toml`: Rust dependencies and build configuration
- `src-tauri/tauri.conf.json`: Tauri desktop app configuration
- `src-tauri/Cargo.toml`: Desktop app dependencies and metadata

## API Structure

- `/api/ssh/*`: WebSocket-based terminal connections
- `/api/sftp/*`: File system operations (list, upload, download, delete)
- `/api/target/*`: SSH target management (CRUD operations)

## Database

Uses SQLite with Sea-ORM migrations. Database schema is managed through the `migrations/` directory in the server codebase.