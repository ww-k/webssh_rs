# WebSSH RS - Agent Development Guide

This file provides essential guidance for AI coding agents working in the WebSSH RS codebase.

## Project Overview

WebSSH RS is a web-based SSH client with file management capabilities, consisting of:
- React/TypeScript frontend with xterm.js and SFTP file browser  
- Rust backend using Axum, with SSH session pooling and SQLite storage
- Tauri desktop app wrapper for cross-platform distribution

## Architecture

### Components
- **Client** (`/src-client/`): React 18 + TypeScript frontend
- **Server** (`/src-server/`): Rust backend with Axum framework
- **Desktop** (`/src-tauri/`): Tauri v2 desktop application

### Key Integration Points
- Frontend-backend communication via REST API (`/api/*`) and WebSocket (`/api/ssh/*`)
- SQLite database at `src-server/target/db.sqlite` (auto-created)
- SSH session pooling in `src-server/src/ssh_session_pool.rs`

## Development Commands

### Unified Development (Recommended)
```bash
# Install dependencies (run once)
npm install

# Start all services (server + client + desktop app)
npm run dev

# Build production version (client + desktop app)  
npm run build

# Generate API documentation
npm run gen-docs
```

### Component-Specific Commands

#### Frontend (`/src-client/`)
```bash
pnpm install          # Install dependencies
pnpm dev              # Development server with proxy to backend
pnpm build            # Production build
pnpm preview          # Preview production build
pnpm format           # Biome formatter
pnpm check            # Biome linter with auto-fix
pnpm test             # Run tests with rstest
```

#### Backend (`/src-server/`)
```bash
cargo run             # Start development server (port 8080)
cargo build --release # Production build
cargo test            # Run tests
cargo test <test_name> # Run single test
```

#### Desktop (`/src-tauri/`)
```bash
cargo tauri dev       # Development mode (requires server running)
cargo tauri build     # Production build
cargo tauri build --target <target> # Build for specific platform
```

## Code Style Guidelines

### Frontend (TypeScript/React)

#### Formatting & Linting
- **Tool**: Biome formatter and linter
- **Indentation**: 4 spaces, no tabs
- **Quotes**: Double quotes for strings
- **Semicolons**: Required

#### Import Organization
```typescript
// Package imports
import React from "react";
import { Button } from "antd";

// Local imports (with @ alias)
import Component from "@/components/Component";
import { SomeType } from "@/types";

// Style imports
import "./styles.css";

// Type imports
import type { SomeInterface } from "@/types";
```

#### Component Structure
```typescript
// Component files follow pattern: index.tsx + index.css
import { useEffect, useMemo } from "react";

import "./index.css";

import useStore from "@/store";

export default function ComponentName({ prop }: Props) {
    const storeValue = useStore((state) => state.value);
    
    const computedValue = useMemo(() => {
        // Computation
    }, [dependencies]);
    
    useEffect(() => {
        // Side effects
    }, [dependencies]);
    
    return <div>{/* JSX */}</div>;
}
```

#### State Management
- Use Zustand for global state (`store.ts`)
- Keep component state local when possible
- Follow existing patterns for tab management and file operations

### Backend (Rust)

#### Code Organization
- **Module structure**: `mod.rs` for module exports, handlers in separate files
- **Error handling**: Use `anyhow::Result<T>` and custom `ApiErr` types
- **Async patterns**: All handlers are async functions

#### Naming Conventions
```rust
// Functions: snake_case
pub async fn handler_name() -> Result<Json<Response>, ApiErr>

// Structs: PascalCase
#[derive(Debug, Deserialize)]
pub struct RequestPayload

// Constants: SCREAMING_SNAKE_CASE
pub const ERROR_CODE: &str = "SOME_ERROR";
```

#### Error Handling Pattern
```rust
use crate::{apis::ApiErr, consts::services_err_code::*, map_ssh_err};

pub async fn handler() -> Result<Json<Response>, ApiErr> {
    let result = map_ssh_err!(some_operation().await)?;
    Ok(Json(result))
}
```

#### API Documentation
- Use `utoipa` for OpenAPI documentation
- Include detailed descriptions and examples
- Follow existing patterns in `apis/handlers/`

### Testing

#### Frontend Testing
- Framework: rstest
- Test location: alongside components or in `__tests__/` directories
- Run with: `pnpm test`

#### Backend Testing  
- Framework: Rust's built-in test framework
- Test modules in `src/tests/`
- Mock SSH server for testing SFTP operations
- Run with: `cargo test` or `cargo test <test_name>`

## Common Patterns

### Component Structure
- Main component in `index.tsx`
- Styles in `index.css` (CSS modules enabled)
- Complex logic in separate files within component directory
- Type definitions in `types/` or inline

### API Communication
```typescript
// Use centralized API layer
import { apiRequest } from "@/api";

// Type definitions for all requests/responses
interface ApiResponse {
    // Type definitions
}
```

### State Management
```typescript
// Zustand store pattern
type AppStore = {
    state: string;
    actions: () => void;
};

export default create<AppStore>((set) => ({
    state: "initial",
    actions: () => set({ state: "new" }),
}));
```

## Configuration Files

### Key Files
- `biome.json`: Frontend formatting/linting configuration
- `src-client/rsbuild.config.ts`: Frontend build setup with proxy
- `src-server/Cargo.toml`: Rust dependencies and build config
- `src-tauri/tauri.conf.json`: Desktop app configuration
- `scripts/dev.mjs`: Unified development orchestration

### Development Workflow
1. Backend server must start first (port 8080)
2. Frontend dev server includes proxy configuration
3. Desktop app uses frontend build output

## Integration Notes

### Database
- SQLite with Sea-ORM migrations
- Migrations in `src-server/src/migrations/`
- Database auto-created on first run

### Socket.IO Communication
- Terminal connections via WebSocket (`/api/ssh/*`)
- File operations via REST API (`/api/sftp/*`)
- Real-time bidirectional communication for terminal I/O

### File Structure Patterns
- **Components**: `src-client/src/components/ComponentName/`
- **APIs**: `src-server/src/apis/` with handlers in subdirectories
- **Types**: Centralized in `src-client/src/types/` and `src-server/src/entities/`

## Security & Performance

- Use proper error handling without exposing internal details
- SSH session pooling for resource efficiency
- CSP configuration in Tauri for desktop security
- Input validation on all API endpoints

## Important Notes

- Always run backend before frontend for development
- Use unified `npm run dev` command for full stack development
- Follow existing code patterns - consistency is key
- Add appropriate OpenAPI documentation for new endpoints
- Include error handling for all external operations