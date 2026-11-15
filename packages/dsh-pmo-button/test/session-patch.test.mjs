/**
 * Unit tests for the session-menu patch composition (issues #4 and #5).
 *
 * #5: a rounds edit used to submit `provider:''/model:''` as well, wiping the
 *     session's model override whenever the model catalog had not loaded yet.
 * #4: an empty rounds box was dropped from the wire, so the server never saw a
 *     request to clear the override ("留空 = 继承全局" was a lie).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effortPatch, modelPatch, roundsPatch } from '../lib/session-patch.js'

test('a rounds edit carries only maxRounds (issue #5)', () => {
  assert.deepEqual(roundsPatch('6'), { maxRounds: 6 })
  // An untouched/empty field must not smuggle provider/model along: the patch has
  // exactly one key, so the server cannot delete an override it never heard about.
  assert.deepEqual(Object.keys(roundsPatch('9')), ['maxRounds'])
})

test('an empty rounds box clears the override instead of leaving it (issue #4)', () => {
  assert.deepEqual(roundsPatch(''), { maxRounds: 0 })
  assert.deepEqual(roundsPatch('   '), { maxRounds: 0 })
  // 0 is the documented "inherit the global cap" value on the host side.
  const patch = roundsPatch('')
  assert.equal(patch.maxRounds, 0)
})

test('rounds parsing clamps junk to a non-negative integer', () => {
  assert.deepEqual(roundsPatch('-3'), { maxRounds: 0 })
  assert.deepEqual(roundsPatch('abc'), { maxRounds: 0 })
  assert.deepEqual(roundsPatch('7.8'), { maxRounds: 7 })
})

test('the model and effort controls each deliver their own field only', () => {
  assert.deepEqual(modelPatch('qwen|qwen3.8'), { provider: 'qwen', model: 'qwen3.8' })
  assert.deepEqual(modelPatch(''), { provider: '', model: '' })
  assert.deepEqual(Object.keys(effortPatch('high')), ['effort'])
  assert.deepEqual(effortPatch(''), { effort: '' })
})
