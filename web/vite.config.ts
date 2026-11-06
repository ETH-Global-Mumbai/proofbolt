import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    rollupOptions: {
      input: {
        kiosk: resolve(__dirname, "kiosk.html"),
        owner: resolve(__dirname, "owner.html"),
        status: resolve(__dirname, "status.html"),
      },
    },
  },
});
