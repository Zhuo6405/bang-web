import { decide } from '../ai/ai'
import { applyAction, getDecisions, startGame } from './engine'
import type { GameConfig, GameState } from './types'
import { viewFor } from './view'

export function makeConfig(n: number, seed: number, expansions: string[] = []): GameConfig {
  return { names: Array.from({ length: n }, (_, i) => `玩家${i + 1}`), ai: Array(n).fill(true), seed, expansions }
}

/** 全部交給 AI 打完一局，回傳最後狀態與步數 */
export function playOut(s: GameState, maxSteps = 20000): { state: GameState; steps: number } {
  let steps = 0
  while (!s.result && steps < maxSteps) {
    const d = getDecisions(s)[0]
    if (!d) throw new Error('沒有人可以行動，但遊戲還沒結束')
    s = applyAction(s, d.player, decide(viewFor(s, d.player)))
    steps++
  }
  return { state: s, steps }
}

export function simulate(n: number, seed: number) {
  return playOut(startGame(makeConfig(n, seed)), 6000)
}
