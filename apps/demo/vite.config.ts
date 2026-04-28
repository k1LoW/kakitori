import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@k1low/kakitori": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@k1low/kakitori-data": resolve(
        __dirname,
        "../../packages/data/src/index.ts",
      ),
    },
  },
});
