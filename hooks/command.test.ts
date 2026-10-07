import { expect, test } from 'claude-code/testing'

const cache = { fetchedAt: Date.now(), scores: [{ model: 'Claude Opus 5.5', provider: 'Anthropic', power: 103.8 }] }

// Outside cmux nothing is fetched, so the command lists the cached scores.
test('/nerfbench answers with the cached scores', async ($, on) => {
  on('store.get', () => ({ value: cache }))
  on('env.get', () => ({ value: undefined }))
  const { text } = await $.command.run({ command: 'nerfbench' })
  expect(text).toContain('Claude Opus 5.5 (Anthropic): 103.8%')
})
