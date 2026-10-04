import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/db/**/*.test.ts"], fileParallelism: false, testTimeout: 15000, hookTimeout: 20000 } });
