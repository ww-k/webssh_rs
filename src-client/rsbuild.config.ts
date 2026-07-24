import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

import { mockMiddlewares } from "./mock/server.mjs";

// 配置是否启用 mock 服务时
const enableMock = false;

export default defineConfig({
    source: {
        entry: {
            index: "./src/index.tsx",
            terminal: "./src/terminal.js",
        },
    },
    html: {
        template: "./src/template.html",
    },
    server: {
        port: 3000,
        strictPort: true,
        setup: ({ action, server }) => {
            if (action === "dev") {
                server.middlewares.use(mockMiddlewares);
            }
        },
        publicDir: [
            {
                name: "public",
            },
        ],
        proxy: {
            "/api/ssh": {
                target: "ws://localhost:8080",
                ws: true,
                changeOrigin: true,
            },
            "/api": enableMock ? {
                target: "http://localhost:3000",
                changeOrigin: true,
                pathRewrite: { "^/api": "/mock_api" },
            } : {
                target: "http://localhost:8080",
                changeOrigin: true,
            },
        },
    },
    output: {
        assetPrefix: ".",
    },
    plugins: [pluginReact()],
    resolve: {
        alias: {
            "@": "./src",
            classnames: "clsx",
        },
    },
});
