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

Rsbuild registers the mock API middleware when `WEBSSH_RS_MOCK=true`.
Use the repository-level mock development command to enable it:

```bash
pnpm dev:mock
```

The REST API source is selected as follows:

- `false` (default): proxy `/api` to the Rust server at
  `http://127.0.0.1:<WEBSSH_RS_SERVER_PORT>` (defaults to an available port
  when started by the repository development script, or `10086` otherwise).
- `true`: rewrite `/api` to the local `/mock_api` middleware.

SSH WebSocket requests are not mocked and continue to use the Rust server.

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
