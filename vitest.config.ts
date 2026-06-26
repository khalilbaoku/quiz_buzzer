import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["realtime-server/src/**/*.test.ts"],
  },
});
