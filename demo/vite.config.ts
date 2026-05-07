import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@k1low/kakitori/block": resolve(
        __dirname,
        "../packages/core/src/block/index.ts",
      ),
      "@k1low/kakitori/page": resolve(
        __dirname,
        "../packages/core/src/page/index.ts",
      ),
      "@k1low/kakitori": resolve(__dirname, "../packages/core/src/index.ts"),
      "@k1low/kakitori-data": resolve(
        __dirname,
        "../packages/data/src/index.ts",
      ),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        debug: resolve(__dirname, "debug.html"),
        block: resolve(__dirname, "block.html"),
        page: resolve(__dirname, "page.html"),
      },
    },
  },
});
