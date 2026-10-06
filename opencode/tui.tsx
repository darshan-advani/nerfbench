// OpenCode port of the Claude Code mod in this repo; symlink this file into
// ~/.config/opencode/plugins/nerfbench/ along with nerf.ts.
// nerf.ts is a symlink to that mod's parser, so SLOTS and parsing stay shared.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { TextAttributes } from '@opentui/core'
import { createSignal, For, Show } from 'solid-js'

import { CHECK_MS, URL, canClaim, fetchOnStart, parseScores, segments } from './nerf'
import type { Cache, Score } from './nerf'

const CACHE = join(homedir(), '.cache', 'nerfbench', 'opencode.json')
const CMUX = process.env.CMUX_BUNDLED_CLI_PATH ?? 'cmux'

const [scores, setScores] = createSignal<Score[] | undefined>()
let inFlight: Promise<Score[]> | undefined

const cmux = async (args: string[]) => {
  const proc = Bun.spawn([CMUX, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), 30_000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  await proc.exited
  return { stdout, stderr }
}

// The page sits behind a Cloudflare check that turns away scripted fetches, so
// it is read through cmux's own browser in a tab opened and closed for this.
const fetchScores = async (): Promise<Score[]> => {
  const opened = await cmux(['browser', 'new', URL, '--focus', 'false'])
  const surface = /surface=(\S+)/.exec(opened.stdout)?.[1]
  if (!surface) throw new Error(`cmux browser: ${opened.stdout}${opened.stderr}`.trim())
  try {
    await cmux(['browser', surface, 'wait', '--load-state', 'complete', '--timeout', '25'])
    for (let tries = 0; tries < 10; tries++) {
      const { stdout } = await cmux(['browser', surface, 'get', 'text', '--selector', 'main'])
      const found = parseScores(stdout)
      if (found.length > 0) return found
      await Bun.sleep(1500)
    }
    throw new Error('no scores on the page')
  } finally {
    await cmux(['close-surface', '--surface', surface])
  }
}

const readCache = async () =>
  (JSON.parse(await readFile(CACHE, 'utf8').catch(() => 'null')) ?? undefined) as Cache | undefined

const writeCache = async (cache: Cache) => {
  await mkdir(dirname(CACHE), { recursive: true })
  await writeFile(CACHE, JSON.stringify(cache))
}

const fetchAndCache = () =>
  (inFlight ??= fetchScores()
    .then(async found => {
      await writeCache({ fetchedAt: Date.now(), scores: found })
      return found
    })
    .finally(() => (inFlight = undefined)))

type Api = any

// `force` fetches now (/nerfbench); otherwise only a stale cache this process
// claims first is fetched, so other sessions keep showing the cache.
const refresh = async (api: Api, force = false) => {
  const cached = await readCache()
  if (cached?.scores?.length) setScores(cached.scores)
  if (!process.env.CMUX_WORKSPACE_ID) return
  if (!force && !inFlight) {
    if (!canClaim(cached, Date.now())) return
    await writeCache({ ...cached!, claimedAt: Date.now() })
  }
  try {
    setScores(await fetchAndCache())
  } catch (error) {
    api.ui.toast.show({ variant: 'warning', title: 'nerfbench', message: error instanceof Error ? error.message : String(error) })
  }
}

// Same line as Claude Code: "nerf · Opus 5.5 103.8% · GPT-6 Astra 101.1% · …",
// green at 90% and up, yellow below, untracked slots muted.
const Line = (props: { api: Api }) => {
  const theme = () => props.api.theme
  const fg = (color?: 'green' | 'yellow') =>
    color === 'green' ? theme().text.feedback.success.base : color === 'yellow' ? theme().text.feedback.warning.base : theme().text.muted

  const row = (items: ReturnType<typeof segments>, first: boolean) => (
    <box flexDirection="row" flexShrink={0} paddingLeft={first ? 0 : 'nerf · '.length}>
      {first && <text fg={theme().text.muted}>nerf</text>}
      <For each={items}>
        {({ text, color }, i) => (
          <text>
            {(first || i() > 0) && <span style={{ fg: theme().text.muted }}> · </span>}
            {color ? (
              // Model name bold in the theme's main text color, score keeps its color.
              <>
                <span style={{ fg: theme().text.base, attributes: TextAttributes.BOLD }}>{text.slice(0, text.lastIndexOf(' '))}</span>
                <span style={{ fg: fg(color) }}>{text.slice(text.lastIndexOf(' '))}</span>
              </>
            ) : (
              <span style={{ fg: fg(color) }}>{text}</span>
            )}
          </text>
        )}
      </For>
    </box>
  )

  // The home prompt is narrower than the session one, so there the line wraps
  // after two scores, the rest lined up under the first score.
  const home = () => props.api.ui.router.current()?.type !== 'session'

  return (
    <Show when={scores()?.length}>
      <Show when={home()} fallback={row(segments(scores()!), true)}>
        <box flexDirection="column" flexShrink={0}>
          {row(segments(scores()!).slice(0, 2), true)}
          {row(segments(scores()!).slice(2), false)}
        </box>
      </Show>
    </Show>
  )
}

// Keymap layers are hooks, so the /nerfbench command lives in a component
// mounted in the app slot (the same way OpenCode's own /plugins does it).
const Command = (props: { api: Api }) => {
  props.api.keymap.layer(() => ({
    mode: 'global',
    commands: [
      {
        id: 'nerfbench.refresh',
        title: 'Nerf Bench: refresh scores',
        group: 'Plugins',
        slash: { name: 'nerfbench' },
        palette: true,
        async run() {
          await refresh(props.api, true)
          const rows = (scores() ?? []).map(one => `${one.model} (${one.provider}): ${one.power.toFixed(1)}%`).join('\n')
          await props.api.ui.dialog.alert({ title: 'Nerf Bench (90–110% is normal variance)', message: `${rows}\n\n${URL}` })
        },
      },
    ],
  }))

  return null
}

export default {
  id: 'nerfbench',
  setup(api: Api) {
    api.ui.slot({ append: 'prompt.footer', render: () => <Line api={api} /> })
    api.ui.slot({ append: 'app', render: () => <Command api={api} /> })
    void readCache().then(cached => (fetchOnStart(cached) ? refresh(api) : setScores(cached!.scores)))
    setInterval(() => void refresh(api), CHECK_MS).unref?.()
  },
}
