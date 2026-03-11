import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    base: "/tools/influencer/",
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: ["influencer.reddithunter.com", "www.x-jumper.com", "x-jumper.com"],
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      allowedHosts: ["influencer.reddithunter.com", "www.x-jumper.com", "x-jumper.com"],
    },
    plugins: [react()],
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
  };
});