# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebSSH RS is a web-based SSH client with file management capabilities, built with a React frontend and Rust backend. The application provides terminal access and SFTP file operations through a tabbed web interface.

## Architecture

The project is split into two main components:

### Client (`/client/`)
- **Framework**: React 18 with TypeScript
- **Build Tool**: Rsbuild with Less support
- **State Management**: Zustand store
- **UI Library**: Ant Design 5
- **Terminal**: xterm.js with Socket.IO for real-time communication
- **File Management**: Custom SFTP file browser with drag-and-drop support
- **Internationalization**: i18next with English and Chinese translations

### Server (`/server/`)
- **Language**: Rust
- **Framework**: Axum web framework
- **Database**: SQLite with Sea-ORM
- **SSH/SFTP**: russh and russh-sftp libraries
- **Real-time**: Socket.IO integration via socketioxide
- **Session Management**: Custom SSH session pooling

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

## Common Development Commands

### Client Development
```bash
# Navigate to client directory
cd client

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

### Server Development
```bash
# Navigate to server directory
cd server

# Run development server
cargo run

# Build for production
cargo build --release

# Run tests
cargo test
```

## Development Workflow

1. **Backend First**: Start the Rust server on port 8080
2. **Frontend Development**: Use `pnpm dev` which proxies API calls to the backend
3. **Database**: SQLite database is auto-created in `server/target/db.sqlite`

## Code Style and Standards

- **Frontend**: Uses Biome for formatting (4-space indentation, double quotes)
- **Import Organization**: Automatic import grouping with blank lines between package, local, and type imports
- **CSS Modules**: Enabled for component-scoped styling
- **Type Safety**: Full TypeScript coverage on frontend, strong typing on backend

## Key Configuration Files

- `client/rsbuild.config.ts`: Frontend build configuration with proxy setup
- `biome.json`: Code formatting and linting rules
- `server/Cargo.toml`: Rust dependencies and build configuration

## API Structure

- `/api/ssh/*`: WebSocket-based terminal connections
- `/api/sftp/*`: File system operations (list, upload, download, delete)
- `/api/target/*`: SSH target management (CRUD operations)

## Database

Uses SQLite with Sea-ORM migrations. Database schema is managed through the `migrations/` directory in the server codebase.