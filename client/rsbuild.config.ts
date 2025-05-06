import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

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
        publicDir: [
            {
                name: "public",
            },
        ],
        proxy: {
            '/api/term': {
                target: 'ws://localhost:8080',
                ws: true,
                changeOrigin: true,
            },
            "/api": {
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
        },
    }
});
