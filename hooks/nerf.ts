export const URL = 'https://www.bridgebench.ai/nerf-bench'

// What the status line shows, in order: each slot is the newest model whose
// name matches, shown without its "Claude " prefix.
export const SLOTS = [
  { label: 'Opus', match: /^Claude Opus [\d.]+$/ },
  { label: 'Sonnet', match: /^Claude Sonnet [\d.]+$/ },
  { label: 'Astra', match: /^GPT-[\d.]+ Astra$/ },
  { label: 'Sol', match: /^GPT-[\d.]+ Sol$/ },
] as const

import type { Score } from '../types'

export type { Score }

// Page text lists each model as its name on its own line, the provider, an
// optional variance note, then the power line ("103.8%").
export const parseScores = (text: string): Score[] => {
  const lines = text.split('\n').map(line => line.trim())
  const scores: Score[] = []
  lines.forEach((line, i) => {
    const provider = lines[i + 1] ?? ''
    if (!/^(Anthropic|OpenAI|Google|xAI|DeepSeek|Meta|Mistral|Moonshot|Alibaba|Zhipu)$/.test(provider)) return
    for (const next of lines.slice(i + 2, i + 5)) {
      const power = /^(\d+(?:\.\d+)?)%$/.exec(next)
      if (power) {
        scores.push({ model: line, provider, power: Number(power[1]) })
        return
      }
    }
  })

  return scores
}

export const MAX_AGE_MS = 6 * 60 * 60 * 1000
// How often a running session checks whether the cache has gone stale.
export const CHECK_MS = 15 * 60 * 1000
// How long one session's claim on a fetch holds off the others.
const CLAIM_MS = 2 * 60 * 1000

export type Cache = { fetchedAt: number; scores: Score[]; claimedAt?: number }

// Fetching opens the page in a cmux browser tab, so opening a session never
// fetches unless nothing was ever cached: it shows the last scores, however
// old, and the background check refreshes them once they are stale, in
// whichever session claims the fetch first.
export const fetchOnStart = (cache: Cache | undefined) => !cache?.scores?.[0]?.provider

export const isStale = (cache: Cache | undefined, now: number) =>
  fetchOnStart(cache) || now - cache!.fetchedAt >= MAX_AGE_MS

export const canClaim = (cache: Cache | undefined, now: number) =>
  isStale(cache, now) && !(cache?.claimedAt && now - cache.claimedAt < CLAIM_MS)

const version = (model: string) => Number(/\d+(?:\.\d+)?/.exec(model)?.[0] ?? 0)

export const latestBySlot = (scores: Score[]) =>
  SLOTS.map(({ label, match }) => ({
    label,
    score: scores.filter(one => match.test(one.model)).sort((a, b) => version(b.model) - version(a.model))[0],
  }))

export type Segment = { text: string; color?: 'green' | 'yellow' }

// Green at 90% and up, yellow below; an untracked slot has no color.
export const segments = (scores: Score[]): Segment[] =>
  latestBySlot(scores).map(({ label, score }) =>
    score
      ? { text: `${score.model.replace(/^Claude /, '')} ${score.power.toFixed(1)}%`, color: score.power < 90 ? 'yellow' : 'green' }
      : { text: `${label} —` },
  )
