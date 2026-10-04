import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// core는 dist가 아닌 src를 직접 참조한다 (core 빌드 순서와 무관하게 test 동작)
const coreSrc = fileURLToPath(new URL("../core/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@mahjong/core": coreSrc } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
