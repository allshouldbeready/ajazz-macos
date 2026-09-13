import test from 'node:test';
import assert from 'node:assert/strict';
import { reactionLevel as level } from '../src/lighting-reactions.ts';

test('launch creates symmetric narrow bars across all rows', () => {
  const age = 2 / (8 * 1.2);
  for (const y of [0, 2.2, 5.35]) {
    assert.equal(level('launch', 6, y, 8, 2.2, age, 3), 1);
    assert.equal(level('launch', 10, y, 8, 2.2, age, 3), 1);
    assert.equal(level('launch', 8, y, 8, 2.2, age, 3), 0);
    assert.equal(level('launch', 11, y, 8, 2.2, age, 3), 0);
  }
});
test('ripples have a half-keyboard lit band followed by an off wave', () => {
  const reach = Math.hypot(16.5, 5.5);
  const age = 12 * 0.8 / (reach + 8.25 + 0.4);
  assert.equal(level('ripples', 2, 0, 0, 0, age, 3), 0);
  assert.equal(level('ripples', 5, 0, 0, 0, age, 3), 1);
  assert.equal(level('ripples', 11, 0, 0, 0, age, 3), 1);
  assert.equal(level('ripples', 13, 0, 0, 0, age, 3), 0);
});
test('ripples reach and switch off even distant keys within one second', () => {
  const reach = Math.hypot(16.5, 5.5);
  const arrival = (reach + 0.4) * 0.8 / (reach + 8.25 + 0.4);
  assert.ok(level('ripples', 16.5, 5.5, 0, 0, arrival, 3) > 0.99);
  assert.equal(level('ripples', 0, 0, 0, 0, 0.81, 3), 0);
  assert.equal(level('ripples', 16.5, 5.5, 0, 0, 0.81, 3), 0);
});
test('explode fills only the pressed row and then dissipates', () => {
  assert.equal(level('explode', 0, 2.2, 8, 2.2, 0.85, 3), 1);
  assert.equal(level('explode', 16.5, 2.2, 8, 2.2, 0.85, 3), 1);
  assert.equal(level('explode', 8, 3.2, 8, 2.2, 1, 3), 0);
  assert.equal(level('explode', 8, 2.2, 8, 2.2, 3, 3), 0);
});
