// Сценарий: гейтинг лекций работает согласно роли и enrollment.
import { test, expect } from '@playwright/test';
import {
  enableEmulatorAnon, resetAuth, resetFirestore,
  createUser, fsSet,
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

test('не-enrolled студент видит «Запишитесь» на странице лекции', async ({ page }) => {
  const stu = await createUser('stu1@t.ru');
  await fsSet(`users/${stu.uid}`, { fio: 'Stu 1', email: 'stu1@t.ru' });
  await loginAs(page, 'stu1@t.ru');
  await page.goto('/nm/w01.html');
  const blocker = page.locator('.gating-blocker');
  await expect(blocker).toBeVisible({ timeout: 8000 });
  await expect(blocker).toContainText(/Запишитесь|Запишись|Запишит/i);
});

test('enrolled студент видит «закрыта» пока лекция не открыта', async ({ page }) => {
  const stu = await createUser('stu2@t.ru');
  await fsSet(`users/${stu.uid}`, { fio: 'Stu 2', email: 'stu2@t.ru' });
  await fsSet(`enrollments/${stu.uid}_nm`, {
    uid: stu.uid, courseId: 'nm', status: 'approved', requestedAt: new Date(),
  });
  await loginAs(page, 'stu2@t.ru');
  await page.goto('/nm/w01.html');
  const blocker = page.locator('.gating-blocker');
  await expect(blocker).toBeVisible({ timeout: 8000 });
  await expect(blocker).toContainText(/закрыта|откр/i);
});

test('enrolled студент видит лекцию, если releasedAt в прошлом', async ({ page }) => {
  const stu = await createUser('stu3@t.ru');
  await fsSet(`users/${stu.uid}`, { fio: 'Stu 3', email: 'stu3@t.ru' });
  await fsSet(`enrollments/${stu.uid}_nm`, {
    uid: stu.uid, courseId: 'nm', status: 'approved', requestedAt: new Date(),
  });
  await fsSet('lectures/nm_w01', {
    courseId: 'nm', lectureId: 'w01', releasedAt: new Date(Date.now() - 3600_000),
  });
  await loginAs(page, 'stu3@t.ru');
  await page.goto('/nm/w01.html');
  // Дожидаемся, пока gating.js закончит async-цепочку проверки доступа.
  await page.waitForFunction(() => typeof CFDGating !== 'undefined');
  await page.waitForTimeout(1500);
  await expect(page.locator('.gating-blocker')).toHaveCount(0);
});

test('super видит лекцию всегда, даже без releasedAt', async ({ page }) => {
  const su = await createUser('polinakozhurina2020@gmail.com');
  await fsSet(`users/${su.uid}`, {
    fio: 'Polina', email: 'polinakozhurina2020@gmail.com', isAdmin: true, managedCourses: ['nm','sem1','sem2','mke','sph'],
  });
  await loginAs(page, 'polinakozhurina2020@gmail.com');
  await page.goto('/nm/w01.html');
  // Дожидаемся, пока gating.js закончит async-цепочку проверки доступа.
  await page.waitForFunction(() => typeof CFDGating !== 'undefined');
  await page.waitForTimeout(1500);
  await expect(page.locator('.gating-blocker')).toHaveCount(0);
});
