import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"],
      manifest: {
        id: "/",
        name: "Write",
        short_name: "Write",
        description: "A quiet place for your ideas.",
        theme_color: "#101010",
        background_color: "#101010",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        lang: "en",
        categories: ["productivity", "utilities"],
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/i\//, /^\/s\//],
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico,webmanifest}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5190,
    proxy: {
      "/api": "http://localhost:4871",
      "/i": "http://localhost:4871",
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
  },
});
