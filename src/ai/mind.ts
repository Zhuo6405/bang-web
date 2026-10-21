import { ROLE_SETUP } from '../engine/data'
import type { Role } from '../engine/types'
import type { GameView, PublicPlayer } from '../engine/view'

/**
 * 電腦玩家的「心思」：像真人一樣猜身分、決定要不要開槍。
 *
 * 1. 猜身分：對每個看不到身分的人，估計他是副警長／歹徒／叛徒的機率。
 *    起點是「還沒公開的身分有幾個」，再用大家看得到的行為（誰打誰、誰幫誰）去修正。
 *    電腦知道自己的身分，所以「誰打了我」對它也是線索。
 * 2. 決定敵友：依自己的身分，把機率換成「他是敵人的把握」。
 * 3. 要不要開槍：把握夠才打；再加上人性的考量──誰打過我（記仇）、
 *    對方快死了（補刀）、對方剛打了警長（保護警長）──最後帶一點隨機，不會每次都一樣。
 */

export type Level = 'easy' | 'normal' | 'hard'
type Unknown = 'deputy' | 'outlaw' | 'renegade'
type Belief = Record<Unknown, number>
const UNKNOWN: Unknown[] = ['deputy', 'outlaw', 'renegade']

/** 各身分「對某身分出手」的可能性（越大越像會做這件事） */
const HOSTILE: Record<Unknown, Record<Role, number>> = {
  deputy: { sheriff: 0.03, deputy: 0.25, outlaw: 1, renegade: 0.6 },
  outlaw: { sheriff: 1, deputy: 0.85, outlaw: 0.2, renegade: 0.5 },
  renegade: { sheriff: 0.25, deputy: 0.55, outlaw: 0.9, renegade: 0.5 },
}
/** 各身分「幫某身分」的可能性（請喝酒、拆監獄、用幽靈救人） */
const HELP: Record<Unknown, Record<Role, number>> = {
  deputy: { sheriff: 1, deputy: 0.9, outlaw: 0.15, renegade: 0.4 },
  outlaw: { sheriff: 0.1, deputy: 0.2, outlaw: 1, renegade: 0.4 },
  renegade: { sheriff: 0.7, deputy: 0.4, outlaw: 0.3, renegade: 0.5 },
}
/** 被警長打：警長懷疑他（警長也會看錯，所以只是弱線索） */
const SHOT_BY_SHERIFF: Belief = { deputy: 0.6, outlaw: 1, renegade: 0.8 }

const LEVEL = {
  // 新手：只看「誰打警長」「誰打我」，不做連鎖推理；判斷很飄
  easy: { chain: false, balance: false, temp: 0.45, grudge: 0.15, finish: 0.05, sloppy: 0.3 },
  // 普通：完整推理，會記仇，偶爾手滑
  normal: { chain: true, balance: true, temp: 0.18, grudge: 0.2, finish: 0.12, sloppy: 0.08 },
  // 困難：完整推理、會用人數推算、很少失手、懂得補刀
  hard: { chain: true, balance: true, temp: 0.06, grudge: 0.12, finish: 0.2, sloppy: 0 },
} as const

export const levelOf = (v: GameView): Level => v.aiLevel ?? 'normal'
export const settings = (v: GameView) => LEVEL[levelOf(v)]

interface Mind {
  belief: Map<number, Belief>
  /** 每個人的隨機擾動（同一個決定內固定，不會一下想打 A 一下想打 B） */
  noise: Map<number, number>
}
const cache = new WeakMap<GameView, Mind>()

function mind(v: GameView): Mind {
  const hit = cache.get(v)
  if (hit) return hit
  const m: Mind = { belief: guess(v), noise: new Map() }
  const t = settings(v).temp
  for (const p of v.players) m.noise.set(p.seat, gumbel() * t)
  cache.set(v, m)
  return m
}

function gumbel() {
  const u = Math.min(0.999999, Math.max(1e-6, Math.random()))
  return -Math.log(-Math.log(u)) - 0.577
}

/** 還沒公開、也不是自己的身分各剩幾個 */
function hiddenCounts(v: GameView): Belief {
  const setup = ROLE_SETUP[v.players.length] ?? []
  const left: Belief = { deputy: 0, outlaw: 0, renegade: 0 }
  for (const r of setup) if (r !== 'sheriff') left[r]++
  for (const p of v.players) {
    const r = p.seat === v.me ? v.players[v.me].role : p.role
    if (r && r !== 'sheriff') left[r]--
  }
  for (const r of UNKNOWN) left[r] = Math.max(0, left[r])
  return left
}

