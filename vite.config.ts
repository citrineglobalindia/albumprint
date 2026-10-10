import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vendor chunking keeps every chunk well under ~500 kB and lets the browser cache libraries across deploys.
// recharts (+ d3 / victory-vendor) live in their own chunk that only chart pages (Dashboard, Pipeline, Reports…) request.
const vendorChunk = (id: string): string | undefined => {
  if (!id.includes("node_modules")) return undefined;
  if (/node_modules\/(recharts|recharts-scale|d3-[^/]+|victory-vendor|internmap|decimal\.js-light|reselect|immer|@reduxjs|redux|redux-thunk|use-sync-external-store|es-toolkit|eventemitter3|tiny-invariant|react-redux)\//.test(id)) return "charts";
  if (/node_modules\/(react-router|react-router-dom|@remix-run|cookie|set-cookie-parser)\//.test(id)) return "router";
  if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
  if (/node_modules\/lucide-react\//.test(id)) return "icons";
  return undefined;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: { output: { manualChunks: vendorChunk } },
  },
});
