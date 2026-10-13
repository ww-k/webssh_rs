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
  `http://127.0.0.1:<WEBSSH_RS_SERVER_PORT>` (defaults to port `8080`).
- `true`: rewrite `/api` to the local `/mock_api` middleware.

SSH WebSocket requests always use the Rust server, regardless of `enableMock`.

The repository-level `pnpm dev` script allocates an available local port for the
Rust server and passes it through `WEBSSH_RS_SERVER_PORT`. Set that variable
explicitly when starting the client by itself.

Build the app for production:

```bash
pnpm build
```

Preview the production build locally:

```bash
pnpm preview
```
