import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/block/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
