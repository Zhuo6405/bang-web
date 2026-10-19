import { simulate } from '../src/engine/sim'

const wins: Record<string, number> = {}
let steps = 0
const N = Number(process.argv[2] ?? 200)
for (let i = 0; i < N; i++) {
  const n = 4 + (i % 4)
  const r = simulate(n, i + 1)
  steps += r.steps
  const k = `${n}人-${r.state.result?.side ?? '未結束'}`
  wins[k] = (wins[k] ?? 0) + 1
}
console.log(wins, '平均步數', Math.round(steps / N))
