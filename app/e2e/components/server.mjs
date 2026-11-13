import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 复用 Vitest 已安装的 Vite，不为测试增加依赖或修改生产路由。
const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(vitestRequire.resolve("vite"));
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("./", import.meta.url)),
  resolve: {
    alias: {
      "next/link": fileURLToPath(
        new URL("./link-fixture.tsx", import.meta.url)
      ),
      "next/image": fileURLToPath(
        new URL("./image-fixture.tsx", import.meta.url)
      ),
      "next/navigation": fileURLToPath(
        new URL("./navigation-fixture.ts", import.meta.url)
      ),
      "@/components/user-menu": fileURLToPath(
        new URL("./account-fixture.tsx", import.meta.url)
      ),
      "@/components/credits-display": fileURLToPath(
        new URL("./account-fixture.tsx", import.meta.url)
      ),
      "@": `${appRoot}src`,
    },
  },
  esbuild: { jsx: "automatic" },
  css: { postcss: appRoot },
  server: {
    host: "127.0.0.1",
    port: 4317,
    strictPort: true,
    fs: { allow: [appRoot] },
  },
});
await server.listen();
