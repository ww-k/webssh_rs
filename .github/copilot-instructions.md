# Copilot Instructions

This file provides essential guidance for AI coding agents working in the WebSSH RS codebase.

## Project Overview

WebSSH RS is a web-based SSH client with file management capabilities, consisting of:
- React/TypeScript frontend with xterm.js and SFTP file browser
- Rust backend using Axum, with SSH session pooling and SQLite storage

## Key Architecture Points

### Frontend (`/client/`)
- React components in `/client/src/components/` follow a pattern of:
  - `index.tsx` for main component logic
  - `index.css` for component-scoped styles
  - Supporting TypeScript files for complex features
- State management uses Zustand (`store.ts`)
- Socket.IO for real-time terminal communication
- Biome for formatting/linting (4-space indent, double quotes)

### Backend (`/server/`)
- Axum web framework with modular service architecture
- SSH session pooling in `ssh_session_pool.rs`
- Sea-ORM for SQLite database management
- `apis/handlers/` contains all endpoint implementations

## Development Workflow

1. Backend server must be running first:
```bash
cd server
cargo run  # Starts on port 8080
```

2. Frontend development with auto-reload:
```bash
cd client
pnpm dev   # Includes proxy to backend
```

## Common Patterns

- API endpoints follow structure in `client/src/api/` with TypeScript types
- Component styles use CSS modules with explicit imports
- Terminal operations go through Socket.IO, file operations use REST
- SQLite database at `server/target/db.sqlite` (auto-created)

## Integration Points

- Frontend-backend communication:
  - REST API endpoints in `server/src/apis/`
  - WebSocket handlers in `server/src/apis/ssh.rs`
  - Type definitions shared in `client/src/types/`
  
- File operations:
  - Upload/download through `client/src/components/Filesview/`
  - SFTP implementation in `server/src/apis/sftp.rs`

## Configuration

- Frontend build: `client/rsbuild.config.ts`
- Code style: `biome.json`
- Backend dependencies: `server/Cargo.toml`