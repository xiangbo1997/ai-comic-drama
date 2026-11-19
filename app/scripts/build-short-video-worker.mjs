import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
// 复用已声明tsx依赖中的esbuild，仅构建时需要；运行产物不依赖tsx或全局命令。
const tsxRequire = createRequire(require.resolve("tsx"));
const { build } = await import(tsxRequire.resolve("esbuild"));
await build({
  entryPoints: [
    fileURLToPath(new URL("./short-video-worker.ts", import.meta.url)),
  ],
  outfile: fileURLToPath(
    new URL("../build/short-video-worker.cjs", import.meta.url)
  ),
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node22",
  format: "cjs",
  tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  sourcemap: false,
  logLevel: "info",
});
