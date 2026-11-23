import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs on :8000 and is proxied so cookies stay same-origin.
// `vite --mode e2e` uses the throwaway test API on :8020 (see apps/api/e2e) on port 5180.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: mode === "e2e" ? 5180 : 5173,
    strictPort: mode === "e2e",
    proxy: { "/api": { target: mode === "e2e" ? "http://127.0.0.1:8020" : "http://127.0.0.1:8000", changeOrigin: false } },
  },
  // `vite preview` serves the built site for the public link (Cloudflare Tunnel); /api goes to the local API.
  preview: {
    port: 4173,
    strictPort: true,
    host: "127.0.0.1",
    allowedHosts: [".trycloudflare.com"],
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    outDir: "dist",
    rollupOptions: {
      output: {
        // Libraries change rarely, so they get their own long-cached files; app updates only re-download app code.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return "vendor-motion";
          if (/[\\/]@tanstack[\\/]/.test(id)) return "vendor-query";
          return "vendor";
        },
      },
    },
  },
}));