/** 猜每個看不到身分的人 */
function guess(v: GameView): Map<number, Belief> {
  const lv = settings(v)
  const unknown = v.players.filter((p) => p.seat !== v.me && !p.role)
  const counts = hiddenCounts(v)
  const total = UNKNOWN.reduce((a, r) => a + counts[r], 0) || 1
  const prior: Belief = { deputy: counts.deputy / total, outlaw: counts.outlaw / total, renegade: counts.renegade / total }
  let bel = new Map<number, Belief>(unknown.map((p) => [p.seat, { ...prior }]))
  const rel = v.rel
  if (!rel?.length) return bel

  // 某人身分的機率分布（自己、已公開的人是確定的）
  const dist = (q: number): Partial<Record<Role, number>> => {
    const r = q === v.me ? v.players[v.me].role : v.players[q].role
    if (r) return { [r]: 1 }
    return bel.get(q) ?? prior
  }
  const known = (q: number) => q === v.me || !!v.players[q].role

  const rounds = lv.chain ? 4 : 1
  for (let it = 0; it < rounds; it++) {
    const next = new Map<number, Belief>()
    for (const p of unknown) {
      const q = p.seat
      const logL: Belief = { deputy: 0, outlaw: 0, renegade: 0 }
      for (let b = 0; b < rel.length; b++) {
        if (b === q) continue
        // q 對 b 做的事
        const w = rel[q][b]
        if (w && (lv.chain || known(b))) {
          const table = w > 0 ? HOSTILE : HELP
          const d = dist(b)
          for (const r of UNKNOWN) {
            let l = 0
            for (const rb of Object.keys(d) as Role[]) l += (d[rb] ?? 0) * table[r][rb]
            logL[r] += Math.min(Math.abs(w), 2.5) * Math.log(Math.max(l, 0.02))
          }
        }
        // b 對 q 做的事：被警長打＝警長懷疑他；被「像歹徒」的人打＝比較像好人
        const x = rel[b][q]
        if (x > 0 && b !== v.me) {
          if (v.players[b].role === 'sheriff') {
            for (const r of UNKNOWN) logL[r] += Math.min(x, 2.5) * Math.log(SHOT_BY_SHERIFF[r])
          } else if (lv.chain) {
            const d = dist(b)
            for (const r of UNKNOWN) {
              let l = 0
              for (const rb of UNKNOWN) l += (d[rb] ?? 0) * HOSTILE[rb][r]
              logL[r] += 0.5 * Math.min(x, 2.5) * Math.log(Math.max(l, 0.02))
            }
          }
        }
      }
      const post: Belief = { deputy: 0, outlaw: 0, renegade: 0 }
      let sum = 0
      for (const r of UNKNOWN) {
        post[r] = counts[r] > 0 ? prior[r] * Math.exp(logL[r]) : 0
        sum += post[r]
      }
      for (const r of UNKNOWN) post[r] = sum > 0 ? post[r] / sum : prior[r]
      next.set(q, post)
    }
    bel = next
    // 人數推算：歹徒只剩 2 個，就不會有 4 個人都「很像歹徒」
    if (lv.balance) bel = balance(bel, counts)
  }
  return bel
}

function balance(bel: Map<number, Belief>, counts: Belief) {
  const out = new Map([...bel].map(([k, b]) => [k, { ...b }]))
  for (let k = 0; k < 6; k++) {
    for (const r of UNKNOWN) {
      const s = [...out.values()].reduce((a, b) => a + b[r], 0)
      if (s > 0) for (const b of out.values()) b[r] *= counts[r] / s
    }
    for (const b of out.values()) {
      const s = UNKNOWN.reduce((a, r) => a + b[r], 0)
      if (s > 0) for (const r of UNKNOWN) b[r] /= s
    }
  }
  return out
}

/** 對某人身分的猜測（公開的身分就是確定的） */
export function beliefOf(v: GameView, q: number): Partial<Record<Role, number>> {
  const r = q === v.me ? v.players[v.me].role : v.players[q].role
  if (r) return { [r]: 1 }
  return mind(v).belief.get(q) ?? {}
}

const remaining = (v: GameView, role: Role) => {
  const total = (ROLE_SETUP[v.players.length] ?? []).filter((r) => r === role).length
  return total - v.players.filter((p) => !p.alive && p.role === role).length
}

