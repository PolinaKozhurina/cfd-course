// Смоки-сценарии — самое общее «сайт живой».
import { test, expect } from '@playwright/test';
import { enableEmulatorAnon, resetAuth, resetFirestore } from './_setup.mjs';

test.beforeEach(async () => {
  await resetAuth();
  await resetFirestore();
});

test('главная страница загружается без ошибок JS', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  await enableEmulatorAnon(page);
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/CFD|курс/i);
  // Курсы отображаются (5 блоков)
  await expect(page.locator('.course-block[data-course]')).toHaveCount(5);
  expect(jsErrors).toEqual([]);
});

test('гейтинг: не залогин → страница лекции показывает блокер «Войдите»', async ({ page }) => {
  await enableEmulatorAnon(page);
  await page.goto('/nm/w01.html');
  // Оверлей должен появиться (js/gating.js enforceLecturePage)
  const blocker = page.locator('.gating-blocker');
  await expect(blocker).toBeVisible({ timeout: 8000 });
  await expect(blocker).toContainText(/Войдите|Войти/);
});

test('справочная страница nm/python-reference.html — блокера НЕТ', async ({ page }) => {
  await enableEmulatorAnon(page);
  await page.goto('/nm/python-reference.html');
  // ждём загрузки скриптов и не показывается блокер
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.gating-blocker')).toHaveCount(0);
});

test('обзорная страница курса /nm/index.html — тоже без блокера', async ({ page }) => {
  await enableEmulatorAnon(page);
  await page.goto('/nm/index.html');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.gating-blocker')).toHaveCount(0);
});
