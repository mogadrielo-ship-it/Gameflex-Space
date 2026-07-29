import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCountDelta, readSavedPosts, writeSavedPosts } from './social-analytics.ts';

test('applyCountDelta keeps counts non-negative and supports increments', () => {
  assert.equal(applyCountDelta(3, 1), 4);
  assert.equal(applyCountDelta(0, -1), 0);
  assert.equal(applyCountDelta(null, 2), 2);
});

test('saved posts persistence round-trips through storage', () => {
  const storage = new Map();
  const setItem = (key, value) => storage.set(key, value);
  const getItem = (key) => storage.get(key) ?? null;
  const removeItem = (key) => storage.delete(key);

  const saved = writeSavedPosts({ setItem, getItem, removeItem }, 'user-1', ['a', 'b']);
  assert.deepEqual(saved, ['a', 'b']);
  assert.deepEqual(readSavedPosts({ setItem, getItem, removeItem }, 'user-1'), ['a', 'b']);
});
