import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/block/index.ts", "src/page/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
