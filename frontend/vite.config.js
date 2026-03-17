import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const allowedHosts = env.VITE_ALLOWED_HOSTS
    ? env.VITE_ALLOWED_HOSTS.split(",")
    : [];

  return {
    plugins: [react()],

    // IMPORTANT for ffmpeg.wasm
    optimizeDeps: {
      exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
    },

    server: {
      host: "0.0.0.0",
      port: process.env.PORT || 5000,
      allowedHosts,

      // 🔥 REQUIRED for SharedArrayBuffer (FFmpeg)
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },

    preview: {
      // 🔥 ALSO REQUIRED for production preview
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
    },

    build: {
      target: "esnext", // important for WASM compatibility
    },

    // 🔥 Prevent worker / wasm issues in some environments
    worker: {
      format: "es",
    },
  };
});