# nerfbench-in-terminal

Shows [BridgeBench Nerf Bench](https://www.bridgebench.ai/nerf-bench) scores on the hint line under the prompt, in Claude Code and OpenCode:

```
nerf · Opus 5.5 103.8% · Fable 5.1 102.4% · GPT-6 Astra 101.1% · GPT-6.1 Sol 100.0%
```

A score is green at 90% and up and yellow below that. `/nerfbench` fetches fresh scores and lists every model on the page.

## How it gets the scores

The page is behind a Cloudflare check that blocks scripted fetches, so the mod reads it through [cmux](https://cmux.dev)'s built-in browser. It opens the page in a background tab, reads the text and closes the tab. That means it only fetches inside cmux, and the cmux browser has to be on (`cmux browser enable`).

- Scores are cached for 6 hours.
- Opening a new session never opens the page. It shows the cached scores, even old ones. The only exception is when nothing has been cached yet.
- Each running session checks the cache every 15 minutes. When the cache has gone stale, the first session to claim the refresh fetches it and the others wait.

## Install (Claude Code)

```
/plugin install nerfbench-in-terminal --marketplace darshan-advani/nerfbench-in-terminal
```

To work on it from a clone instead, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (under `env`), or start Claude Code with `claude --plugin-dir <clone>`.

Change which models show up by editing `SLOTS` in `hooks/nerf.ts`.

## Install (OpenCode 2.x)

```sh
mkdir -p ~/.config/opencode/plugins/nerfbench
ln -s "$PWD/opencode/tui.tsx" ~/.config/opencode/plugins/nerfbench/tui.tsx
ln -s "$PWD/hooks/nerf.ts" ~/.config/opencode/plugins/nerfbench/nerf.ts
```

Both ports share `hooks/nerf.ts`, which holds the parser, the slots and the refresh rules. The OpenCode port keeps its cache in `~/.cache/nerfbench/opencode.json`.

## Tests

```sh
claude plugin validate .
claude plugin test .
```