/** 他是我敵人的把握（0～1；負數＝我要保護他） */
export function enemyChance(v: GameView, q: PublicPlayer): number {
  const me = v.players[v.me]
  const role = me.role!
  if (q.seat === v.me) return -1
  if (v.event === 'wildwestshow') return 1
  const b = beliefOf(v, q.seat)
  const P = (r: Role) => b[r] ?? 0
  const living = v.players.filter((p) => p.alive)
  const outlawsLeft = remaining(v, 'outlaw')
  switch (role) {
    case 'sheriff':
    case 'deputy': {
      if (P('sheriff') === 1) return -1
      // 歹徒還在時，叛徒算半個敵人；歹徒死光就是頭號敵人
      const renW = outlawsLeft === 0 ? 1 : 0.35
      return P('outlaw') + P('renegade') * renW
    }
    case 'outlaw':
      if (P('sheriff') === 1) return 1
      return P('deputy') + P('renegade') * 0.55 - P('outlaw') * 0.3
    case 'renegade': {
      if (P('sheriff') === 1) return living.length <= 2 ? 1 : q.hp <= 2 ? -0.8 : outlawsLeft === 0 && remaining(v, 'deputy') === 0 ? 1 : 0.05
      if (outlawsLeft === 0) return 1
      return P('outlaw') + P('deputy') * 0.35
    }
  }
}

/** 他是不是自己人（請喝酒、幫拆監獄、用幽靈救他） */
export function ally(v: GameView, q: PublicPlayer): boolean {
  if (q.seat === v.me) return true
  return enemyChance(v, q) < (v.players[v.me].role === 'outlaw' ? 0.2 : 0.25)
}

/** 開槍門檻：把握要多少才打（副警長最怕誤傷，警長常試探） */
function threshold(v: GameView) {
  const role = v.players[v.me].role!
  let base: number = { sheriff: 0.4, deputy: 0.5, outlaw: 0.5, renegade: 0.45 }[role]
  // 要有「證據」才開槍：一個完全沒表態的人本來就有一定機率是敵人（例如歹徒人數多），
  // 門檻至少要比這個基本機率再高一截，免得只因為人數就亂打
  const blank = blankChance(v)
  base = Math.max(base, blank + ({ sheriff: 0.02, deputy: 0.08, outlaw: 0.1, renegade: 0.04 }[role] ?? 0.1))
  // 拖久了大家都會比較衝
  return base - Math.min(0.3, v.turnNo / 80)
}

/** 一個完全沒表態的人，是我敵人的機率（只看人數） */
function blankChance(v: GameView) {
  const c = hiddenCounts(v)
  const total = UNKNOWN.reduce((a, r) => a + c[r], 0)
  if (!total) return 0
  const P = (r: Unknown) => c[r] / total
  const outlawsLeft = remaining(v, 'outlaw')
  switch (v.players[v.me].role) {
    case 'sheriff':
    case 'deputy':
      return P('outlaw') + P('renegade') * (outlawsLeft === 0 ? 1 : 0.35)
    case 'outlaw':
      return P('deputy') + P('renegade') * 0.55 - P('outlaw') * 0.3
    default:
      return P('outlaw') + P('deputy') * 0.35
  }
}

/**
 * 想打他的程度（> 0 會想打，< 0 不打）。
 * 把握 − 門檻 ＋ 記仇 ＋ 補刀 ＋ 一點隨機。
 */
export function hostility(v: GameView, q: PublicPlayer): number {
  if (q.seat === v.me) return -99
  const lv = settings(v)
  const e = enemyChance(v, q)
  if (e <= 0) return e - 1
  let x = e - threshold(v)
  // 記仇：他打過我（但如果很確定是自己人就算了）
  const hurtMe = v.rel?.[q.seat]?.[v.me] ?? 0
  if (hurtMe > 0 && e > 0.25) x += Math.min(lv.grudge, hurtMe * lv.grudge * 0.6)
  // 補刀：敵人只剩 1 點生命
  if (q.hp <= 1 && e > 0.5) x += lv.finish
  // 歹徒的警長：永遠是頭號目標
  if (v.players[v.me].role === 'outlaw' && q.role === 'sheriff') x += 1
  return x + (mind(v).noise.get(q.seat) ?? 0)
}

/** 這次要不要手滑（簡單難度偶爾亂出、忘記出牌） */
export const sloppy = (v: GameView) => Math.random() < settings(v).sloppy
