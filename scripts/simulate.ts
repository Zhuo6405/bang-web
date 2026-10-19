import { simulate } from '../src/engine/sim'

// 用法：npx tsx scripts/simulate.ts 局數 [擴充,擴充]
const N = Number(process.argv[2] ?? 200)
const exps = (process.argv[3] ?? '').split(',').filter(Boolean)
const wins: Record<string, number> = {}
let steps = 0
let unfinished = 0
for (let i = 0; i < N; i++) {
  const n = 4 + (i % (exps.includes('dodge_city') ? 5 : 4))
  try {
    const r = simulate(n, i + 1, exps)
    steps += r.steps
    if (!r.state.result) unfinished++
    const k = `${n}人-${r.state.result?.side ?? '未結束'}`
    wins[k] = (wins[k] ?? 0) + 1
  } catch (e) {
    console.log(`第 ${i + 1} 局（${n} 人）出錯：`, (e as Error).message)
    console.log((e as Error).stack?.split('\n').slice(1, 6).join('\n'))
    process.exit(1)
  }
}
console.log(wins, '平均步數', Math.round(steps / N), '未結束', unfinished)
