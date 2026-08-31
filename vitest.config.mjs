import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    testTimeout: 15000,
    // rules-тесты дёргают одну и ту же коллекцию — не параллелим на уровне файлов
    // (внутри файла vitest всё равно последователен).
    fileParallelism: false,
    hookTimeout: 20000,
  },
});
