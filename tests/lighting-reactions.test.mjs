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
test('ripples fill the keyboard before fading, including edge-origin presses', () => {
  const age = Math.hypot(16.5, 5.5) / 9 / 1.2 + 0.05;
  assert.equal(level('ripples', 0, 0, 0, 0, age, 3), 1);
  assert.equal(level('ripples', 16.5, 5.5, 0, 0, age, 3), 1);
  assert.equal(level('ripples', 16.5, 5.5, 0, 0, 4, 3), 0);
});
test('explode fills only the pressed row and then dissipates', () => {
  assert.equal(level('explode', 0, 2.2, 8, 2.2, 0.85, 3), 1);
  assert.equal(level('explode', 16.5, 2.2, 8, 2.2, 0.85, 3), 1);
  assert.equal(level('explode', 8, 3.2, 8, 2.2, 1, 3), 0);
  assert.equal(level('explode', 8, 2.2, 8, 2.2, 3, 3), 0);
});
