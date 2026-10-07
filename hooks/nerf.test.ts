import { expect, test } from 'claude-code/testing'

import { MAX_AGE_MS, canClaim, fetchOnStart, isStale, parseScores, segments } from './nerf'

const PAGE = `Models
GPT-6 Astra
OpenAI
Normal variance: +1.1% vs launch
101.1%
110%105%100%95%90%
GPT-6 Astra tests
Claude Opus 5.5
Anthropic
Normal variance: +3.8% vs launch
103.8%
110%105%100%95%90%
Claude Opus 5.5 tests
Tested	Power	Versus launch
Sep 22	100.0%	Launch`

test('parses each model card, not the test tables', () => {
  expect(parseScores(PAGE)).toEqual([
    { model: 'GPT-6 Astra', provider: 'OpenAI', power: 101.1 },
    { model: 'Claude Opus 5.5', provider: 'Anthropic', power: 103.8 },
  ])
})

test('shows Opus, Fable, Astra and Sol, untracked without color', () => {
  expect(segments(parseScores(PAGE))).toEqual([
    { text: 'Opus 5.5 103.8%', color: 'green' },
    { text: 'Fable —' },
    { text: 'GPT-6 Astra 101.1%', color: 'green' },
    { text: 'Sol —' },
  ])
})

test('takes the newest version per slot; yellow below 90%', () => {
  const scores = [
    { model: 'Claude Opus 5', provider: 'Anthropic', power: 99 },
    { model: 'Claude Opus 5.5', provider: 'Anthropic', power: 85 },
    { model: 'Claude Fable 5', provider: 'Anthropic', power: 95 },
    { model: 'Claude Fable 5.1', provider: 'Anthropic', power: 102.4 },
    { model: 'GPT-6.1 Sol', provider: 'OpenAI', power: 90 },
    { model: 'Claude Sonnet 5.5', provider: 'Anthropic', power: 70 },
  ]
  expect(segments(scores)).toEqual([
    { text: 'Opus 5.5 85.0%', color: 'yellow' },
    { text: 'Fable 5.1 102.4%', color: 'green' },
    { text: 'Astra —' },
    { text: 'GPT-6.1 Sol 90.0%', color: 'green' },
  ])
})

test('a session start fetches only when nothing was ever cached', () => {
  const now = 10 * MAX_AGE_MS
  const old = { fetchedAt: 0, scores: [{ model: 'Claude Opus 5.5', provider: 'Anthropic', power: 100 }] }
  expect(fetchOnStart(undefined)).toBe(true)
  expect(fetchOnStart(old)).toBe(false)
  expect(isStale(old, now)).toBe(true)
  expect(isStale({ ...old, fetchedAt: now - 1000 }, now)).toBe(false)
})

test('one session claims a stale fetch; others wait out the claim', () => {
  const now = 10 * MAX_AGE_MS
  const old = { fetchedAt: 0, scores: [{ model: 'Claude Opus 5.5', provider: 'Anthropic', power: 100 }] }
  expect(canClaim(old, now)).toBe(true)
  expect(canClaim({ ...old, claimedAt: now - 1000 }, now)).toBe(false)
  expect(canClaim({ ...old, claimedAt: now - 5 * 60 * 1000 }, now)).toBe(true)
})
