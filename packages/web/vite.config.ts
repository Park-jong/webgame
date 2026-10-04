import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// core는 dist가 아닌 src를 직접 참조한다 (core 빌드 순서와 무관하게 dev/build/test 동작)
const coreSrc = fileURLToPath(new URL("../core/src/index.ts", import.meta.url));
// 서버 프로토콜/뷰는 파일 단위로만 참조한다. 서버 index.ts는 ws를 import 하므로 절대 참조 금지.
const serverProtocol = fileURLToPath(new URL("../server/src/protocol.ts", import.meta.url));
const serverView = fileURLToPath(new URL("../server/src/view.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@mahjong/core": coreSrc,
      "@mahjong/server-protocol": serverProtocol,
      "@mahjong/server-view": serverView,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
