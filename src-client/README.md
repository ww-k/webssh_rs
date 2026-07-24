# Rsbuild project

## Setup

Install the dependencies:

```bash
pnpm install
```

## Get started

Start the dev server:

```bash
pnpm dev
```

Rsbuild registers the mock API middleware when the development server starts.
Set `enableMock` in `rsbuild.config.ts` to select the REST API source:

- `false` (default): proxy `/api` to the Rust server at
  `http://localhost:8080`.
- `true`: rewrite `/api` to the local `/mock_api` middleware.

SSH WebSocket requests always use the Rust server, regardless of `enableMock`.

Build the app for production:

```bash
pnpm build
```

Preview the production build locally:

```bash
pnpm preview
```
