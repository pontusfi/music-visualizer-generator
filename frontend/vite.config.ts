import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // one origin in the browser, so uploads and SSE need no CORS dance
    proxy: {
      "/api": { target: API, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
