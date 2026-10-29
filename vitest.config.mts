import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      BOT_TOKEN: "123456789:TEST_BOT_TOKEN_FOR_VITEST",
      NODE_ENV: "test",
      LOG_LEVEL: "fatal",
      DEFAULT_LOCALE: "en",
    },
  },
});
