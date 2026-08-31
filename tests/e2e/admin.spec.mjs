// Сценарий: доступ к админ-панели и logout работают.
import { test, expect } from '@playwright/test';
import {
  resetAuth, resetFirestore, createUser, fsSet,
} from './_setup.mjs';

test.beforeEach(async () => {
  await resetAuth();
  await resetFirestore();
});

async function loginAs(page, email, password = 'test12345') {
  await page.addInitScript(() => localStorage.setItem('cfd_use_emulator', '1'));
  await page.goto('/index.html');
  await page.evaluate(async ({ email, password }) => {
    await firebase.auth().signInWithEmailAndPassword(email, password);
  }, { email, password });
}

test('обычный студент на admin.html видит «Доступ запрещён»', async ({ page }) => {
  const s = await createUser('nonadm@t.ru');
  await fsSet(`users/${s.uid}`, { fio: 'Not admin', email: 'nonadm@t.ru' });
  await loginAs(page, 'nonadm@t.ru');
  await page.goto('/admin.html');
  await expect(page.locator('#denied')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#adminContent')).toBeHidden();
});

test('admin с managedCourses видит панель и вкладку «Гейтинг лекций»', async ({ page }) => {
  const a = await createUser('adm@t.ru');
  await fsSet(`users/${a.uid}`, {
    fio: 'Admin', email: 'adm@t.ru', isAdmin: true, managedCourses: ['nm'],
  });
  await loginAs(page, 'adm@t.ru');
  await page.goto('/admin.html');
  await expect(page.locator('#adminContent')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.tabs .tab', { hasText: 'Гейтинг лекций' })).toBeVisible();
  // кнопка «выйти» в шапке контента
  await expect(page.locator('#adminHeaderInfo button', { hasText: /выйти/i })).toBeVisible();
});

test('super всегда видит все курсы в селекте «Гейтинг»', async ({ page }) => {
  const su = await createUser('polinakozhurina2020@gmail.com');
  await fsSet(`users/${su.uid}`, {
    fio: 'Super', email: 'polinakozhurina2020@gmail.com',
    isAdmin: true, managedCourses: ['nm','sem1','sem2','mke','sph'],
  });
  await loginAs(page, 'polinakozhurina2020@gmail.com');
  await page.goto('/admin.html?tab=gating');
  await expect(page.locator('#tab-gating')).toBeVisible({ timeout: 8000 });
  const opts = page.locator('#gateCourseSel option');
  // 1 плейсхолдер + 5 курсов
  await expect(opts).toHaveCount(6);
});
