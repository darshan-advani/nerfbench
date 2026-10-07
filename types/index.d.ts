export type Score = { model: string; provider: string; power: number }

declare module 'claude-code' {
  interface PluginState {
    'nerfbench-in-terminal': { scores: Score[] | null }
  }
}
