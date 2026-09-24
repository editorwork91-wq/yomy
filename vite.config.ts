import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  // Huawei ART-L29 / Android 10 may use an older Chromium WebView.
  // Keep the existing UI and behavior, but emit broadly compatible JS/CSS.
  build: {
    target: 'chrome80',
    cssTarget: 'chrome80',
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
