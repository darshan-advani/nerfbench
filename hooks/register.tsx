import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { CHECK_MS, URL, canClaim, fetchOnStart, parseScores, segments } from './nerf'
import type { Cache, Score } from './nerf'

const CACHE = 'scores'

const shown = atom({ plugin: 'nerfbench-in-terminal', key: 'scores' } as const, null)

let inFlight: Promise<Score[]> | undefined

const cmux = async ($: EngineInterface, args: string[]) => {
  const bin = (await $.env.get('CMUX_CLAUDE_HOOK_CMUX_BIN')) ?? 'cmux'
  return $.process.run([bin, ...args], { timeoutMs: 30_000 })
}

// The page sits behind a Cloudflare check that turns away scripted fetches, so
// it is read through cmux's own browser in a tab opened and closed for this.
const fetchScores = async ($: EngineInterface): Promise<Score[]> => {
  const opened = await cmux($, ['browser', 'new', URL, '--focus', 'false'])
  const surface = /surface=(\S+)/.exec(opened.stdout)?.[1]
  if (!surface) throw new Error(`cmux browser: ${opened.stdout}${opened.stderr}`.trim())
  try {
    await cmux($, ['browser', surface, 'wait', '--load-state', 'complete', '--timeout', '25'])
    for (let tries = 0; tries < 10; tries++) {
      const { stdout } = await cmux($, ['browser', surface, 'get', 'text', '--selector', 'main'])
      const scores = parseScores(stdout)
      if (scores.length > 0) return scores
      await $.clock.sleep(1500)
    }
    throw new Error('no scores on the page')
  } finally {
    await cmux($, ['close-surface', '--surface', surface])
  }
}

const readCache = async ($: EngineInterface) => (await $.store.get(CACHE)) as Cache | undefined

const fetchAndCache = ($: EngineInterface) =>
  (inFlight ??= fetchScores($)
    .then(async scores => {
      await $.store.set(CACHE, { fetchedAt: Date.now(), scores } satisfies Cache)
      return scores
    })
    .finally(() => (inFlight = undefined)))

const show = async ($: EngineInterface, scores: Score[] | undefined) => {
  if (scores?.length) await update($, shown, () => scores)
}

// `force` fetches now (/nerfbench); otherwise only a stale cache this session
// claims first is fetched, so the other sessions keep showing the cache.
const refresh = async ($: EngineInterface, force = false) => {
  const cached = await readCache($)
  await show($, cached?.scores)
  if (!(await $.env.get('CMUX_WORKSPACE_ID'))) return
  if (!force && !inFlight) {
    if (!canClaim(cached, Date.now())) return
    await $.store.set(CACHE, { ...cached!, claimedAt: Date.now() })
  }
  try {
    await show($, await fetchAndCache($))
  } catch (error) {
    $.ui.toast(`nerfbench: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nerfbench',
      description: 'Refresh the Nerf Bench scores under the prompt and list every tracked model',
    })
    // Earlier versions used the cmux sidebar and the plain status line.
    void cmux($, ['clear-status', 'nerfbench'])
    $.ui.status(undefined)
    const cached = await readCache($)
    if (fetchOnStart(cached)) void refresh($)
    else await show($, cached?.scores)
    $.clock.every(CHECK_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'nerfbench' }, async $ => {
    await refresh($, true)
    const scores = (await readCache($))?.scores ?? []
    const rows = scores.map(one => `- ${one.model} (${one.provider}): ${one.power.toFixed(1)}%`).join('\n')

    return { text: `Nerf Bench (90–110% is normal variance), ${URL}\n${rows}` }
  })

  // The hint line under the prompt, with the scores after the engine's text.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const scores = await read($, shown)
    if (!scores) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        {e.props.hint && <Text dimColor>{e.props.hint}  </Text>}
        <Text dimColor>nerf</Text>
        {segments(scores).map(({ text, color }) => (
          <Text>
            <Text dimColor> · </Text>
            {color ? <Text color={color}>{text}</Text> : <Text dimColor>{text}</Text>}
          </Text>
        ))}
      </Box>
    )
  })
}
