import { defineConfig } from "vitest/config";

export default defineConfig({
  // 相対パスで出力し、GitHub Pages のサブパス（/voice-recorder/）でも動くようにする
  base: "./",
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
