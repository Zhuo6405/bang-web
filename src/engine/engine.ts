import {
  buildCards,
  CARD_DEFS,
  CHAR_BY_ID,
  CHARACTERS,
  cardLabel,
  cardSuitLabel,
  EVENT_BY_ID,
  EVENTS,
  GOLD_DEFS,
  isWeapon,
  maxPlayersFor,
  ROLE_NAME,
  ROLE_SETUP,
  SUIT_NAME,
} from './data'
import { note, W } from './reputation'
import { bi, CARD_EN, CHAR_EN, EVENT_EN, GOLD_EN, pick, ROLE_EN, SUIT_EN, type Lang } from './i18n'
import type {
  CoinDuel,
  AbilityId,
  Action,
  Ask,
  AskOption,
  AskView,
  Card,
  CardKey,
  Decision,
  Fx,
  GameConfig,
  GameState,
  GoldKey,
  LegalAbility,
  LegalPlay,
  PlayAs,
  Suit,
  Task,
} from './types'

export class RuleError extends Error {}
/** 規則錯誤：中文與英文（英文可省略） */
const fail = (zh: string, en?: string): never => {
  throw new RuleError(en ? bi(zh, en) : zh)
}

// ───────────── 亂數（可重現） ─────────────
function rand(s: GameState) {
  s.rng = (s.rng + 0x6d2b79f5) | 0
  let t = s.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function shuffle<T>(s: GameState, a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ───────────── 小工具 ─────────────
export const card = (s: GameState, id: number): Card => s.cards[id]
const keyOf = (s: GameState, id: number) => s.cards[id].key
const nm = (s: GameState, p: number) => s.players[p].name
export const alive = (s: GameState) => s.players.filter((p) => p.alive).map((p) => p.seat)
const isAlive = (s: GameState, p: number) => !!s.players[p]?.alive
export const evOn = (s: GameState, id: string) => s.events?.current === id

/** 角色能力（宿醉時全部失效；薇拉、葛雷戈里可以借用別人的能力） */
export function hasChar(s: GameState, p: number, id: string) {
  if (evOn(s, 'hangover')) return false
  const x = s.players[p]
  if (!x) return false
  return x.character === id || (x.character === 'vera' && x.copy === id) || !!x.copies?.includes(id)
}

/** 祝福／詛咒會改變花色 */
export function suitOf(s: GameState, c: Card): Suit {
  if (evOn(s, 'blessing')) return 'H'
  if (evOn(s, 'curse')) return 'S'
  return c.suit
}

/** 場上的牌有沒有效果：套索全部失效；貝兒的回合中別人的失效 */
export function eqOn(s: GameState, owner: number) {
  if (evOn(s, 'lasso')) return false
  const a = s.turn.active
  if (a !== owner && s.turn.phase !== 'choose' && hasChar(s, a, 'belle')) return false
  return true
}
const tableHas = (s: GameState, p: number, ...keys: CardKey[]) => eqOn(s, p) && s.players[p].table.some((id) => keys.includes(keyOf(s, id)))
const ownsKey = (s: GameState, p: number, k: CardKey) => s.players[p].table.some((id) => keyOf(s, id) === k)
const greenReady = (s: GameState, id: number) => (s.greenAt[id] ?? -1) !== s.turn.no

// ── 淘金熱 ──
export const goldKey = (s: GameState, uid: number): GoldKey => s.gold!.cards.find((c) => c.uid === uid)!.key
export const nuggets = (s: GameState, p: number) => s.gold?.nuggets[p] ?? 0
function addNuggets(s: GameState, p: number, n: number) {
  if (s.gold && n > 0) s.gold.nuggets[p] += n
}
const goldHas = (s: GameState, p: number, k: GoldKey) => !!s.gold && s.gold.equip[p].some((uid) => goldKey(s, uid) === k)
function refillShop(s: GameState) {
  const g = s.gold
  if (!g) return
  while (g.shop.length < 3 && g.deck.length) g.shop.push(g.deck.shift()!)
}

/** 遊戲紀錄：同時存中文與英文 */
function log(s: GameState, zh: string, en?: string) {
  s.log.push({ seq: ++s.seq, text: en ? bi(zh, en) : zh, turn: s.turn.no })
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
}
function fx(s: GameState, f: Omit<Fx, 'seq'>) {
  s.fx.push({ seq: ++s.seq, ...f })
  if (s.fx.length > 40) s.fx.splice(0, s.fx.length - 40)
}

/** 下一個活著的人（依目前的回合方向） */
export function nextAlive(s: GameState, p: number, dir: 1 | -1 = s.dir) {
  const n = s.players.length
  for (let i = 1; i <= n; i++) {
    const q = (((p + dir * i) % n) + n) % n
    if (s.players[q].alive) return q
  }
  return p
}

/** 抽一張（牌堆空了就把棄牌堆洗回去） */
function drawOne(s: GameState): number | null {
  if (!s.deck.length) {
    if (!s.discard.length) return null
    s.deck = shuffle(s, s.discard)
    s.discard = []
    log(s, '牌堆用完，把棄牌堆洗成新的牌堆。', 'The deck ran out; the discard pile is shuffled into a new deck.')
  }
  return s.deck.pop() ?? null
}
function draw(s: GameState, p: number, n: number) {
  for (let i = 0; i < n; i++) {
    const id = drawOne(s)
    if (id == null) return
    s.players[p].hand.push(id)
  }
}
/** 抽牌階段的抽牌（廢棄礦坑：改從棄牌堆抽） */
function phaseDraw(s: GameState, p: number, n: number) {
  for (let i = 0; i < n; i++) {
    let id: number | null
    if (evOn(s, 'mine') && s.discard.length) id = s.discard.pop()!
    else id = drawOne(s)
    if (id == null) return
    s.players[p].hand.push(id)
    s.turn.drawn = [...(s.turn.drawn ?? []), id]
  }
}
function toDiscard(s: GameState, id: number) {
  s.discard.push(id)
  delete s.greenAt[id]
}
function removeFromHand(s: GameState, p: number, id: number) {
  const h = s.players[p].hand
  const i = h.indexOf(id)
  if (i < 0) fail('那張牌不在手上', 'That card is not in hand')
  h.splice(i, 1)
}
function removeFromTable(s: GameState, p: number, id: number) {
  const t = s.players[p].table
  const i = t.indexOf(id)
  if (i < 0) fail('那張牌不在場上', 'That card is not in play')
  t.splice(i, 1)
}
function heal(s: GameState, p: number, n: number) {
  const x = s.players[p]
  if (x.ghost) return 0
  const before = x.hp
  x.hp = Math.min(x.maxHp, x.hp + n)
  if (x.hp > before) fx(s, { kind: 'heal', to: p, amount: x.hp - before })
  return x.hp - before
}
/** 莫莉．史塔克：在自己回合以外用掉手牌就抽 1 張 */
function molly(s: GameState, p: number) {
  if (hasChar(s, p, 'molly') && s.turn.active !== p) {
    draw(s, p, 1)
    log(s, `${nm(s, p)} 在回合外出牌，抽 1 張。`, `${nm(s, p)} played a card out of turn and draws 1.`)
  }
}
/** 有人喝啤酒：伊托夫人抽牌、檸檬水吉姆可以跟著回血 */
function beerPlayed(s: GameState, p: number) {
  for (const q of alive(s)) {
    if (hasChar(s, q, 'yto')) {
      draw(s, q, 1)
      log(s, `${nm(s, q)} 聽到開酒瓶的聲音，抽 1 張。`, `${nm(s, q)} hears a bottle being opened and draws 1.`)
    }
    const x = s.players[q]
    if (q !== p && hasChar(s, q, 'lemonade') && x.hp < x.maxHp && x.hand.length) s.q.push({ k: 'ask', kind: 'lemonade', player: q })
  }
}

/** 抽判定：翻牌堆頂。幸運杜克／馬蹄鐵翻兩張挑有利的。回傳是否「有利」 */
function check(s: GameState, p: number, good: (c: Card) => boolean, what: string): boolean {
  const n = hasChar(s, p, 'lucky') || goldHas(s, p, 'horseshoe') ? 2 : 1
  const flipped: number[] = []
  for (let i = 0; i < n; i++) {
    const id = drawOne(s)
    if (id != null) flipped.push(id)
  }
  if (!flipped.length) return false
  const eff = (id: number) => ({ ...card(s, id), suit: suitOf(s, card(s, id)) })
  const pick = flipped.find((id) => good(eff(id))) ?? flipped[0]
  const john = alive(s).find((q) => hasChar(s, q, 'johnpain'))
  for (const id of flipped) {
    if (john != null && s.players[john].hand.length < 6) {
      s.players[john].hand.push(id)
    } else toDiscard(s, id)
  }
  const c = eff(pick)
  const ok = good(c)
  const shown = flipped.map((id) => cardSuitLabel(eff(id))).join('、')
  const johnTook = john != null && s.players[john].hand.includes(pick)
  log(
    s,
    `${nm(s, p)} 為${zhOf(what)}抽判定：${shown}${n > 1 ? `（取 ${cardSuitLabel(c)}）` : ''} → ${ok ? '成功' : '失敗'}${johnTook ? `（${nm(s, john!)} 收走判定牌）` : ''}`,
    `${nm(s, p)} draws! for ${enOf(what)}: ${flipped.map((id) => cardSuitLabel(eff(id))).join(', ')}${n > 1 ? ` (keeps ${cardSuitLabel(c)})` : ''} → ${ok ? 'success' : 'fail'}${johnTook ? ` (${nm(s, john!)} takes the card)` : ''}`,
  )
  fx(s, { kind: 'check', to: p, card: c, ok })
  return ok
}

// ───────────── 距離 ─────────────
export function distance(s: GameState, a: number, b: number) {
  const n = s.players.length
  let d: number
  if (evOn(s, 'ambush')) d = 1
  else {
    let cw = 0
    for (let q = a; q !== b; q = (q + 1) % n) if (s.players[(q + 1) % n].alive || (q + 1) % n === b) cw++
    let ccw = 0
    for (let q = a; q !== b; q = (q - 1 + n) % n) if (s.players[(q - 1 + n) % n].alive || (q - 1 + n) % n === b) ccw++
    d = Math.min(cw, ccw)
  }
  if (tableHas(s, b, 'mustang')) d++
  if (tableHas(s, b, 'hideout')) d++
  if (hasChar(s, b, 'paul')) d++
  if (tableHas(s, a, 'scope')) d--
  if (tableHas(s, a, 'binocular')) d--
  if (hasChar(s, a, 'rose')) d--
  return Math.max(1, d)
}
export function weaponRange(s: GameState, p: number) {
  if (!eqOn(s, p)) return 1
  for (const id of s.players[p].table) {
    const r = CARD_DEFS[keyOf(s, id)].range
    if (r) return r
  }
  return 1
}
const unlimitedBang = (s: GameState, p: number) => hasChar(s, p, 'willy') || tableHas(s, p, 'volcanic')
const bangLimit = (s: GameState) => (evOn(s, 'shootout') ? 2 : 1)
const handLimit = (s: GameState, p: number) => {
  if (hasChar(s, p, 'sean')) return 10
  if (goldHas(s, p, 'gunbelt')) return 8
  return Math.max(0, s.players[p].hp)
}
/** 這張牌對阿帕契小子（或和平菸斗）無效嗎？ */
const apacheBlocks = (s: GameState, user: number | null, target: number, c: Card | null) =>
  !!c && user != null && user !== target && (hasChar(s, target, 'apache') || goldHas(s, target, 'calumet')) && suitOf(s, c) === 'D'

// ───────────── 開局 ─────────────
const EVENT_SETS = ['high_noon', 'fistful', 'wild_west_show'] as const

export function startGame(config: GameConfig): GameState {
  const n = config.names.length
  const exp = config.expansions ?? []
  if (!ROLE_SETUP[n] || n < 4 || n > maxPlayersFor(exp)) fail(`人數需要 4–${maxPlayersFor(exp)} 人`, `This game needs 4–${maxPlayersFor(exp)} players`)
  const s: GameState = {
    config: { ...config, expansions: exp },
    rng: config.seed | 0,
    cards: buildCards(exp),
    deck: [],
    discard: [],
    players: [],
    turn: { active: 0, no: 0, bangs: 0, phase: 'choose' },
    q: [],
    store: [],
    log: [],
    fx: [],
    seq: 0,
    result: null,
    rel: Array.from({ length: n }, () => Array(n).fill(0)),
    gold: null,
    poker: [],
    dir: 1,
    greenAt: {},
    events: null,
    firstDead: null,
    deadManDone: false,
  }
  s.deck = shuffle(s, s.cards.map((c) => c.id))
  const roles = shuffle(s, [...ROLE_SETUP[n]])
  const pool = CHARACTERS.filter((c) => c.set === 'base' || exp.includes(c.set)).map((c) => c.id)
  s.pick = { pool, picks: Array(n).fill(null), round: 1, duels: [] }
  s.players = config.names.map((name, seat) => ({
    seat,
    name,
    isAI: !!config.ai[seat],
    role: roles[seat],
    character: null,
    charOptions: [],
    hp: 0,
    maxHp: 0,
    hand: [],
    table: [],
    alive: true,
  }))
  // 事件牌堆
  const sets = EVENT_SETS.filter((x) => exp.includes(x))
  if (sets.length) {
    let body = shuffle(s, EVENTS.filter((e) => (sets as readonly string[]).includes(e.set) && !e.final).map((e) => e.id))
    if (sets.length > 1) body = body.slice(0, 14)
    const finals = EVENTS.filter((e) => (sets as readonly string[]).includes(e.set) && e.final).map((e) => e.id)
    s.events = { deck: [...body, finals[Math.floor(rand(s) * finals.length)]], current: null }
  }
  // 淘金熱：裝備牌堆與商店
  if (exp.includes('gold_rush')) {
    const cards = (Object.keys(GOLD_DEFS) as GoldKey[]).flatMap((k) => Array.from({ length: GOLD_DEFS[k].copies }, () => k)).map((key, i) => ({ uid: 1000 + i, key }))
    s.gold = { cards, deck: shuffle(s, cards.map((c) => c.uid)), shop: [], nuggets: Array(n).fill(0), equip: Array.from({ length: n }, () => []), free: Array(n).fill(null) }
    refillShop(s)
  }
  const sheriff = s.players.find((p) => p.role === 'sheriff')!
  s.turn.active = sheriff.seat
  log(s, `${sheriff.name} 是警長。每個人挑一個角色；撞角的人擲硬幣決定。`, `${sheriff.name} is the Sheriff. Everyone picks a character; clashes are settled by a coin toss.`)
  return s
}

/** 這一輪還能選的角色：已經定案的不能再選 */
function pickOptions(s: GameState) {
  const taken = new Set(s.players.map((p) => p.character).filter(Boolean))
  return (s.pick?.pool ?? []).filter((c) => !taken.has(c))
}

/** 擲硬幣決定誰拿到：兩人時人頭贏；三人以上每人擲 3 枚，人頭多的贏，平手的人再擲 */
function coinDuel(s: GameState, char: string, seats: number[]): CoinDuel {
  const rounds: CoinDuel['rounds'] = []
  let left = [...seats]
  for (let guard = 0; guard < 30 && left.length > 1; guard++) {
    const k = left.length === 2 ? 1 : 3
    const flips = left.map((seat) => ({ seat, coins: Array.from({ length: k }, () => rand(s) < 0.5) }))
    rounds.push(flips)
    const heads = (f: (typeof flips)[number]) => f.coins.filter(Boolean).length
    const best = Math.max(...flips.map(heads))
    const top = flips.filter((f) => heads(f) === best).map((f) => f.seat)
    // 兩人都人頭或都反面：重擲
    if (k === 1 && top.length !== 1) continue
    left = top
  }
  const winner = left.length === 1 ? left[0] : left[Math.floor(rand(s) * left.length)]
  return { round: s.pick!.round, char, seats, rounds, winner }
}

function resolvePicks(s: GameState) {
  const pk = s.pick!
  const by = new Map<string, number[]>()
  s.players.forEach((p, seat) => {
    const c = pk.picks[seat]
    if (!p.character && c) by.set(c, [...(by.get(c) ?? []), seat])
  })
  for (const [char, seats] of by) {
    const name = CHAR_BY_ID[char].name
    if (seats.length === 1) {
      s.players[seats[0]].character = char
      log(s, `${s.players[seats[0]].name} 選定【${name}】。`, `${s.players[seats[0]].name} takes ${CHAR_EN[char].name}.`)
      continue
    }
    const d = coinDuel(s, char, seats)
    pk.duels.push(d)
    s.players[d.winner].character = char
    log(
      s,
      `${seats.map((x) => s.players[x].name).join('、')} 都選了【${name}】，擲硬幣後由 ${s.players[d.winner].name} 拿到。`,
      `${seats.map((x) => s.players[x].name).join(', ')} all picked ${CHAR_EN[char].name}; after a coin toss ${s.players[d.winner].name} gets it.`,
    )
  }
  pk.picks = pk.picks.map(() => null)
  pk.round++
  if (s.players.every((x) => x.character)) afterCharacters(s)
  else log(s, `第 ${pk.round} 輪選角：沒選到的人從剩下的角色再挑一次。`, `Pick round ${pk.round}: those who missed out choose again from the remaining characters.`)
}

function afterCharacters(s: GameState) {
  // 「新身份」事件需要第二個角色：從沒人用的角色隨機發一張
  const used = new Set(s.players.map((p) => p.character))
  const spare = shuffle(s, (s.pick?.pool ?? []).filter((c) => !used.has(c)))
  s.players.forEach((p, i) => {
    p.charOptions = spare[i] ? [p.character!, spare[i]] : [p.character!]
  })
  for (const p of s.players) {
    const c = CHAR_BY_ID[p.character!]
    p.maxHp = c.hp + (p.role === 'sheriff' ? 1 : 0)
    p.hp = p.maxHp
    draw(s, p.seat, p.character === 'bigspencer' ? 5 : p.hp)
  }
  log(s, '發牌完成，每人手牌數等於生命值。警長先開始。', 'Cards dealt: everyone holds as many cards as their life. The Sheriff starts.')
  s.turn = { active: s.turn.active, no: 1, bangs: 0, phase: 'start', uses: {} }
  s.q.push({ k: 'startTurn' })
  run(s)
}

// ───────────── 合法出牌 ─────────────
function hasCards(s: GameState, p: number) {
  return s.players[p].hand.length + s.players[p].table.length > 0
}
const isBangCard = (s: GameState, p: number, id: number) => {
  const k = keyOf(s, id)
  return k === 'bang' || (k === 'missed' && hasChar(s, p, 'calamity'))
}

export function legalPlays(s: GameState, p: number): LegalPlay[] {
  if (s.result || s.q.length || s.turn.phase !== 'play' || s.turn.active !== p) return []
  const me = s.players[p]
  const others = alive(s).filter((q) => q !== p)
  const out: LegalPlay[] = []
  const bangOk = (s.turn.bangs < bangLimit(s) || unlimitedBang(s, p)) && !evOn(s, 'sermon')
  const reach = weaponRange(s, p)
  const inRange = others.filter((q) => distance(s, p, q) <= reach)
  const near = others.filter((q) => distance(s, p, q) <= 1)
  const withCards = others.filter((q) => hasCards(s, q))
  const judge = evOn(s, 'judge')
  const cuffs = s.turn.suit
  const must = s.turn.must != null && me.hand.includes(s.turn.must) ? s.turn.must : null
  const hurt = me.hp < me.maxHp && !me.ghost
  const canCost = me.hand.length >= 2
  const bangCount = me.hand.filter((id) => isBangCard(s, p, id)).length
  const anyAsBang = evOn(s, 'showdown') || tableHas(s, p, 'lemat')
  const uses = s.turn.uses ?? {}
  const beerOk = hurt && alive(s).length > 2 && !evOn(s, 'reverend')
  const secondFor = (ts: number[]) => Object.fromEntries(ts.map((t) => [t, alive(s).filter((q) => q !== p && q !== t && distance(s, t, q) <= 1)]))

  for (const id of me.hand) {
    const c = card(s, id)
    if (cuffs && suitOf(s, c) !== cuffs) continue
    const k = c.key
    const add = (l: Omit<LegalPlay, 'card' | 'source'>) => out.push({ card: id, source: 'hand', ...l })
    if (isBangCard(s, p, id) || anyAsBang) {
      if (bangOk && inRange.length) add({ as: 'bang', targets: inRange })
      if (isBangCard(s, p, id)) {
        if (evOn(s, 'sniper') && bangOk && bangCount >= 2 && inRange.length) add({ as: 'sniper', targets: inRange, cost: 1, costKind: 'bang' })
        if (evOn(s, 'ricochet') && !evOn(s, 'sermon')) {
          const t = others.filter((q) => s.players[q].table.length)
          if (t.length) add({ as: 'ricochet', targets: t, pickCard: true, tableOnly: true })
        }
        if (hasChar(s, p, 'ringer') && !uses.ringer) add({ as: 'gatling', targets: null })
      }
    }
    if (hasChar(s, p, 'blackflower') && !uses.flower && suitOf(s, c) === 'C' && inRange.length && !evOn(s, 'sermon')) add({ as: 'flower', targets: inRange })
    if (k === 'beer' && s.gold) add({ as: 'nugget', targets: null })
    switch (k) {
      case 'beer':
        if (beerOk) add({ as: k, targets: null })
        break
      case 'saloon':
      case 'stagecoach':
      case 'wellsfargo':
      case 'store':
      case 'gatling':
      case 'indians':
      case 'tornado':
      case 'bandidos':
        add({ as: k, targets: null })
        break
      case 'poker':
        if (others.some((q) => s.players[q].hand.length)) add({ as: k, targets: null })
        break
      case 'lastcall':
        if (hurt) add({ as: k, targets: null })
        break
      case 'duel':
        add({ as: k, targets: others })
        break
      case 'panic':
        if (near.filter((q) => hasCards(s, q)).length) add({ as: k, targets: near.filter((q) => hasCards(s, q)), pickCard: true })
        break
      case 'catbalou':
        if (withCards.length) add({ as: k, targets: withCards, pickCard: true })
        break
      case 'punch':
        if (near.length) add({ as: k, targets: near })
        break
      case 'tomahawk': {
        const t = others.filter((q) => distance(s, p, q) <= 2)
        if (t.length) add({ as: k, targets: t })
        break
      }
      case 'fanning':
        if (bangOk && inRange.length) add({ as: k, targets: inRange, second: secondFor(inRange) })
        break
      case 'aim':
        if (bangOk && inRange.length && bangCount >= 1) add({ as: k, targets: inRange, cost: 1, costKind: 'bang' })
        break
      case 'ragtime':
        if (canCost && withCards.length) add({ as: k, targets: withCards, pickCard: true, cost: 1 })
        break
      case 'brawl':
        if (canCost && withCards.length) add({ as: k, targets: null, cost: 1 })
        break
      case 'springfield':
        if (canCost && others.length) add({ as: k, targets: others, cost: 1 })
        break
      case 'tequila': {
        const t = alive(s).filter((q) => s.players[q].hp < s.players[q].maxHp && !s.players[q].ghost)
        if (canCost && t.length) add({ as: k, targets: t, cost: 1 })
        break
      }
      case 'whisky':
        if (canCost && hurt) add({ as: k, targets: null, cost: 1 })
        break
      case 'jail': {
        const t = others.filter((q) => s.players[q].role !== 'sheriff' && !ownsKey(s, q, 'jail'))
        if (!judge && t.length) add({ as: k, targets: t })
        break
      }
      case 'rattlesnake':
      case 'bounty': {
        const t = others.filter((q) => !ownsKey(s, q, k))
        if (!judge && t.length) add({ as: k, targets: t })
        break
      }
      case 'ghostcard': {
        const t = s.players.filter((x) => !x.alive && x.character).map((x) => x.seat)
        if (!judge && t.length) add({ as: k, targets: t })
        break
      }
      case 'missed':
      case 'dodge':
      case 'escape':
      case 'backfire':
        break
      default: {
        const col = CARD_DEFS[k].colour
        if ((col === 'blue' || col === 'green') && !judge && !ownsKey(s, p, k)) add({ as: k, targets: null })
      }
    }
  }
  // 場上的綠牌
  if (eqOn(s, p) && !must) {
    for (const id of me.table) {
      const k = keyOf(s, id)
      if (CARD_DEFS[k].colour !== 'green' || !greenReady(s, id)) continue
      const add = (l: Omit<LegalPlay, 'card' | 'source'>) => out.push({ card: id, source: 'table', ...l })
      switch (k) {
        case 'knife':
        case 'derringer':
          if (near.length) add({ as: k, targets: near })
          break
        case 'pepperbox':
          if (inRange.length) add({ as: k, targets: inRange })
          break
        case 'buffalo':
          if (others.length) add({ as: k, targets: others })
          break
        case 'canteen':
          if (hurt) add({ as: k, targets: null })
          break
        case 'cancan':
        case 'conestoga':
          if (withCards.length) add({ as: k, targets: withCards, pickCard: true })
          break
        case 'howitzer':
        case 'pony':
          add({ as: k, targets: null })
          break
      }
    }
  }
  // 淘金熱商店
  if (s.gold && !must) {
    const g = s.gold
    const money = nuggets(s, p)
    const discount = hasChar(s, p, 'luzena') && !uses.luzena ? 1 : 0
    const items = [...g.shop.map((uid) => ({ uid, free: false })), ...(g.free[p] != null ? [{ uid: g.free[p]!, free: true }] : [])]
    for (const { uid, free } of items) {
      const key = goldKey(s, uid)
      const def = GOLD_DEFS[key]
      const price = free ? 0 : Math.max(0, def.cost - discount)
      if (price > money) continue
      const add = (l: Omit<LegalPlay, 'card' | 'source' | 'price'>) => out.push({ card: uid, source: 'shop', price, ...l })
      if (def.kind === 'black') {
        if (judge) continue
        if (key === 'wanted') {
          const t = others.filter((q) => !goldHas(s, q, 'wanted'))
          if (t.length) add({ as: key, targets: t })
        } else if (!goldHas(s, p, key)) add({ as: key, targets: null })
        continue
      }
      switch (key) {
        case 'shotglass': {
          const t = alive(s).filter((q) => s.players[q].hp < s.players[q].maxHp && !s.players[q].ghost)
          if (t.length) add({ as: key, targets: t })
          break
        }
        case 'bottle': {
          const np = near.filter((q) => hasCards(s, q))
          if (np.length) add({ as: 'panic', targets: np, pickCard: true })
          if (beerOk) add({ as: 'beer', targets: null })
          if (inRange.length && !evOn(s, 'sermon')) add({ as: 'bang', targets: inRange })
          break
        }
        case 'pardner':
          add({ as: 'store', targets: null })
          if (others.length) add({ as: 'duel', targets: others })
          if (withCards.length) add({ as: 'catbalou', targets: withCards, pickCard: true })
          break
        case 'rum':
          if (hurt) add({ as: key, targets: null })
          break
        default:
          add({ as: key, targets: null })
      }
    }
    // 付「價格 + 1」棄掉別人的裝備
    for (const q of others) {
      for (const uid of g.equip[q]) {
        const price = GOLD_DEFS[goldKey(s, uid)].cost + 1
        if (price <= money) out.push({ card: uid, source: 'shop', price, as: 'golddrop', targets: [q] })
      }
    }
  }
  // 西部法則：必須先打出亮出的那張
  if (must != null) {
    const forced = out.filter((l) => l.card === must && l.source === 'hand')
    if (forced.length) return forced
  }
  return out
}

export function legalAbilities(s: GameState, p: number): LegalAbility[] {
  const me = s.players[p]
  if (s.result || !me.alive) return []
  const out: LegalAbility[] = []
  const dying = s.q[0]?.k === 'ask' && s.q[0].kind === 'dying' && s.q[0].player === p
  const myPlay = !s.q.length && s.turn.phase === 'play' && s.turn.active === p
  if (!dying && !myPlay) return out
  const money = nuggets(s, p)
  if (hasChar(s, p, 'sid') && me.hand.length >= 2 && me.hp < me.maxHp) out.push({ id: 'sid', label: bi('席德：棄 2 張回 1 點生命', 'Sid: discard 2 to regain 1 life'), cards: 2 })
  if (goldHas(s, p, 'rucksack') && money >= 2 && me.hp < me.maxHp) out.push({ id: 'rucksack', label: bi('背包：付 2 金塊回 1 點生命', 'Rucksack: pay 2 nuggets to regain 1 life'), cards: 0 })
  if (!myPlay) return out
  const uses = s.turn.uses ?? {}
  const reach = weaponRange(s, p)
  const inRange = alive(s).filter((q) => q !== p && distance(s, p, q) <= reach)
  if (hasChar(s, p, 'chuck') && me.hp > 1) out.push({ id: 'chuck', label: bi('恰克：失去 1 點生命抽 2 張', 'Chuck: lose 1 life to draw 2'), cards: 0 })
  const blues = me.hand.filter((id) => CARD_DEFS[keyOf(s, id)].colour === 'blue')
  if (hasChar(s, p, 'jose') && (uses.jose ?? 0) < 2 && blues.length) out.push({ id: 'jose', label: bi('荷西：棄 1 張藍牌抽 2 張', 'José: discard a blue card to draw 2'), cards: 1, cardIds: blues })
  if (hasChar(s, p, 'doc') && !(uses.doc ?? 0) && me.hand.length >= 2 && inRange.length) out.push({ id: 'doc', label: bi('霍利戴：棄 2 張開一槍', 'Doc: discard 2 to shoot'), cards: 2, targets: inRange })
  if (hasChar(s, p, 'jacky') && money >= 2 && inRange.length) out.push({ id: 'jacky', label: bi('傑基：付 2 金塊開一槍', 'Jacky: pay 2 nuggets to shoot'), cards: 0, targets: inRange })
  if (hasChar(s, p, 'josh') && money >= 2 && s.gold?.deck.length && s.gold.free[p] == null) out.push({ id: 'josh', label: bi('喬許：付 2 金塊抽一張裝備', 'Josh: pay 2 nuggets for an equipment card'), cards: 0 })
  if (hasChar(s, p, 'raddie') && money >= 1 && (uses.raddie ?? 0) < 2) out.push({ id: 'raddie', label: bi('雷迪：付 1 金塊抽 1 張', 'Raddie: pay 1 nugget to draw 1'), cards: 0 })
  if (goldHas(s, p, 'goldpan') && money >= 1 && (uses.goldpan ?? 0) < 2) out.push({ id: 'goldpan', label: bi('淘金盤：付 1 金塊抽 1 張', 'Gold Pan: pay 1 nugget to draw 1'), cards: 0 })
  if (hasChar(s, p, 'flint') && !uses.flint && me.hand.length) {
    const t = alive(s).filter((q) => q !== p && s.players[q].hand.length)
    if (t.length) out.push({ id: 'flint', label: bi('佛林特：拿 1 張手牌換別人 2 張', 'Flint: swap 1 card for 2 of someone’s'), cards: 1, targets: t })
  }
  const last = s.turn.last
  const bangs = me.hand.filter((id) => isBangCard(s, p, id))
  if (hasChar(s, p, 'lee') && last && bangs.length) out.push({ id: 'lee', label: bi(`李：棄「砰！」重複【${playName(last.as)}】`, `Lee: discard a BANG! to repeat ${pe(last.as)}`), cards: 1, cardIds: bangs })
  return out
}

export const playName = (as: PlayAs, lang: Lang = 'zh') => {
  const en = lang === 'en'
  if (as === 'sniper') return en ? 'Sniper shot' : '狙擊'
  if (as === 'ricochet') return en ? 'Ricochet' : '跳彈'
  if (as === 'flower') return en ? 'Black Flower’s BANG!' : '黑花的砰！'
  if (as === 'nugget') return en ? 'Trade for a nugget' : '換金塊'
  if (as === 'golddrop') return en ? 'Discard equipment' : '棄掉裝備'
  if (as in GOLD_DEFS) return en ? GOLD_EN[as as GoldKey].name : GOLD_DEFS[as as GoldKey].name
  return en ? CARD_EN[as as CardKey].name : CARD_DEFS[as as CardKey].name
}
/** 英文的牌名標示（中文是【名稱】） */
const ce = (c: Card) => `‘${CARD_EN[c.key].name}’`
const pe = (as: PlayAs) => `‘${playName(as, 'en')}’`
const zhOf = (x: string) => pick(x, 'zh')
const enOf = (x: string) => pick(x, 'en')

// ───────────── 詢問 ─────────────
/** 可以當作射偏了的手牌 */
function missedCards(s: GameState, p: number) {
  return s.players[p].hand.filter((id) => {
    const k = keyOf(s, id)
    if (hasChar(s, p, 'elena')) return true
    if (k === 'missed') return !hasChar(s, p, 'bigspencer')
    if (k === 'bang') return hasChar(s, p, 'calamity') || evOn(s, 'showdown')
    return k === 'dodge' || k === 'backfire'
  })
}
const escapeCards = (s: GameState, p: number) => s.players[p].hand.filter((id) => keyOf(s, id) === 'escape')
/** 場上可以當作射偏了的綠牌 */
function defendTable(s: GameState, p: number) {
  if (!eqOn(s, p)) return []
  return s.players[p].table.filter((id) => CARD_DEFS[keyOf(s, id)].defend && greenReady(s, id))
}
function bangCards(s: GameState, p: number) {
  return s.players[p].hand.filter((id) => isBangCard(s, p, id))
}
function barrelSources(s: GameState, p: number, used: string[]) {
  const out: string[] = []
  if (hasChar(s, p, 'jourdonnais') && !used.includes('jour')) out.push('jour')
  if (tableHas(s, p, 'barrel') && !used.includes('barrel')) out.push('barrel')
  return out
}
function beerCards(s: GameState, p: number) {
  const out: number[] = []
  if (alive(s).length > 2 && !evOn(s, 'reverend')) out.push(...s.players[p].hand.filter((id) => keyOf(s, id) === 'beer'))
  if (eqOn(s, p)) out.push(...s.players[p].table.filter((id) => keyOf(s, id) === 'canteen' && greenReady(s, id)))
  return out
}
const canSid = (s: GameState, p: number) => hasChar(s, p, 'sid') && s.players[p].hand.length >= 2
const canRucksack = (s: GameState, p: number) => goldHas(s, p, 'rucksack') && nuggets(s, p) >= 2

function srcName(k?: CardKey) {
  return k ? CARD_DEFS[k].name : ''
}
const srcNameEn = (k?: CardKey) => (k ? CARD_EN[k].name : '')
/** 被棕牌（不是「砰！」）當作目標時可以用的牌：逃脫、米克的射偏了 */
function brownDefence(s: GameState, p: number) {
  return [...escapeCards(s, p), ...(hasChar(s, p, 'mick') ? missedCards(s, p) : [])]
}

export function askView(s: GameState, a: Ask): AskView {
  const base: AskView = { kind: a.kind, title: '', prompt: '', options: [], cards: [], zone: 'hand', min: 1, max: 1, targets: [], shown: [], table: [] }
  const from = a.from != null ? nm(s, a.from) : ''
  const cardsOf = (ids: number[]) => ids.map((id) => card(s, id))
  const me = s.players[a.player]
  switch (a.kind) {
    case 'respond': {
      const left = (a.need ?? 1) - (a.got ?? 0)
      const opts: AskOption[] = []
      if (barrelSources(s, a.player, a.barrels ?? []).length) opts.push({ id: 'barrel', label: bi('用木桶抽判定', 'Draw! with Barrel'), primary: true })
      opts.push({ id: 'take', label: bi(`中彈（失去 ${a.dmg ?? 1} 點生命）`, `Take the hit (lose ${a.dmg ?? 1} life)`) })
      const esc = a.bangCard ? [] : escapeCards(s, a.player)
      return {
        ...base,
        title: bi('有人對你開槍', 'You are being shot'),
        prompt: bi(
          `${a.from != null ? from : '有人'}用【${srcName(a.src)}】對你開槍！${left > 1 ? `還需要 ${left} 張「射偏了！」。` : ''}點一張「射偏了！」躲開，或選擇下面的動作。`,
          `${a.from != null ? from : 'Someone'} shoots at you with ${srcNameEn(a.src)}!${left > 1 ? ` You need ${left} more Missed!.` : ''} Tap a Missed! to dodge, or choose below.`,
        ),
        options: opts,
        cards: [...missedCards(s, a.player), ...esc, ...defendTable(s, a.player)],
        table: cardsOf(defendTable(s, a.player)),
      }
    }
    case 'indians':
      return {
        ...base,
        title: bi('印第安人來襲', 'Indians!'),
        prompt: bi(`${from} 打出【印第安人！】：棄一張「砰！」，否則失去 1 點生命。`, `${from} played Indians!: discard a BANG! or lose 1 life.`),
        options: [{ id: 'take', label: bi('失去 1 點生命', 'Lose 1 life') }],
        cards: [...bangCards(s, a.player), ...brownDefence(s, a.player)],
      }
    case 'duel':
      return {
        ...base,
        title: bi('決鬥', 'Duel'),
        prompt: bi(`你和 ${from} 決鬥中：棄一張「砰！」，否則失去 1 點生命。`, `You are duelling ${from}: discard a BANG! or lose 1 life.`),
        options: [{ id: 'take', label: bi('認輸（失去 1 點生命）', 'Give up (lose 1 life)') }],
        cards: [...bangCards(s, a.player), ...brownDefence(s, a.player)],
      }
    case 'store':
      return { ...base, title: bi('雜貨店', 'General Store'), prompt: bi('從翻開的牌中挑一張。', 'Choose one of the revealed cards.'), zone: 'store', cards: [...s.store] }
    case 'dying': {
      const opts: AskOption[] = [{ id: 'die', label: bi('放棄', 'Give up') }]
      const beers = beerCards(s, a.player)
      return {
        ...base,
        title: bi('瀕死', 'Dying'),
        prompt: bi(
          `你的生命歸零了！${evOn(s, 'reverend') ? '（牧師：不能喝啤酒）' : alive(s).length <= 2 ? '（只剩兩人，啤酒無效）' : '喝啤酒自救，'}否則死亡。`,
          `You are out of life! ${evOn(s, 'reverend') ? '(The Reverend: no Beer.) ' : alive(s).length <= 2 ? '(Only two left: Beer has no effect.) ' : 'Drink a Beer to survive, '}otherwise you die.`,
        ),
        options: opts,
        cards: beers,
        table: cardsOf(beers.filter((id) => me.table.includes(id))),
      }
    }
    case 'discard': {
      const n = me.hand.length - handLimit(s, a.player)
      return {
        ...base,
        title: bi('回合結束', 'End of turn'),
        prompt: bi(`手牌超過上限（${handLimit(s, a.player)} 張），請棄掉 ${n} 張。`, `Too many cards (limit ${handLimit(s, a.player)}): discard ${n}.`),
        options: [{ id: 'ok', label: bi('棄掉選取的牌', 'Discard selected'), primary: true }],
        cards: [...me.hand],
        min: n,
        max: n,
      }
    }
    case 'kit': {
      const n = Math.max(1, (a.cards ?? []).length - 1)
      return { ...base, title: bi('基特．卡爾森', 'Kit Carlson'), prompt: bi(`從牌堆頂的 ${(a.cards ?? []).length} 張中挑 ${n} 張，另一張放回牌堆頂。`, `Choose ${n} of the top ${(a.cards ?? []).length} cards; the other goes back on top.`), zone: 'reveal', cards: a.cards ?? [], shown: cardsOf(a.cards ?? []), min: n, max: n, options: [{ id: 'ok', label: bi('拿這些牌', 'Take these'), primary: true }] }
    }
    case 'dutch':
      return { ...base, title: bi('荷蘭佬威爾', 'Dutch Will'), prompt: bi('兩張中留 1 張，另一張棄掉（並得到 1 金塊）。', 'Keep 1 of the 2 cards and discard the other (and gain 1 nugget).'), zone: 'reveal', cards: a.cards ?? [], shown: cardsOf(a.cards ?? []) }
    case 'jesse': {
      const t = alive(s).filter((q) => q !== a.player && s.players[q].hand.length > 0)
      return { ...base, title: bi('傑西．瓊斯', 'Jesse Jones'), prompt: bi('第一張牌要從牌堆抽，還是從某位玩家手上隨機拿？', 'Draw your first card from the deck, or at random from a player’s hand?'), options: [{ id: 'deck', label: bi('從牌堆抽', 'From the deck'), primary: true }], targets: t, min: 0 }
    }
    case 'pedro': {
      const top = s.discard[s.discard.length - 1]
      return { ...base, title: bi('佩卓．拉米雷斯', 'Pedro Ramirez'),
        prompt: bi(`第一張牌要從牌堆抽，還是拿棄牌堆最上面的${top != null ? cardLabel(card(s, top)) : ''}？`, `Draw your first card from the deck, or take the top of the discard pile${top != null ? ` (${ce(card(s, top))})` : ''}?`),
        options: [
          { id: 'discard', label: bi('拿棄牌堆那張', 'Take the discard'), primary: true },
          { id: 'deck', label: bi('從牌堆抽', 'From the deck') },
        ], min: 0 }
    }
    case 'pat': {
      const ids = alive(s)
        .filter((q) => q !== a.player)
        .flatMap((q) => s.players[q].table)
      return { ...base, title: bi('派特．布瑞南', 'Pat Brennan'),
        prompt: bi('要正常抽牌，還是拿走某人場上的一張牌（只拿這一張）？', 'Draw normally, or take one card in play from someone (just that card)?'),
        zone: 'reveal',
        cards: ids,
        shown: cardsOf(ids),
        options: [{ id: 'deck', label: bi('正常抽牌', 'Draw normally'), primary: true }], min: 0 }
    }
    case 'evelyn': {
      const done = a.cards ?? []
      const reach = weaponRange(s, a.player)
      const t = alive(s).filter((q) => q !== a.player && !done.includes(q) && distance(s, a.player, q) <= reach)
      const left = drawCount(s, a.player) - (a.got ?? 0)
      return {
        ...base,
        title: bi('伊芙琳．薛邦', 'Evelyn Shebang'),
        prompt: bi(`每少抽 1 張牌，就可以對射程內一名不同的玩家開一槍（還能少抽 ${left} 張）。`, `For each card you skip drawing, shoot a different player in range (${left} left to skip).`),
        targets: left > 0 ? t : [],
        options: [{ id: 'draw', label: left === drawCount(s, a.player) ? bi('正常抽牌', 'Draw normally') : bi(`抽剩下的 ${left} 張`, `Draw the remaining ${left}`), primary: true }],
        min: 0,
      }
    }
    case 'vera': {
      const t = alive(s).filter((q) => q !== a.player && s.players[q].character && s.players[q].character !== 'vera')
      return { ...base, title: bi('薇拉．卡斯特', 'Vera Custer'), prompt: bi('選一名玩家，複製他的能力到你的下一回合。', 'Choose a player to copy their ability until your next turn.'), targets: t, options: [{ id: 'skip', label: bi('不複製', 'Don’t copy') }], min: 0 }
    }
    case 'brawl': {
      const x = s.players[a.target!]
      const opts: AskOption[] = x.hand.length ? [{ id: 'hand', label: bi(`隨機一張手牌（${x.hand.length} 張）`, `A random card from hand (${x.hand.length})`), primary: true }] : []
      return { ...base, title: bi('鬥毆', 'Brawl'), prompt: bi(`棄掉 ${x.name} 的哪一張牌？`, `Which of ${x.name}’s cards should be discarded?`), zone: 'reveal', cards: [...x.table], shown: cardsOf(x.table), options: opts }
    }
    case 'ricochet': {
      const c = card(s, a.targetCard!)
      return { ...base, title: bi('跳彈', 'Ricochet'),
        prompt: bi(`${from} 對你場上的${cardLabel(c)}開槍！出一張「射偏了！」保住它，否則它會被棄掉。`, `${from} shoots at your ${ce(c)}! Play a Missed! to save it, or it is discarded.`),
        options: [{ id: 'take', label: bi('讓它被打掉', 'Let it go') }], cards: missedCards(s, a.player) }
    }
    case 'daltons': {
      const ids = me.table.filter((id) => CARD_DEFS[keyOf(s, id)].colour === 'blue')
      return { ...base, title: bi('道爾頓幫', 'The Daltons'), prompt: bi('棄掉一張你場上的藍牌。', 'Discard one of your blue cards in play.'), zone: 'reveal', cards: ids, shown: cardsOf(ids) }
    }
    case 'handcuffs':
      return {
        ...base,
        title: bi('手銬', 'Handcuffs'),
        prompt: bi('宣告一個花色：這回合只能打出這個花色的牌。', 'Name a suit: this turn you may only play cards of that suit.'),
        options: (['H', 'D', 'C', 'S'] as Suit[]).map((x) => ({ id: x, label: bi(SUIT_NAME[x], SUIT_EN[x]) })),
        min: 0,
      }
    case 'newidentity': {
      const other = me.charOptions.find((c) => c !== me.character)
      return {
        ...base,
        title: bi('新身分', 'New Identity'),
        prompt: other
          ? bi(
              `要換成開局的另一張角色「${CHAR_BY_ID[other].name}」嗎？（${CHAR_BY_ID[other].text}）換了會從 2 點生命重新開始。`,
              `Switch to your other character, ${CHAR_EN[other].name}? (${CHAR_EN[other].text}) You would restart at 2 life.`,
            )
          : bi('沒有可以換的角色。', 'There is no character to switch to.'),
        options: [
          { id: 'swap', label: bi('換角色', 'Switch') },
          { id: 'keep', label: bi('不換', 'Keep'), primary: true },
        ],
        min: 0,
      }
    }
    case 'blood': {
      const t = alive(s).filter((q) => q !== a.player && s.players[q].hp < s.players[q].maxHp && !s.players[q].ghost)
      return { ...base, title: bi('結拜兄弟', 'Blood Brothers'), prompt: bi('要失去 1 點生命，讓另一名玩家回 1 點嗎？', 'Lose 1 life so another player regains 1?'), targets: t, options: [{ id: 'skip', label: bi('不要', 'No'), primary: true }], min: 0 }
    }
    case 'liquor':
      return {
        ...base,
        title: bi('烈酒', 'Hard Liquor'),
        prompt: bi('要放棄這回合抽牌，改回 1 點生命嗎？', 'Skip drawing this turn and regain 1 life instead?'),
        options: [
          { id: 'draw', label: bi('正常抽牌', 'Draw normally'), primary: true },
          { id: 'heal', label: bi('不抽牌，回 1 點生命', 'Skip drawing, regain 1 life') },
        ],
        min: 0,
      }
    case 'peyote':
      return {
        ...base,
        title: bi('仙人掌', 'Peyote'),
        prompt: bi(
          `猜牌堆頂下一張是紅色還是黑色：猜對就拿走再猜，猜錯就停。${(a.got ?? 0) ? `（已經猜對 ${a.got} 張）` : ''}`,
          `Guess whether the next card is red or black: keep it and guess again if right, stop if wrong.${(a.got ?? 0) ? ` (${a.got} right so far)` : ''}`,
        ),
        options: [
          { id: 'red', label: bi('紅色（紅心／方塊）', 'Red (Hearts/Diamonds)'), primary: true },
          { id: 'black', label: bi('黑色（黑桃／梅花）', 'Black (Spades/Clubs)'), primary: true },
        ],
        min: 0,
      }
    case 'ranch':
      return { ...base, title: bi('牧場', 'Ranch'), prompt: bi('選任意張手牌棄掉，再抽同樣張數（不換就直接按確定）。', 'Choose any cards to discard and draw as many (or just confirm to keep your hand).'), cards: [...me.hand], min: 0, max: me.hand.length, options: [{ id: 'ok', label: bi('確定', 'Confirm'), primary: true }] }
    case 'roulette':
      return { ...base, title: bi('俄羅斯輪盤', 'Russian Roulette'), prompt: bi('棄一張「射偏了！」傳給下一個人，否則失去 2 點生命。', 'Discard a Missed! to pass it on, or lose 2 life.'), options: [{ id: 'take', label: bi('失去 2 點生命', 'Lose 2 life') }], cards: missedCards(s, a.player) }
    case 'bandidos': {
      const n = Math.min(2, me.hand.length)
      const opts: AskOption[] = [{ id: 'take', label: bi('失去 1 點生命', 'Lose 1 life') }]
      if (escapeCards(s, a.player).length) opts.unshift({ id: 'escape', label: bi('打出【逃脫】', 'Play Escape') })
      if (hasChar(s, a.player, 'mick') && missedCards(s, a.player).length) opts.unshift({ id: 'mick', label: bi('用「射偏了！」躲開', 'Dodge with a Missed!') })
      if (n) opts.unshift({ id: 'ok', label: bi(`棄掉選取的 ${n} 張`, `Discard the ${n} selected`), primary: true })
      return { ...base, title: bi('土匪', 'Bandidos'), prompt: bi(`${from} 打出【土匪】：棄 ${n} 張手牌，或失去 1 點生命。`, `${from} played Bandidos: discard ${n} card${n > 1 ? 's' : ''} or lose 1 life.`), cards: [...me.hand], min: n, max: n, options: opts }
    }
    case 'poker':
      return { ...base, title: bi('撲克', 'Poker'), prompt: bi(`${from} 打出【撲克】：棄 1 張手牌（如果大家都沒出 A，他可以拿走其中 2 張）。`, `${from} played Poker: discard 1 card (if nobody discards an Ace, they may take 2 of them).`), cards: [...me.hand] }
    case 'pokertake':
      return { ...base, title: bi('撲克', 'Poker'), prompt: bi('沒有人出 A！最多拿走 2 張。', 'No Ace! Take up to 2 cards.'), zone: 'reveal', cards: [...s.poker], shown: cardsOf(s.poker), min: 0, max: Math.min(2, s.poker.length), options: [{ id: 'ok', label: bi('拿走選取的牌', 'Take selected'), primary: true }] }
    case 'tornado':
      return { ...base, title: bi('龍捲風', 'Tornado'), prompt: bi('棄 1 張手牌，然後抽 2 張。', 'Discard 1 card, then draw 2.'), cards: [...me.hand] }
    case 'lemonade':
      return { ...base, title: bi('檸檬水吉姆', 'Lemonade Jim'), prompt: bi('有人喝了啤酒！要棄 1 張手牌，自己也回 1 點生命嗎？', 'Someone drank a Beer! Discard 1 card to regain 1 life too?'), cards: [...me.hand], min: 0, options: [{ id: 'skip', label: bi('不要', 'No'), primary: true }] }
    case 'youl':
      return { ...base, title: bi('尤爾．葛林納', 'Youl Grinner'), prompt: bi(`你的手牌比 ${nm(s, a.target!)} 多，要給他 1 張手牌。`, `You have more cards than ${nm(s, a.target!)}: give them 1 card.`), cards: [...me.hand] }
  }
}

// ───────────── 決定 ─────────────
export function getDecisions(s: GameState): Decision[] {
  if (s.result) return []
  if (s.turn.phase === 'choose') {
    const opts = pickOptions(s)
    return s.players.filter((p) => !p.character && !s.pick?.picks[p.seat]).map((p) => ({ type: 'choose_character', player: p.seat, options: opts }))
  }
  const head = s.q[0]
  if (head?.k === 'ask') return [{ type: 'ask', player: head.player, ask: askView(s, head) }]
  if (s.q.length) return []
  if (s.turn.phase === 'play') return [{ type: 'play', player: s.turn.active }]
  return []
}

// ───────────── 動作 ─────────────
export function applyAction(state: GameState, p: number, a: Action): GameState {
  const s: GameState = structuredClone(state)
  const dec = getDecisions(s).find((d) => d.player === p)
  if (!dec) fail('現在不是你的行動時機', 'It is not your move')
  const me = s.players[p]
  switch (dec!.type) {
    case 'choose_character':
      if (a.type !== 'choose_character' || !(dec as { options: string[] }).options.includes(a.character)) fail('這個角色不能選', 'You cannot pick that character')
      s.pick!.picks[p] = (a as { character: string }).character
      if (s.players.every((x, i) => x.character || s.pick!.picks[i])) resolvePicks(s)
      return s
    case 'ask':
      if (a.type === 'ability') {
        useAbility(s, p, a)
        const head = s.q[0] as Ask
        if (head?.kind === 'dying' && me.hp > 0) s.q.shift()
        run(s)
        return s
      }
      if (a.type !== 'answer') fail('請先回應目前的詢問', 'Answer the current question first')
      answer(s, s.q[0] as Ask, a as Extract<Action, { type: 'answer' }>)
      run(s)
      return s
    case 'play':
      if (a.type === 'end_turn') {
        const must = s.turn.must
        if (must != null && legalPlays(s, p).some((l) => l.card === must)) fail('西部法則：亮出的那張牌必須先打出', 'Law of the West: you must play the card you showed first')
        s.turn.phase = 'end'
        s.q.push({ k: 'endTurn' })
      } else if (a.type === 'ability') {
        useAbility(s, p, a)
      } else if (a.type === 'play') {
        playCard(s, p, a)
      } else fail('現在是你的出牌階段', 'It is your play phase')
      run(s)
      return s
  }
  return s
}

function useAbility(s: GameState, p: number, a: Extract<Action, { type: 'ability' }>) {
  const me = s.players[p]
  const ab = legalAbilities(s, p).find((x) => x.id === a.ability)
  if (!ab) fail('這個能力現在不能用', 'That ability cannot be used now')
  const cards = a.cards ?? []
  if (cards.length !== ab!.cards || new Set(cards).size !== cards.length || !cards.every((id) => me.hand.includes(id) && (!ab!.cardIds || ab!.cardIds.includes(id)))) {
    fail(`請選 ${ab!.cards} 張可以用的手牌`, `Choose ${ab!.cards} usable card${ab!.cards > 1 ? 's' : ''}`)
  }
  if (ab!.targets && (a.target == null || !ab!.targets.includes(a.target))) fail('請選一個合法的目標', 'Choose a valid target')
  const uses = (s.turn.uses ??= {})
  uses[a.ability] = (uses[a.ability] ?? 0) + 1
  const discardPicked = () => {
    for (const id of cards) {
      removeFromHand(s, p, id)
      toDiscard(s, id)
    }
  }
  switch (a.ability as AbilityId) {
    case 'sid':
      discardPicked()
      heal(s, p, 1)
      log(s, `${me.name} 棄 2 張牌回復 1 點生命（${me.hp}/${me.maxHp}）。`, `${me.name} discards 2 cards to regain 1 life (${me.hp}/${me.maxHp}).`)
      break
    case 'chuck':
      me.hp--
      fx(s, { kind: 'hit', to: p, amount: 1 })
      draw(s, p, 2)
      log(s, `${me.name} 失去 1 點生命，抽 2 張牌。`, `${me.name} loses 1 life and draws 2 cards.`)
      break
    case 'jose':
      discardPicked()
      draw(s, p, 2)
      log(s, `${me.name} 棄掉藍牌${cardLabel(card(s, cards[0]))}，抽 2 張牌。`, `${me.name} discards the blue card ${ce(card(s, cards[0]))} and draws 2.`)
      break
    case 'doc':
      discardPicked()
      log(s, `${me.name} 棄 2 張牌，對 ${nm(s, a.target!)} 開槍。`, `${me.name} discards 2 cards and shoots at ${nm(s, a.target!)}.`)
      note(s, p, a.target!, W.shoot)
      s.q.push({ k: 'shot', from: p, to: a.target!, need: 1, src: 'bang' })
      break
    case 'jacky':
      s.gold!.nuggets[p] -= 2
      log(s, `${me.name} 付 2 金塊，對 ${nm(s, a.target!)} 開槍。`, `${me.name} pays 2 nuggets and shoots at ${nm(s, a.target!)}.`)
      note(s, p, a.target!, W.shoot)
      s.q.push({ k: 'shot', from: p, to: a.target!, need: 1, src: 'bang' })
      break
    case 'josh': {
      const g = s.gold!
      g.nuggets[p] -= 2
      const uid = g.deck.shift()!
      const key = goldKey(s, uid)
      const def = GOLD_DEFS[key]
      log(s, `${me.name} 付 2 金塊，抽到裝備【${def.name}】。`, `${me.name} pays 2 nuggets and draws the equipment ‘${GOLD_EN[def.key].name}’.`)
      if (def.kind === 'black') {
        if (key === 'wanted' || goldHas(s, p, key)) g.deck.push(uid)
        else g.equip[p].push(uid)
      } else g.free[p] = uid
      break
    }
    case 'raddie':
    case 'goldpan':
      s.gold!.nuggets[p] -= 1
      draw(s, p, 1)
      log(s, `${me.name} 付 1 金塊抽 1 張牌。`, `${me.name} pays 1 nugget to draw a card.`)
      break
    case 'rucksack':
      s.gold!.nuggets[p] -= 2
      heal(s, p, 1)
      log(s, `${me.name} 從背包拿出補給，付 2 金塊回 1 點生命。`, `${me.name} digs into the Rucksack: 2 nuggets for 1 life.`)
      break
    case 'flint': {
      const t = a.target!
      note(s, p, t, W.jesse)
      const give = cards[0]
      removeFromHand(s, p, give)
      const x = s.players[t]
      const got: number[] = []
      for (let i = 0; i < 2 && x.hand.length; i++) {
        const id = x.hand[Math.floor(rand(s) * x.hand.length)]
        removeFromHand(s, t, id)
        got.push(id)
      }
      x.hand.push(give)
      me.hand.push(...got)
      log(s, `${me.name} 用 1 張手牌換走 ${x.name} 的 ${got.length} 張手牌。`, `${me.name} swaps 1 card for ${got.length} of ${x.name}’s cards.`)
      fx(s, { kind: 'steal', from: t, to: p })
      henry(s, t, p)
      break
    }
    case 'lee': {
      const last = s.turn.last!
      discardPicked()
      log(s, `${me.name} 棄「砰！」，重複【${playName(last.as)}】的效果。`, `${me.name} discards a BANG! to repeat ${pe(last.as)}.`)
      if (last.target != null && !isAlive(s, last.target)) {
        log(s, '目標已經不在了，沒有效果。', 'The target is gone; no effect.')
        break
      }
      effect(s, p, last.as, card(s, last.card), last.target, last.targetCard, last.target2, false)
      break
    }
  }
}


/** 亨利．布洛克：誰動了他的牌就挨一槍 */
function henry(s: GameState, victim: number, taker: number) {
  if (victim !== taker && hasChar(s, victim, 'henry') && isAlive(s, taker)) {
    log(s, `${nm(s, victim)} 對動他牌的 ${nm(s, taker)} 回敬一槍！`, `${nm(s, victim)} fires back at ${nm(s, taker)} for touching his cards!`)
    note(s, victim, taker, W.henry)
    s.q.push({ k: 'shot', from: victim, to: taker, need: 1, src: 'bang' })
  }
}

function playCard(s: GameState, p: number, a: Extract<Action, { type: 'play' }>) {
  const legal = legalPlays(s, p).filter((l) => l.card === a.card)
  if (!legal.length) fail('這張牌現在不能用', 'That card cannot be played now')
  const l = (a.as ? legal.find((x) => x.as === a.as) : legal[0]) ?? legal[0]
  if (l.targets && (a.target == null || !l.targets.includes(a.target))) fail('請選擇一個合法的目標', 'Choose a valid target')
  const me = s.players[p]
  const t = a.target!
  // 代價：另外棄手牌
  const extra = a.extra ?? []
  if ((l.cost ?? 0) > 0) {
    if (extra.length !== l.cost || extra.includes(a.card) || new Set(extra).size !== extra.length || !extra.every((id) => me.hand.includes(id))) fail(`請另外選 ${l.cost} 張手牌棄掉`, `Choose ${l.cost} more card${(l.cost ?? 1) > 1 ? 's' : ''} to discard`)
    if (l.costKind === 'bang' && !extra.every((id) => isBangCard(s, p, id))) fail('需要另一張「砰！」', 'You need another BANG!')
  }
  // 拿／棄對方的哪張牌
  if (l.pickCard) {
    if (a.targetCard == null) fail('請選擇對方的哪一張牌', 'Choose which of their cards')
    if (a.targetCard === 'hand' && (l.tableOnly || !s.players[t].hand.length)) fail('請選對方場上的牌', 'Choose a card they have in play')
    if (a.targetCard !== 'hand' && !s.players[t].table.includes(a.targetCard as number)) fail('那張牌不在他場上', 'That card is not in play in front of them')
  }
  if (l.second) {
    const ok = l.second[t] ?? []
    if (ok.length && (a.target2 == null || !ok.includes(a.target2))) fail('請選第二個目標（距離目標 1 的人）', 'Choose a second target (at distance 1 from the first)')
  }

  // 淘金熱商店
  if (l.source === 'shop') return shopPlay(s, p, l, a)

  if (s.turn.must === a.card) s.turn.must = null
  const c = card(s, a.card)
  if (l.source === 'table') removeFromTable(s, p, a.card)
  else removeFromHand(s, p, a.card)
  for (const id of extra) {
    removeFromHand(s, p, id)
    toDiscard(s, id)
  }
  s.turn.played = (s.turn.played ?? 0) + 1

  // 裝備
  const col = CARD_DEFS[c.key].colour
  if (l.source === 'hand' && (col === 'blue' || col === 'green') && l.as === c.key) {
    const placeOn = (q: number, what: string, whatEn: string) => {
      s.players[q].table.push(c.id)
      log(s, `${me.name} ${what}`, `${me.name} ${whatEn}`)
      fx(s, { kind: 'equip', from: p, to: q, card: c })
      if (q !== p) note(s, p, q, c.key === 'jail' ? W.jail : c.key === 'rattlesnake' ? W.rattlesnake : W.bounty)
      if (apacheBlocks(s, p, q, c)) {
        removeFromTable(s, q, c.id)
        toDiscard(s, c.id)
        log(s, `方塊牌對 ${nm(s, q)} 無效，${cardLabel(c)}被丟掉。`, `Diamonds have no effect on ${nm(s, q)}; ${ce(c)} is discarded.`)
      }
    }
    if (c.key === 'jail') return placeOn(t, `把 ${nm(s, t)} 關進【監獄】。`, `puts ${nm(s, t)} in Jail.`)
    if (c.key === 'rattlesnake') return placeOn(t, `把【響尾蛇】放在 ${nm(s, t)} 面前。`, `puts a Rattlesnake in front of ${nm(s, t)}.`)
    if (c.key === 'bounty') return placeOn(t, `懸賞 ${nm(s, t)} 的人頭！`, `puts a Bounty on ${nm(s, t)}!`)
    if (c.key === 'ghostcard') {
      const x = s.players[t]
      x.table.push(c.id)
      x.alive = true
      x.ghost = 'card'
      x.hp = 0
      log(s, `👻 ${me.name} 讓 ${x.name} 以幽靈身分回到牌桌！`, `👻 ${me.name} brings ${x.name} back to the table as a ghost!`)
      note(s, p, t, W.revive)
      fx(s, { kind: 'revive', to: t })
      return
    }
    if (isWeapon(c.key)) {
      const old = me.table.find((id) => isWeapon(keyOf(s, id)))
      if (old != null) {
        removeFromTable(s, p, old)
        toDiscard(s, old)
      }
    }
    me.table.push(c.id)
    if (col === 'green') s.greenAt[c.id] = s.turn.no
    log(
      s,
      `${me.name} ${col === 'green' ? '把綠牌' : '裝備'}${cardLabel(c)}${col === 'green' ? '放到場上（下一回合起可用）' : ''}。`,
      col === 'green' ? `${me.name} puts the green card ${ce(c)} into play (usable from next turn).` : `${me.name} equips ${ce(c)}.`,
    )
    fx(s, { kind: 'equip', from: p, to: p, card: c })
    return
  }

  toDiscard(s, c.id)
  if (l.as === 'gatling' && c.key !== 'gatling') (s.turn.uses ??= {}).ringer = 1
  if (l.as === 'flower') (s.turn.uses ??= {}).flower = 1
  if (col === 'brown') s.turn.last = { as: l.as, target: a.target, targetCard: a.targetCard, target2: a.target2, card: c.id }
  effect(s, p, l.as, c, a.target, a.targetCard, a.target2, true)
}

/** 淘金熱：買裝備、棄別人的裝備 */
function shopPlay(s: GameState, p: number, l: LegalPlay, a: Extract<Action, { type: 'play' }>) {
  const g = s.gold!
  const me = s.players[p]
  const uid = l.card
  g.nuggets[p] -= l.price ?? 0
  if (l.as === 'golddrop') {
    const owner = a.target!
    g.equip[owner] = g.equip[owner].filter((x) => x !== uid)
    g.deck.push(uid)
    log(s, `${me.name} 付 ${l.price} 金塊，棄掉 ${nm(s, owner)} 的【${GOLD_DEFS[goldKey(s, uid)].name}】。`, `${me.name} pays ${l.price} nuggets to discard ${nm(s, owner)}’s ‘${GOLD_EN[goldKey(s, uid)].name}’.`)
    note(s, p, owner, W.takeCard)
    return
  }
  const key = goldKey(s, uid)
  const def = GOLD_DEFS[key]
  const free = g.free[p] === uid
  if (free) g.free[p] = null
  else {
    g.shop = g.shop.filter((x) => x !== uid)
    const discount = hasChar(s, p, 'luzena') && !(s.turn.uses?.luzena ?? 0) && (l.price ?? 0) < def.cost
    if (discount) (s.turn.uses ??= {}).luzena = 1
  }
  refillShop(s)
  log(
    s,
    `${me.name} ${free ? '使用' : `花 ${l.price} 金塊買下`}【${def.name}】${l.as !== key ? `當作【${playName(l.as)}】` : ''}。`,
    `${me.name} ${free ? 'uses' : `buys for ${l.price} nuggets`} ‘${GOLD_EN[key].name}’${l.as !== key ? ` as ${pe(l.as)}` : ''}.`,
  )
  if (def.kind === 'black') {
    const owner = key === 'wanted' ? a.target! : p
    g.equip[owner].push(uid)
    fx(s, { kind: 'equip', from: p, to: owner })
    if (key === 'wanted') {
      log(s, `${nm(s, owner)} 被通緝了！`, `${nm(s, owner)} is now Wanted!`)
      note(s, p, owner, W.bounty)
    }
    return
  }
  g.deck.push(uid)
  effect(s, p, l.as, null, a.target, a.targetCard, a.target2, true)
}

/** 執行一張牌的效果（打出時、李．范．克利夫重複時都用這裡） */
function effect(s: GameState, p: number, as: PlayAs, c: Card | null, t: number | undefined, targetCard: number | 'hand' | undefined, target2: number | undefined, fresh: boolean) {
  const me = s.players[p]
  const via = c ? cardLabel(c) : `【${playName(as)}】`
  const viaE = c ? ce(c) : pe(as)
  if (fresh) fx(s, { kind: 'play', from: p, to: t, card: c ?? undefined })
  if (t != null && apacheBlocks(s, p, t, c) && as !== 'duel') {
    log(s, `${me.name} 打出${via}，但方塊牌對 ${nm(s, t)} 無效。`, `${me.name} plays ${viaE}, but Diamonds have no effect on ${nm(s, t)}.`)
    if (as === 'bang' || as === 'sniper' || as === 'fanning' || as === 'aim') s.turn.bangs++
    return
  }
  const suit = c ? suitOf(s, c) : undefined
  const shot = (to: number, need: number, src: CardKey, opts: { dmg?: number; bangCard?: boolean } = {}) => {
    note(s, p, to, (opts.dmg ?? 1) >= 2 ? W.aim : W.shoot)
    let sure = false
    if (opts.bangCard && hasChar(s, p, 'colorado')) sure = !check(s, p, (x) => x.suit !== 'S', bi('科羅拉多比爾的能力', 'Colorado Bill’s ability'))
    if (sure) log(s, `黑桃！這一槍躲不掉。`, 'A Spade! This shot cannot be dodged.')
    s.q.push({ k: 'shot', from: p, to, need, src, suit, sure, ...opts })
  }
  switch (as) {
    case 'bang':
    case 'flower':
      if (as === 'bang' && fresh && c) s.turn.bangs++
      log(s, `${me.name} 對 ${nm(s, t!)} ${c && c.key === 'bang' ? '打出【砰！】' : `用${via}當作【砰！】`}。`, `${me.name} ${c && c.key === 'bang' ? 'plays BANG!' : `plays ${viaE} as a BANG!`} at ${nm(s, t!)}.`)
      shot(t!, hasChar(s, p, 'slab') ? 2 : 1, 'bang', { bangCard: true })
      break
    case 'sniper':
      s.turn.bangs++
      log(s, `${me.name} 棄 2 張「砰！」狙擊 ${nm(s, t!)}（要 2 張「射偏了！」才躲得掉）。`, `${me.name} discards 2 BANG! to snipe ${nm(s, t!)} (needs 2 Missed! to dodge).`)
      shot(t!, 2, 'bang', { bangCard: true })
      break
    case 'fanning':
      if (fresh) s.turn.bangs++
      log(s, `${me.name} 用【連開】射擊 ${nm(s, t!)}${target2 != null ? ` 和 ${nm(s, target2)}` : ''}。`, `${me.name} fans the hammer at ${nm(s, t!)}${target2 != null ? ` and ${nm(s, target2)}` : ''}.`)
      shot(t!, 1, 'bang', { bangCard: true })
      if (target2 != null && isAlive(s, target2)) shot(target2, 1, 'bang', { bangCard: true })
      break
    case 'aim':
      if (fresh) s.turn.bangs++
      log(s, `${me.name} 瞄準 ${nm(s, t!)}，打中會失去 2 點生命！`, `${me.name} takes aim at ${nm(s, t!)}: a hit costs 2 life!`)
      shot(t!, hasChar(s, p, 'slab') ? 2 : 1, 'bang', { dmg: 2, bangCard: true })
      break
    case 'ricochet': {
      const tc = targetCard as number
      if (!s.players[t!].table.includes(tc)) return
      log(s, `${me.name} 用【砰！】射擊 ${nm(s, t!)} 場上的${cardLabel(card(s, tc))}。`, `${me.name} shoots at ${nm(s, t!)}’s ${ce(card(s, tc))} with a BANG!.`)
      note(s, p, t!, keyOf(s, tc) === 'jail' ? W.freeFromJail : keyOf(s, tc) === 'dynamite' ? W.removeDynamite : W.takeCard)
      s.q.push({ k: 'ask', kind: 'ricochet', player: t!, from: p, targetCard: tc })
      break
    }
    case 'punch':
    case 'knife':
    case 'derringer':
    case 'springfield':
    case 'pepperbox':
    case 'buffalo':
    case 'tomahawk':
      log(s, `${me.name} 用${via}攻擊 ${nm(s, t!)}。`, `${me.name} attacks ${nm(s, t!)} with ${viaE}.`)
      if (as === 'derringer') draw(s, p, 1)
      shot(t!, 1, as)
      break
    case 'beer': {
      const n = heal(s, p, hasChar(s, p, 'tequilajoe') ? 2 : 1)
      log(s, `${me.name} 喝了【啤酒】，回 ${n} 點（${me.hp}/${me.maxHp}）。`, `${me.name} drinks a Beer and regains ${n} (${me.hp}/${me.maxHp}).`)
      beerPlayed(s, p)
      break
    }
    case 'nugget':
      addNuggets(s, p, 1)
      log(s, `${me.name} 把【啤酒】換成 1 金塊。`, `${me.name} trades a Beer for 1 nugget.`)
      beerPlayed(s, p)
      break
    case 'canteen':
    case 'lastcall':
      heal(s, p, 1)
      log(s, `${me.name} 喝了${via}（${me.hp}/${me.maxHp}）。`, `${me.name} drinks ${viaE} (${me.hp}/${me.maxHp}).`)
      break
    case 'whisky':
      heal(s, p, 2)
      log(s, `${me.name} 喝了【威士忌】（${me.hp}/${me.maxHp}）。`, `${me.name} drinks a Whisky (${me.hp}/${me.maxHp}).`)
      break
    case 'tequila':
    case 'shotglass':
      heal(s, t!, 1)
      note(s, p, t!, W.heal)
      log(s, `${me.name} 請 ${nm(s, t!)} 喝${via}（${s.players[t!].hp}/${s.players[t!].maxHp}）。`, `${me.name} buys ${nm(s, t!)} ${viaE} (${s.players[t!].hp}/${s.players[t!].maxHp}).`)
      break
    case 'saloon':
      log(s, `${me.name} 打出【酒館】，所有人回復 1 點生命。`, `${me.name} plays Saloon: everyone regains 1 life.`)
      for (const q of alive(s)) heal(s, q, 1)
      break
    case 'stagecoach':
      draw(s, p, 2)
      log(s, `${me.name} 打出【驛馬車】，抽 2 張。`, `${me.name} plays Stagecoach and draws 2.`)
      break
    case 'wellsfargo':
    case 'pony':
      draw(s, p, 3)
      log(s, `${me.name} 打出${via}，抽 3 張。`, `${me.name} plays ${viaE} and draws 3.`)
      break
    case 'unionpacific':
      draw(s, p, 4)
      log(s, `${me.name} 搭上【聯合太平洋】，抽 4 張。`, `${me.name} boards the Union Pacific and draws 4.`)
      break
    case 'rum': {
      const suits = new Set<Suit>()
      const flipped: string[] = []
      for (let i = 0; i < 4; i++) {
        const id = drawOne(s)
        if (id == null) break
        const st = suitOf(s, card(s, id))
        suits.add(st)
        flipped.push(cardSuitLabel({ ...card(s, id), suit: st }))
        toDiscard(s, id)
      }
      const n = heal(s, p, suits.size)
      log(s, `${me.name} 喝【蘭姆酒】抽判定 ${flipped.join('、')}，${suits.size} 種花色，回 ${n} 點生命。`, `${me.name} drinks Rum and draws! ${flipped.join(', ')}: ${suits.size} suit${suits.size > 1 ? 's' : ''}, regains ${n} life.`)
      break
    }
    case 'goldrushcard':
      heal(s, p, me.maxHp)
      log(s, `${me.name} 挖到金礦！回滿生命，這回合結束後再玩一回合。`, `${me.name} strikes gold! Full life, and another turn after this one.`)
      s.turn.again = true
      s.turn.phase = 'end'
      s.q.push({ k: 'endTurn' })
      break
    case 'store': {
      const n = alive(s).length
      s.store = []
      for (let i = 0; i < n; i++) {
        const id = drawOne(s)
        if (id != null) s.store.push(id)
      }
      log(s, `${me.name} 打出【雜貨店】，翻開 ${s.store.map((id) => cardLabel(card(s, id))).join('')}。`, `${me.name} plays General Store, revealing ${s.store.map((id) => ce(card(s, id))).join(', ')}.`)
      let q = p
      for (let i = 0; i < n; i++) {
        s.q.push({ k: 'ask', kind: 'store', player: q, from: p })
        q = nextAlive(s, q)
      }
      break
    }
    case 'gatling':
    case 'howitzer':
      log(s, `${me.name} 用${c && c.key !== as ? `${via}當作【格林機槍】` : via}掃射所有人！`, `${me.name} sprays everyone with ${c && c.key !== as ? `${viaE} as a Gatling` : viaE}!`)
      for (let q = nextAlive(s, p); q !== p; q = nextAlive(s, q)) {
        if (apacheBlocks(s, p, q, c)) log(s, `方塊牌對 ${nm(s, q)} 無效。`, `Diamonds have no effect on ${nm(s, q)}.`)
        else {
          note(s, p, q, s.players[q].hp <= 1 ? W.areaLethal : W.area)
          s.q.push({ k: 'shot', from: p, to: q, need: 1, src: as === 'howitzer' ? 'howitzer' : 'gatling', suit })
        }
      }
      break
    case 'indians':
    case 'bandidos':
    case 'poker':
      log(s, `${me.name} 打出${via}。`, `${me.name} plays ${viaE}.`)
      if (as === 'poker') s.poker = []
      for (let q = nextAlive(s, p); q !== p; q = nextAlive(s, q)) {
        if (apacheBlocks(s, p, q, c)) log(s, `方塊牌對 ${nm(s, q)} 無效。`, `Diamonds have no effect on ${nm(s, q)}.`)
        else if (as !== 'poker' || s.players[q].hand.length) {
          if (as === 'indians') note(s, p, q, s.players[q].hp <= 1 ? W.areaLethal : W.area)
          s.q.push({ k: 'ask', kind: as, player: q, from: p })
        }
      }
      if (as === 'poker') s.q.push({ k: 'pokerEnd', user: p })
      break
    case 'tornado': {
      log(s, `${me.name} 捲起【龍捲風】！`, `${me.name} whips up a Tornado!`)
      let q = p
      for (let i = 0; i < s.players.length; i++) {
        if (s.players[q].alive) {
          if (s.players[q].hand.length) s.q.push({ k: 'ask', kind: 'tornado', player: q, from: p })
          s.q.push({ k: 'drawN', to: q, n: 2 })
        }
        q = nextAlive(s, q, 1)
        if (q === p) break
      }
      break
    }
    case 'duel':
      log(s, `${me.name} 向 ${nm(s, t!)} 提出【決鬥】！`, `${me.name} challenges ${nm(s, t!)} to a Duel!`)
      note(s, p, t!, W.shoot)
      s.q.push({ k: 'ask', kind: 'duel', player: t!, from: p })
      break
    case 'brawl':
      log(s, `${me.name} 引發【鬥毆】！`, `${me.name} starts a Brawl!`)
      for (let q = nextAlive(s, p); q !== p; q = nextAlive(s, q)) {
        if (!hasCards(s, q)) continue
        if (apacheBlocks(s, p, q, c)) log(s, `方塊牌對 ${nm(s, q)} 無效。`, `Diamonds have no effect on ${nm(s, q)}.`)
        else s.q.push({ k: 'ask', kind: 'brawl', player: p, target: q })
      }
      break
    case 'panic':
    case 'catbalou':
    case 'ragtime':
    case 'cancan':
    case 'conestoga': {
      const steal = as === 'panic' || as === 'ragtime' || as === 'conestoga'
      if (!hasCards(s, t!)) return
      const which = targetCard === 'hand' && !s.players[t!].hand.length ? s.players[t!].table[0] : targetCard
      if (which !== 'hand' && !s.players[t!].table.includes(which as number)) return
      takeCard(s, p, t!, which!, steal, bi(via, viaE))
      break
    }
    default:
      fail('這張牌現在不能用', 'That card cannot be played now')
  }
}

/** 拿走（或棄掉）別人的一張牌 */
function takeCard(s: GameState, p: number, t: number, which: number | 'hand', steal: boolean, via: string, w: number = W.takeCard) {
  const x = s.players[t]
  const me = s.players[p]
  // 拿掉別人的監獄或炸藥是在幫他
  note(s, p, t, which === 'hand' ? w : keyOf(s, which) === 'jail' ? W.freeFromJail : keyOf(s, which) === 'dynamite' ? W.removeDynamite : w)
  let taken: number
  if (which === 'hand') {
    if (!x.hand.length) return
    taken = x.hand[Math.floor(rand(s) * x.hand.length)]
    removeFromHand(s, t, taken)
  } else {
    taken = which
    removeFromTable(s, t, taken)
    delete s.greenAt[taken]
  }
  const where = which === 'hand' ? '一張手牌' : cardLabel(card(s, taken))
  const whereE = which === 'hand' ? 'a card from hand' : ce(card(s, taken))
  if (steal) {
    me.hand.push(taken)
    log(s, `${me.name} 用${zhOf(via)}拿走 ${x.name} 的${where}。`, `${me.name} uses ${enOf(via)} to take ${x.name}’s ${whereE}.`)
    fx(s, { kind: 'steal', from: t, to: p })
  } else {
    toDiscard(s, taken)
    log(
      s,
      `${me.name} 用${zhOf(via)}棄掉 ${x.name} 的${which === 'hand' ? `手牌${cardLabel(card(s, taken))}` : where}。`,
      `${me.name} uses ${enOf(via)} to discard ${x.name}’s ${which === 'hand' ? `${ce(card(s, taken))} from hand` : whereE}.`,
    )
  }
  henry(s, t, p)
}

function answer(s: GameState, a: Ask, ans: Extract<Action, { type: 'answer' }>) {
  const p = a.player
  const me = s.players[p]
  const view = askView(s, a)
  const pickOne = () => {
    const id = ans.cards?.[0]
    if (id == null || !view.cards.includes(id)) fail('請選一張可以用的牌', 'Choose a usable card')
    return id!
  }
  /** 從手牌或場上用掉一張牌 */
  const spend = (id: number) => {
    if (me.table.includes(id)) removeFromTable(s, p, id)
    else {
      removeFromHand(s, p, id)
      molly(s, p)
    }
    toDiscard(s, id)
  }
  switch (a.kind) {
    case 'respond': {
      s.q.shift()
      if (ans.opt === 'take') {
        s.q.unshift({ k: 'damage', to: p, amount: a.dmg ?? 1, from: a.from ?? null, bangCard: a.bangCard })
        return
      }
      const next: Ask = { ...a, barrels: [...(a.barrels ?? [])] }
      if (ans.opt === 'barrel') {
        const src = barrelSources(s, p, next.barrels!)[0]
        if (!src) fail('沒有可用的木桶', 'No Barrel to use')
        next.barrels!.push(src)
        if (check(s, p, (c) => c.suit === 'H', src === 'jour' ? bi('喬登奈的能力', 'Jourdonnais’s ability') : bi('【木桶】', 'the Barrel'))) next.got = (next.got ?? 0) + 1
      } else {
        const id = pickOne()
        const k = keyOf(s, id)
        const fromTable = me.table.includes(id)
        spend(id)
        if (k === 'escape') {
          log(s, `${me.name} 打出【逃脫】，躲開了。`, `${me.name} plays Escape and gets away.`)
          fx(s, { kind: 'miss', from: a.from ?? undefined, to: p })
          return
        }
        next.got = (next.got ?? 0) + 1
        log(
          s,
          `${me.name} 用${fromTable ? '場上的' : ''}${cardLabel(card(s, id))}${k === 'missed' ? '' : '當作【射偏了！】'}。`,
          `${me.name} uses ${fromTable ? 'the ' : ''}${ce(card(s, id))}${fromTable ? ' in play' : ''}${k === 'missed' ? '' : ' as a Missed!'}.`,
        )
        if (k === 'dodge' || k === 'bible') draw(s, p, 1)
        if (k === 'backfire' && a.from != null && isAlive(s, a.from)) {
          log(s, `${me.name} 回火反擊 ${nm(s, a.from)}！`, `${me.name} fires back at ${nm(s, a.from)}!`)
          note(s, p, a.from, W.backfire)
          s.q.push({ k: 'shot', from: p, to: a.from, need: 1, src: 'backfire' })
        }
      }
      if ((next.got ?? 0) >= (next.need ?? 1)) {
        log(s, `${me.name} 躲過了這一槍。`, `${me.name} dodges the shot.`)
        fx(s, { kind: 'miss', from: a.from ?? undefined, to: p })
        return
      }
      s.q.unshift(next)
      return
    }
    case 'indians':
    case 'duel': {
      s.q.shift()
      if (ans.opt === 'take') {
        s.q.unshift({ k: 'damage', to: p, amount: 1, from: a.from ?? null })
        if (a.kind === 'duel') log(s, `${me.name} 輸了決鬥。`, `${me.name} loses the duel.`)
        return
      }
      const id = pickOne()
      const k = keyOf(s, id)
      spend(id)
      if (k === 'escape' || (k === 'missed' && hasChar(s, p, 'mick') && !isBangCard(s, p, id))) {
        log(s, `${me.name} 用${cardLabel(card(s, id))}躲開了${a.kind === 'duel' ? '決鬥' : '印第安人'}。`, `${me.name} escapes the ${a.kind === 'duel' ? 'duel' : 'Indians'} with ${ce(card(s, id))}.`)
        return
      }
      log(s, `${me.name} 棄了一張${cardLabel(card(s, id))}。`, `${me.name} discards ${ce(card(s, id))}.`)
      if (a.kind === 'duel') s.q.unshift({ k: 'ask', kind: 'duel', player: a.from!, from: p })
      return
    }
    case 'store': {
      const id = pickOne()
      s.q.shift()
      s.store = s.store.filter((x) => x !== id)
      me.hand.push(id)
      log(s, `${me.name} 從雜貨店拿了${cardLabel(card(s, id))}。`, `${me.name} takes ${ce(card(s, id))} from the General Store.`)
      return
    }
    case 'dying': {
      if (ans.opt === 'die') {
        s.q.shift()
        s.q.unshift({ k: 'die', who: p, killer: a.from ?? null })
        return
      }
      const id = pickOne()
      const k = keyOf(s, id)
      spend(id)
      me.hp += k === 'beer' && hasChar(s, p, 'tequilajoe') ? 2 : 1
      me.hp = Math.min(me.hp, me.maxHp)
      log(s, `${me.name} 喝下${cardLabel(card(s, id))}撐住了（${me.hp}/${me.maxHp}）。`, `${me.name} drinks ${ce(card(s, id))} and hangs on (${me.hp}/${me.maxHp}).`)
      fx(s, { kind: 'heal', to: p, amount: 1 })
      if (k === 'beer') beerPlayed(s, p)
      if (me.hp > 0) s.q.shift()
      return
    }
    case 'discard': {
      const ids = ans.cards ?? []
      if (ids.length !== view.min || new Set(ids).size !== ids.length || !ids.every((id) => me.hand.includes(id))) fail(`請選 ${view.min} 張要棄掉的牌`, `Choose ${view.min} card${view.min > 1 ? 's' : ''} to discard`)
      const gary = alive(s).find((q) => q !== p && hasChar(s, q, 'gary'))
      for (const id of ids) {
        removeFromHand(s, p, id)
        if (gary != null) s.players[gary].hand.push(id)
        // 廢棄礦坑：棄的牌蓋回牌堆頂
        else if (evOn(s, 'mine')) s.deck.push(id)
        else toDiscard(s, id)
      }
      log(
        s,
        `${me.name} 棄掉 ${ids.length} 張牌${gary != null ? `，被 ${nm(s, gary)} 撿走` : evOn(s, 'mine') ? '（放回牌堆頂）' : ''}。`,
        `${me.name} discards ${ids.length} card${ids.length > 1 ? 's' : ''}${gary != null ? `, picked up by ${nm(s, gary)}` : evOn(s, 'mine') ? ' (back on top of the deck)' : ''}.`,
      )
      s.q.shift()
      return
    }
    case 'kit': {
      const ids = ans.cards ?? []
      const shown = a.cards ?? []
      if (ids.length !== view.min || !ids.every((id) => shown.includes(id)) || new Set(ids).size !== ids.length) fail(`請挑 ${view.min} 張`, `Choose ${view.min}`)
      me.hand.push(...ids)
      for (const id of shown) if (!ids.includes(id)) s.deck.push(id)
      log(s, `${me.name} 看了牌堆頂 ${shown.length} 張，拿走 ${ids.length} 張。`, `${me.name} looks at the top ${shown.length} cards and keeps ${ids.length}.`)
      s.q.shift()
      return
    }
    case 'dutch': {
      const id = pickOne()
      s.q.shift()
      me.hand.push(id)
      for (const x of a.cards ?? []) if (x !== id) toDiscard(s, x)
      addNuggets(s, p, 1)
      log(s, `${me.name} 留下 1 張牌，棄掉另一張${s.gold ? '，得到 1 金塊' : ''}。`, `${me.name} keeps 1 card and discards the other${s.gold ? ', gaining 1 nugget' : ''}.`)
      return
    }
    case 'jesse': {
      s.q.shift()
      const n = drawCount(s, p)
      if (ans.target != null) {
        if (!view.targets.includes(ans.target)) fail('他沒有手牌', 'They have no cards in hand')
        const x = s.players[ans.target]
        const id = x.hand[Math.floor(rand(s) * x.hand.length)]
        removeFromHand(s, ans.target, id)
        me.hand.push(id)
        note(s, p, ans.target, W.jesse)
        log(s, `${me.name} 從 ${x.name} 手上拿了一張牌。`, `${me.name} takes a card from ${x.name}’s hand.`)
        fx(s, { kind: 'steal', from: ans.target, to: p })
        henry(s, ans.target, p)
        phaseDraw(s, p, n - 1)
      } else phaseDraw(s, p, n)
      return
    }
    case 'pedro': {
      s.q.shift()
      const n = drawCount(s, p)
      if (ans.opt === 'discard' && s.discard.length) {
        const id = s.discard.pop()!
        me.hand.push(id)
        log(s, `${me.name} 拿走棄牌堆的${cardLabel(card(s, id))}。`, `${me.name} takes ${ce(card(s, id))} from the discard pile.`)
        phaseDraw(s, p, n - 1)
      } else phaseDraw(s, p, n)
      return
    }
    case 'pat': {
      s.q.shift()
      const id = ans.cards?.[0]
      if (id != null) {
        if (!view.cards.includes(id)) fail('請選場上的一張牌', 'Choose a card in play')
        const owner = s.players.find((x) => x.table.includes(id))!.seat
        takeCard(s, p, owner, id, true, bi('派特的能力', 'Pat Brennan’s ability'), W.pat)
      } else phaseDraw(s, p, drawCount(s, p))
      return
    }
    case 'evelyn': {
      s.q.shift()
      if (ans.target != null) {
        if (!view.targets.includes(ans.target)) fail('請選射程內還沒開過槍的人', 'Choose someone in range you have not shot yet')
        log(s, `${me.name} 少抽 1 張，對 ${nm(s, ans.target)} 開槍。`, `${me.name} draws one card fewer and shoots at ${nm(s, ans.target)}.`)
        note(s, p, ans.target, W.shoot)
        s.q.unshift({ k: 'shot', from: p, to: ans.target, need: 1, src: 'bang' }, { ...a, got: (a.got ?? 0) + 1, cards: [...(a.cards ?? []), ans.target] })
        return
      }
      phaseDraw(s, p, drawCount(s, p) - (a.got ?? 0))
      return
    }
    case 'vera': {
      s.q.shift()
      if (ans.target != null) {
        if (!view.targets.includes(ans.target)) fail('請選一名活著的玩家', 'Choose a living player')
        me.copy = s.players[ans.target].character
        log(s, `${me.name} 複製了 ${nm(s, ans.target)} 的能力（${CHAR_BY_ID[me.copy!].name}）。`, `${me.name} copies ${nm(s, ans.target)}’s ability (${CHAR_EN[me.copy!].name}).`)
      } else me.copy = null
      return
    }
    case 'brawl': {
      s.q.shift()
      const x = s.players[a.target!]
      const which: number | 'hand' = ans.opt === 'hand' ? 'hand' : (ans.cards?.[0] ?? (x.hand.length ? 'hand' : x.table[0]))
      if (which !== 'hand' && !view.cards.includes(which)) fail('請選他場上的一張牌', 'Choose one of their cards in play')
      takeCard(s, p, a.target!, which, false, bi('【鬥毆】', 'Brawl'), W.brawl)
      return
    }
    case 'ricochet': {
      s.q.shift()
      if (ans.opt === 'take') {
        if (me.table.includes(a.targetCard!)) {
          removeFromTable(s, p, a.targetCard!)
          toDiscard(s, a.targetCard!)
          log(s, `${me.name} 場上的${cardLabel(card(s, a.targetCard!))}被打掉了。`, `${me.name}’s ${ce(card(s, a.targetCard!))} is shot away.`)
        }
        return
      }
      const id = pickOne()
      spend(id)
      log(s, `${me.name} 打出${cardLabel(card(s, id))}保住了場上的牌。`, `${me.name} plays ${ce(card(s, id))} to save the card.`)
      return
    }
    case 'daltons': {
      const id = pickOne()
      s.q.shift()
      removeFromTable(s, p, id)
      toDiscard(s, id)
      log(s, `${me.name} 棄掉場上的${cardLabel(card(s, id))}。`, `${me.name} discards ${ce(card(s, id))} from play.`)
      return
    }
    case 'handcuffs': {
      const suit = ans.opt as Suit
      if (!['H', 'D', 'C', 'S'].includes(suit)) fail('請選一個花色', 'Choose a suit')
      s.q.shift()
      s.turn.suit = suit
      log(s, `${me.name} 宣告了${SUIT_NAME[suit]}。`, `${me.name} names ${SUIT_EN[suit]}.`)
      return
    }
    case 'newidentity': {
      s.q.shift()
      const other = me.charOptions.find((c) => c !== me.character)
      if (ans.opt === 'swap' && other) {
        me.character = other
        me.copy = null
        me.copies = []
        me.maxHp = CHAR_BY_ID[other].hp + (me.role === 'sheriff' ? 1 : 0)
        me.hp = Math.min(2, me.maxHp)
        log(s, `${me.name} 換成了 ${CHAR_BY_ID[other].name}，生命變成 ${me.hp}。`, `${me.name} becomes ${CHAR_EN[other].name}, now at ${me.hp} life.`)
      }
      return
    }
    case 'blood': {
      s.q.shift()
      if (ans.target != null) {
        if (!view.targets.includes(ans.target) || me.hp <= 1) fail('不能這樣給血', 'You cannot give life like that')
        me.hp--
        fx(s, { kind: 'hit', to: p, amount: 1 })
        heal(s, ans.target, 1)
        note(s, p, ans.target, W.heal)
        log(s, `${me.name} 失去 1 點生命，讓 ${nm(s, ans.target)} 回 1 點。`, `${me.name} gives 1 life to ${nm(s, ans.target)}.`)
      }
      return
    }
    case 'liquor': {
      s.q.shift()
      if (ans.opt === 'heal') {
        heal(s, p, 1)
        log(s, `${me.name} 放棄抽牌，喝烈酒回 1 點生命。`, `${me.name} skips drawing and drinks Hard Liquor for 1 life.`)
        s.q = s.q.filter((t) => t.k !== 'drawPhase')
        s.turn.phase = 'play'
      }
      return
    }
    case 'peyote': {
      if (ans.opt !== 'red' && ans.opt !== 'black') fail('請猜紅色或黑色', 'Guess red or black')
      s.q.shift()
      const id = drawOne(s)
      if (id == null) return
      const st = suitOf(s, card(s, id))
      const red = st === 'H' || st === 'D'
      const ok = (ans.opt === 'red') === red
      fx(s, { kind: 'check', to: p, card: { ...card(s, id), suit: st }, ok })
      if (ok) {
        me.hand.push(id)
        log(s, `${me.name} 猜${ans.opt === 'red' ? '紅' : '黑'}，翻出 ${cardSuitLabel({ ...card(s, id), suit: st })}，猜對了！`, `${me.name} guesses ${ans.opt}, flips ${cardSuitLabel({ ...card(s, id), suit: st })}: right!`)
        s.q.unshift({ ...a, got: (a.got ?? 0) + 1 })
      } else {
        toDiscard(s, id)
        log(s, `${me.name} 猜${ans.opt === 'red' ? '紅' : '黑'}，翻出 ${cardSuitLabel({ ...card(s, id), suit: st })}，猜錯了。`, `${me.name} guesses ${ans.opt}, flips ${cardSuitLabel({ ...card(s, id), suit: st })}: wrong.`)
      }
      return
    }
    case 'ranch': {
      const ids = ans.cards ?? []
      if (new Set(ids).size !== ids.length || !ids.every((id) => me.hand.includes(id))) fail('請選自己的手牌', 'Choose cards from your own hand')
      s.q.shift()
      for (const id of ids) {
        removeFromHand(s, p, id)
        toDiscard(s, id)
      }
      draw(s, p, ids.length)
      if (ids.length) log(s, `${me.name} 在牧場換了 ${ids.length} 張牌。`, `${me.name} swaps ${ids.length} card${ids.length > 1 ? 's' : ''} at the Ranch.`)
      return
    }
    case 'roulette': {
      s.q.shift()
      if (ans.opt === 'take') {
        log(s, `${me.name} 沒有「射偏了！」，輪盤停在他身上。`, `${me.name} has no Missed!: the roulette stops on them.`)
        s.q.unshift({ k: 'damage', to: p, amount: 2, from: null })
        return
      }
      const id = pickOne()
      spend(id)
      log(s, `${me.name} 棄了${cardLabel(card(s, id))}。`, `${me.name} discards ${ce(card(s, id))}.`)
      s.q.unshift({ k: 'ask', kind: 'roulette', player: nextAlive(s, p) })
      return
    }
    case 'bandidos': {
      s.q.shift()
      if (ans.opt === 'take') {
        s.q.unshift({ k: 'damage', to: p, amount: 1, from: a.from ?? null })
        return
      }
      if (ans.opt === 'escape' || ans.opt === 'mick') {
        const id = (ans.opt === 'escape' ? escapeCards(s, p) : missedCards(s, p))[0]
        if (id == null) fail('沒有可以用的牌', 'No usable card')
        spend(id)
        log(s, `${me.name} 用${cardLabel(card(s, id))}躲開了土匪。`, `${me.name} avoids the Bandidos with ${ce(card(s, id))}.`)
        return
      }
      const ids = ans.cards ?? []
      if (ids.length !== view.min || new Set(ids).size !== ids.length || !ids.every((id) => me.hand.includes(id))) fail(`請選 ${view.min} 張手牌`, `Choose ${view.min} card${view.min > 1 ? 's' : ''} from hand`)
      for (const id of ids) {
        removeFromHand(s, p, id)
        toDiscard(s, id)
      }
      log(s, `${me.name} 棄了 ${ids.length} 張手牌打發土匪。`, `${me.name} pays off the Bandidos with ${ids.length} card${ids.length > 1 ? 's' : ''}.`)
      return
    }
    case 'poker': {
      const id = pickOne()
      s.q.shift()
      removeFromHand(s, p, id)
      s.poker.push(id)
      log(s, `${me.name} 丟出${cardLabel(card(s, id))}${cardSuitLabel(card(s, id))}。`, `${me.name} throws in ${ce(card(s, id))} ${cardSuitLabel(card(s, id))}.`)
      return
    }
    case 'pokertake': {
      const ids = ans.cards ?? []
      if (ids.length > view.max || !ids.every((id) => s.poker.includes(id))) fail(`最多拿 ${view.max} 張`, `Take at most ${view.max}`)
      s.q.shift()
      me.hand.push(...ids)
      for (const id of s.poker) if (!ids.includes(id)) toDiscard(s, id)
      s.poker = []
      log(s, `${me.name} 從撲克牌局拿走 ${ids.length} 張。`, `${me.name} takes ${ids.length} card${ids.length > 1 ? 's' : ''} from the Poker pot.`)
      return
    }
    case 'tornado': {
      const id = pickOne()
      s.q.shift()
      removeFromHand(s, p, id)
      toDiscard(s, id)
      return
    }
    case 'lemonade': {
      s.q.shift()
      const id = ans.cards?.[0]
      if (id == null) return
      if (!me.hand.includes(id)) fail('請選自己的手牌', 'Choose cards from your own hand')
      removeFromHand(s, p, id)
      toDiscard(s, id)
      heal(s, p, 1)
      log(s, `${me.name} 也喝了一杯檸檬水，回 1 點生命。`, `${me.name} has a lemonade too and regains 1 life.`)
      return
    }
    case 'youl': {
      const id = pickOne()
      s.q.shift()
      removeFromHand(s, p, id)
      s.players[a.target!].hand.push(id)
      log(s, `${me.name} 給了 ${nm(s, a.target!)} 1 張手牌。`, `${me.name} gives ${nm(s, a.target!)} 1 card.`)
      return
    }
  }
}

// ───────────── 自動流程 ─────────────
function run(s: GameState) {
  for (let guard = 0; guard < 10000; guard++) {
    if (s.result) {
      s.q = []
      return
    }
    // 蘇西：手牌空了就抽一張
    for (const q of alive(s))
      if (hasChar(s, q, 'suzy') && s.players[q].hand.length === 0 && s.turn.phase !== 'choose') {
        draw(s, q, 1)
        log(s, `${nm(s, q)} 手牌用完，抽 1 張。`, `${nm(s, q)} is out of cards and draws 1.`)
      }
    // 幽靈牌被拿走：幽靈再次離場
    for (const x of s.players)
      if (x.alive && x.ghost === 'card' && !x.table.some((id) => keyOf(s, id) === 'ghostcard')) {
        x.alive = false
        x.ghost = null
        for (const id of [...x.hand, ...x.table]) toDiscard(s, id)
        x.hand = []
        x.table = []
        log(s, `👻 ${x.name} 的幽靈消散了。`, `👻 ${x.name}’s ghost fades away.`)
        if (x.seat === s.turn.active && s.turn.phase !== 'end') {
          s.q = []
          s.turn.phase = 'end'
          s.q.push({ k: 'nextTurn' })
        }
      }
    const head = s.q[0]
    if (!head) return
    if (head.k === 'ask') {
      if (autoAsk(s, head)) continue
      return
    }
    s.q.shift()
    step(s, head)
  }
  throw new Error('流程進入無限迴圈')
}

/** 沒有任何選擇的詢問直接替玩家處理 */
function autoAsk(s: GameState, a: Ask): boolean {
  if (!isAlive(s, a.player)) {
    s.q.shift()
    return true
  }
  const v = askView(s, a)
  const auto = (next?: Task) => {
    s.q.shift()
    if (next) s.q.unshift(next)
    return true
  }
  switch (a.kind) {
    case 'respond':
    case 'indians':
    case 'duel':
      if (!v.cards.length && v.options.length === 1) {
        if (a.kind === 'duel') log(s, `${nm(s, a.player)} 沒有「砰！」，輸了決鬥。`, `${nm(s, a.player)} has no BANG! and loses the duel.`)
        return auto({ k: 'damage', to: a.player, amount: a.dmg ?? 1, from: a.from ?? null, bangCard: a.bangCard })
      }
      return false
    case 'roulette':
      if (!v.cards.length) {
        log(s, `${nm(s, a.player)} 沒有「射偏了！」，輪盤停在他身上。`, `${nm(s, a.player)} has no Missed!: the roulette stops on them.`)
        return auto({ k: 'damage', to: a.player, amount: 2, from: null })
      }
      return false
    case 'ricochet':
      if (!v.cards.length) {
        const owner = s.players[a.player]
        if (owner.table.includes(a.targetCard!)) {
          removeFromTable(s, a.player, a.targetCard!)
          toDiscard(s, a.targetCard!)
          log(s, `${owner.name} 場上的${cardLabel(card(s, a.targetCard!))}被打掉了。`, `${owner.name}’s ${ce(card(s, a.targetCard!))} is shot away.`)
        }
        return auto()
      }
      return false
    case 'store':
      if (s.store.length <= 1) {
        const id = s.store.pop()
        if (id != null) {
          s.players[a.player].hand.push(id)
          log(s, `${nm(s, a.player)} 拿走雜貨店最後一張${cardLabel(card(s, id))}。`, `${nm(s, a.player)} takes the last card in the General Store, ${ce(card(s, id))}.`)
        }
        return auto()
      }
      return false
    case 'dying':
      if (s.players[a.player].hp > 0) return auto()
      if (!v.cards.length && !canSid(s, a.player) && !canRucksack(s, a.player)) return auto({ k: 'die', who: a.player, killer: a.from ?? null })
      return false
    case 'discard':
      return v.min <= 0 ? auto() : false
    case 'pedro':
    case 'jesse':
    case 'pat':
      if ((a.kind === 'pedro' && !s.discard.length) || (a.kind === 'jesse' && !v.targets.length) || (a.kind === 'pat' && !v.cards.length)) {
        auto()
        phaseDraw(s, a.player, drawCount(s, a.player))
        return true
      }
      return false
    case 'evelyn':
      if (!v.targets.length) {
        auto()
        phaseDraw(s, a.player, drawCount(s, a.player) - (a.got ?? 0))
        return true
      }
      return false
    case 'vera':
    case 'blood':
      return v.targets.length ? false : auto()
    case 'daltons':
    case 'poker':
    case 'tornado':
    case 'youl':
    case 'lemonade':
      return v.cards.length ? false : auto()
    case 'pokertake':
      if (!s.poker.length) return auto()
      return false
    case 'brawl': {
      const x = s.players[a.target!]
      if (!x.hand.length && !x.table.length) return auto()
      return false
    }
    case 'bandidos':
      if (!s.players[a.player].hand.length && v.options.length === 1) return auto({ k: 'damage', to: a.player, amount: 1, from: a.from ?? null })
      return false
    case 'newidentity':
      return s.players[a.player].charOptions.some((c) => c !== s.players[a.player].character) ? false : auto()
    case 'ranch':
      return s.players[a.player].hand.length ? false : auto()
    default:
      return false
  }
}

/** 抽牌階段要抽幾張 */
function drawCount(s: GameState, p: number) {
  const x = s.players[p]
  if (x.ghost === 'town') return 3
  let n = 2
  if (hasChar(s, p, 'pixie')) n = 3
  if (hasChar(s, p, 'bill')) n = 1 + (x.maxHp - x.hp)
  if (evOn(s, 'thirst')) n = 1
  if (evOn(s, 'train')) n++
  if (goldHas(s, p, 'pickaxe')) n++
  if (hasChar(s, p, 'tuco') && !x.table.some((id) => CARD_DEFS[keyOf(s, id)].colour === 'blue')) n += 2
  return Math.max(0, n)
}

function step(s: GameState, t: Task) {
  switch (t.k) {
    case 'startTurn':
      return startTurn(s)
    case 'turnChecks':
      return turnChecks(s)
    case 'drawPhase':
      return drawPhase(s)
    case 'afterDraw':
      return afterDraw(s)
    case 'drawN':
      if (isAlive(s, t.to)) draw(s, t.to, t.n)
      return
    case 'pokerEnd': {
      if (!s.poker.length) return
      const ace = s.poker.some((id) => card(s, id).rank === 14)
      if (ace || !isAlive(s, t.user)) {
        log(s, ace ? '有人出了 A，撲克牌全部棄掉。' : '撲克牌全部棄掉。', ace ? 'Someone threw an Ace: all Poker cards are discarded.' : 'All Poker cards are discarded.')
        for (const id of s.poker) toDiscard(s, id)
        s.poker = []
        return
      }
      s.q.unshift({ k: 'ask', kind: 'pokertake', player: t.user })
      return
    }
    case 'shot': {
      if (!isAlive(s, t.to)) return
      if (t.from != null) fx(s, { kind: 'shoot', from: t.from, to: t.to })
      if (t.from != null && t.from !== t.to && (hasChar(s, t.to, 'apache') || goldHas(s, t.to, 'calumet')) && t.suit === 'D') {
        log(s, `方塊牌對 ${nm(s, t.to)} 無效。`, `Diamonds have no effect on ${nm(s, t.to)}.`)
        return
      }
      if (t.sure) {
        s.q.unshift({ k: 'damage', to: t.to, amount: t.dmg ?? 1, from: t.from, bangCard: t.bangCard })
        return
      }
      s.q.unshift({ k: 'ask', kind: 'respond', player: t.to, from: t.from, need: t.need, got: 0, barrels: [], src: t.src, dmg: t.dmg, bangCard: t.bangCard })
      return
    }
    case 'damage': {
      const x = s.players[t.to]
      if (!x.alive) return
      if (x.ghost) {
        log(s, `${x.name} 是幽靈，不會受傷。`, `${x.name} is a ghost and cannot be hurt.`)
        return
      }
      x.hp -= t.amount
      log(s, `${x.name} 失去 ${t.amount} 點生命（${Math.max(0, x.hp)}/${x.maxHp}）。`, `${x.name} loses ${t.amount} life (${Math.max(0, x.hp)}/${x.maxHp}).`)
      fx(s, { kind: 'hit', from: t.from ?? undefined, to: t.to, amount: t.amount })
      // 淘金熱：打傷別人就拿金塊
      if (t.from != null && t.from !== t.to && isAlive(s, t.from)) addNuggets(s, t.from, t.amount)
      if (hasChar(s, t.to, 'simeon')) addNuggets(s, t.to, t.amount)
      const after: Task = { k: 'afterDamage', to: t.to, amount: t.amount, from: t.from }
      // 懸賞：用「砰！」打中的人抽 1 張
      if (t.bangCard && t.from != null && isAlive(s, t.from) && tableHas(s, t.to, 'bounty')) {
        draw(s, t.from, 1)
        log(s, `${nm(s, t.from)} 領到懸賞，抽 1 張。`, `${nm(s, t.from)} collects the Bounty and draws 1.`)
      }
      // 霰彈槍：被打傷的人棄 1 張手牌
      if (t.from != null && t.from !== t.to && tableHas(s, t.from, 'shotgun') && x.hand.length) {
        const id = x.hand[Math.floor(rand(s) * x.hand.length)]
        removeFromHand(s, t.to, id)
        toDiscard(s, id)
        log(s, `${x.name} 被霰彈槍打掉手上的${cardLabel(card(s, id))}。`, `The Shotgun blasts ${ce(card(s, id))} out of ${x.name}’s hand.`)
      }
      if (x.hp <= 0) s.q.unshift({ k: 'ask', kind: 'dying', player: t.to, from: t.from }, after)
      else s.q.unshift(after)
      return
    }
    case 'afterDamage': {
      const x = s.players[t.to]
      if (!x.alive) return
      if (hasChar(s, t.to, 'bart')) {
        draw(s, t.to, t.amount)
        log(s, `${x.name} 受傷，抽 ${t.amount} 張牌。`, `${x.name} is hurt and draws ${t.amount}.`)
      }
      if (goldHas(s, t.to, 'boots')) draw(s, t.to, t.amount)
      if (goldHas(s, t.to, 'luckycharm')) addNuggets(s, t.to, t.amount)
      if (hasChar(s, t.to, 'gringo') && t.from != null && t.from !== t.to && isAlive(s, t.from)) {
        const src = s.players[t.from]
        for (let i = 0; i < t.amount && src.hand.length; i++) {
          const id = src.hand[Math.floor(rand(s) * src.hand.length)]
          removeFromHand(s, t.from, id)
          x.hand.push(id)
        }
        log(s, `${x.name} 從 ${src.name} 手上拿走一張牌。`, `${x.name} takes a card from ${src.name}’s hand.`)
        fx(s, { kind: 'steal', from: t.from, to: t.to })
      }
      return
    }
    case 'die':
      return die(s, t.who, t.killer)
    case 'endTurn':
      return endTurn(s)
    case 'nextTurn':
      return nextTurn(s)
  }
}

function endTurn(s: GameState) {
  const p = s.turn.active
  const x = s.players[p]
  // 鬼鎮的幽靈：回合結束就離場
  if (x.ghost === 'town') {
    for (const id of [...x.hand, ...x.table]) toDiscard(s, id)
    x.hand = []
    x.table = []
    x.ghost = null
    x.alive = false
    log(s, `${x.name} 的幽靈消散了。`, `${x.name}’s ghost fades away.`)
    s.q.unshift({ k: 'nextTurn' })
    return
  }
  // 蘇珊娜小姐：至少要打出 3 張
  if (evOn(s, 'susanna') && x.alive && (s.turn.played ?? 0) < 3 && !s.turn.susanna) {
    s.turn.susanna = true
    log(s, `${x.name} 這回合只打出 ${s.turn.played ?? 0} 張牌，蘇珊娜小姐很失望。`, `${x.name} played only ${s.turn.played ?? 0} card${(s.turn.played ?? 0) === 1 ? '' : 's'} this turn; Miss Susanna is disappointed.`)
    s.q.unshift({ k: 'damage', to: p, amount: 1, from: null }, { k: 'endTurn' })
    return
  }
  const tasks: Task[] = []
  if (x.alive && x.hand.length > handLimit(s, p)) tasks.push({ k: 'ask', kind: 'discard', player: p })
  tasks.push({ k: 'nextTurn' })
  s.q.unshift(...tasks)
  // 喬許抽到但沒用的裝備放回牌堆底
  if (s.gold?.free[p] != null) {
    s.gold.deck.push(s.gold.free[p]!)
    s.gold.free[p] = null
  }
  const extraTurn = () => {
    s.q = s.q.map((t) => (t.k === 'nextTurn' ? ({ k: 'startTurn' } as Task) : t))
    s.turn = { active: p, no: s.turn.no + 1, bangs: 0, phase: 'start', uses: {}, extra: true }
  }
  if (!x.alive) return
  if (s.turn.again) {
    log(s, `${x.name} 再玩一回合！`, `${x.name} plays another turn!`)
    return extraTurn()
  }
  // 復仇／唐．貝爾：抽到紅色再玩一回合
  if (evOn(s, 'vendetta') && !s.turn.extra) {
    if (check(s, p, (c) => c.suit === 'H', bi('【復仇】', 'Vendetta'))) {
      log(s, `${x.name} 要再玩一回合！`, `${x.name} gets another turn!`)
      return extraTurn()
    }
  }
  if (hasChar(s, p, 'donbell') && !s.turn.extra) {
    if (check(s, p, (c) => c.suit === 'H' || c.suit === 'D', bi('唐．貝爾的能力', 'Don Bell’s ability'))) {
      log(s, `${x.name} 要再玩一回合！`, `${x.name} gets another turn!`)
      return extraTurn()
    }
  }
}

function nextTurn(s: GameState) {
  const n = s.players.length
  let q = s.turn.active
  for (let i = 0; i < n; i++) {
    q = (((q + s.dir) % n) + n) % n
    const x = s.players[q]
    if (x.alive) break
    if (evOn(s, 'deadman') && q === s.firstDead && !s.deadManDone) {
      s.deadManDone = true
      x.alive = true
      x.hp = Math.min(2, x.maxHp)
      draw(s, q, 2)
      log(s, `☠ ${x.name} 死而復生，帶著 2 點生命回來了！`, `☠ ${x.name} rises from the dead with 2 life!`)
      fx(s, { kind: 'revive', to: q })
      break
    }
    if (evOn(s, 'ghosttown') && x.character) {
      x.alive = true
      x.ghost = 'town'
      log(s, `👻 ${x.name} 以幽靈身分回到牌桌。`, `👻 ${x.name} returns to the table as a ghost.`)
      fx(s, { kind: 'revive', to: q })
      break
    }
  }
  s.turn = { active: q, no: s.turn.no + 1, bangs: 0, phase: 'start', uses: {} }
  s.q.unshift({ k: 'startTurn' })
}

function revealEvent(s: GameState, tasks: Task[]) {
  const p = s.turn.active
  const ev = s.events!.deck.shift()!
  s.events!.current = ev
  const def = EVENT_BY_ID[ev]
  log(s, `📜 事件：【${def.name}】${def.text}`, `📜 Event: ${EVENT_EN[def.id].name} — ${EVENT_EN[def.id].text}`)
  fx(s, { kind: 'event', event: ev })
  s.dir = ev === 'goldrush' ? -1 : 1
  if (ev === 'doctor') {
    const living = alive(s).filter((q) => !s.players[q].ghost)
    const min = Math.min(...living.map((q) => s.players[q].hp))
    for (const q of living) if (s.players[q].hp === min) heal(s, q, 1)
    log(s, `生命最少的人各回 1 點生命。`, 'The players with the least life each regain 1.')
  }
  if (ev === 'daltons') {
    let q = p
    for (let i = 0; i < s.players.length; i++) {
      if (s.players[q].alive && s.players[q].table.some((id) => CARD_DEFS[keyOf(s, id)].colour === 'blue')) tasks.push({ k: 'ask', kind: 'daltons', player: q })
      q = nextAlive(s, q, 1)
      if (q === p) break
    }
  }
  if (ev === 'roulette') tasks.push({ k: 'ask', kind: 'roulette', player: p })
  if (ev === 'boneorchard') {
    const dead = s.players.filter((x) => !x.alive && x.character)
    if (dead.length) {
      const roles = shuffle(
        s,
        dead.map((x) => x.role),
      )
      dead.forEach((x, i) => {
        x.alive = true
        x.ghost = null
        x.hp = 1
        x.role = roles[i]
        draw(s, x.seat, 1)
        fx(s, { kind: 'revive', to: x.seat })
      })
      log(s, `⚰ ${dead.map((x) => x.name).join('、')} 從墓園爬回來了（1 點生命，身份重新分配）！`, `⚰ ${dead.map((x) => x.name).join(', ')} crawl out of the Bone Orchard (1 life, roles reshuffled)!`)
    }
  }
  if (ev === 'helena') {
    if (check(s, p, (c) => c.suit === 'H' || c.suit === 'D', bi('【海倫娜】', 'Helena Zontero'))) {
      const xs = s.players.filter((x) => x.alive && !x.ghost && x.role !== 'sheriff')
      const roles = shuffle(
        s,
        xs.map((x) => x.role),
      )
      xs.forEach((x, i) => (x.role = roles[i]))
      log(s, '警長以外的身份全部重新洗牌！', 'All roles except the Sheriff are reshuffled!')
    }
  }
}

function startTurn(s: GameState) {
  const p = s.turn.active
  const me = s.players[p]
  if (!me.alive) {
    s.q.unshift({ k: 'nextTurn' })
    return
  }
  log(s, `── 第 ${s.turn.no} 回合：${me.name}${me.ghost ? '（幽靈）' : ''} ──`, `── Turn ${s.turn.no}: ${me.name}${me.ghost ? ' (ghost)' : ''} ──`)
  fx(s, { kind: 'turn', to: p })
  if (me.character === 'vera') me.copy = null
  // 葛雷戈里：隨機借用兩個角色的能力
  if (me.character === 'greygory') {
    const used = new Set(s.players.map((x) => x.character))
    const pool = CHARACTERS.filter((c) => (c.set === 'base' || s.config.expansions.includes(c.set)) && !used.has(c.id) && c.id !== 'greygory').map((c) => c.id)
    me.copies = shuffle(s, pool).slice(0, 2)
    if (!evOn(s, 'hangover')) log(s, `${me.name} 這一輪得到 ${me.copies.map((c) => CHAR_BY_ID[c].name).join('、')} 的能力。`, `${me.name} gains the abilities of ${me.copies.map((c) => CHAR_EN[c].name).join(' and ')} this round.`)
  }
  const tasks: Task[] = []
  // 警長回合開始：翻開下一張事件牌（第一輪不翻）
  if (me.role === 'sheriff' && s.events && s.turn.no > 1 && !s.turn.extra && s.events.deck.length) revealEvent(s, tasks)
  // 每回合開始的事件
  if (evOn(s, 'highnoon')) tasks.push({ k: 'damage', to: p, amount: 1, from: null })
  if (evOn(s, 'fistful')) {
    const n = me.hand.length
    if (n) log(s, `${me.name} 手上有 ${n} 張牌，要挨 ${n} 槍！`, `${me.name} holds ${n} card${n > 1 ? 's' : ''} and takes ${n} shot${n > 1 ? 's' : ''}!`)
    for (let i = 0; i < n; i++) tasks.push({ k: 'shot', from: null, to: p, need: 1, src: 'bang' })
  }
  if (evOn(s, 'darling') && me.hand.length) {
    const n = me.hand.length
    for (const id of me.hand) toDiscard(s, id)
    me.hand = []
    draw(s, p, n)
    log(s, `${me.name} 換掉全部 ${n} 張手牌。`, `${me.name} replaces all ${n} cards in hand.`)
  }
  if (evOn(s, 'newidentity')) tasks.push({ k: 'ask', kind: 'newidentity', player: p })
  if (evOn(s, 'blood') && me.hp > 1) tasks.push({ k: 'ask', kind: 'blood', player: p })
  if (me.character === 'vera' && !evOn(s, 'hangover')) tasks.push({ k: 'ask', kind: 'vera', player: p })
  // 尤爾．葛林納：手牌比他多的人要給他一張
  if (hasChar(s, p, 'youl')) {
    for (const q of alive(s)) if (q !== p && s.players[q].hand.length > me.hand.length) tasks.push({ k: 'ask', kind: 'youl', player: q, target: p })
  }
  tasks.push({ k: 'turnChecks' })
  s.q.unshift(...tasks)
}

function turnChecks(s: GameState) {
  const p = s.turn.active
  const me = s.players[p]
  if (!me.alive) return
  const on = eqOn(s, p)
  // 炸藥
  const dyn = me.table.find((id) => keyOf(s, id) === 'dynamite')
  if (dyn != null && on) {
    const safe = check(s, p, (c) => !(c.suit === 'S' && c.rank >= 2 && c.rank <= 9), bi('【炸藥】', 'the Dynamite'))
    removeFromTable(s, p, dyn)
    if (!safe) {
      toDiscard(s, dyn)
      log(s, `【炸藥】在 ${me.name} 面前爆炸！`, `The Dynamite explodes in front of ${me.name}!`)
      fx(s, { kind: 'explode', to: p })
      s.q.unshift({ k: 'damage', to: p, amount: 3, from: null }, { k: 'turnChecks' })
      return
    }
    let q = nextAlive(s, p)
    while (q !== p && ownsKey(s, q, 'dynamite')) q = nextAlive(s, q)
    s.players[q].table.push(dyn)
    log(s, `【炸藥】沒爆，傳給 ${nm(s, q)}。`, `The Dynamite fizzles and passes to ${nm(s, q)}.`)
  }
  // 響尾蛇
  if (on && me.table.some((id) => keyOf(s, id) === 'rattlesnake') && !s.turn.snake) {
    s.turn.snake = true
    if (!check(s, p, (c) => c.suit !== 'S', bi('【響尾蛇】', 'the Rattlesnake'))) {
      log(s, `${me.name} 被響尾蛇咬了！`, `${me.name} is bitten by the Rattlesnake!`)
      s.q.unshift({ k: 'damage', to: p, amount: 1, from: null }, { k: 'turnChecks' })
      return
    }
  }
  // 監獄
  const jail = me.table.find((id) => keyOf(s, id) === 'jail')
  if (jail != null && on) {
    const free = check(s, p, (c) => c.suit === 'H', bi('【監獄】', 'Jail'))
    removeFromTable(s, p, jail)
    toDiscard(s, jail)
    if (!free) {
      log(s, `${me.name} 被關在監獄裡，跳過這回合。`, `${me.name} stays in Jail and skips this turn.`)
      s.q.unshift({ k: 'nextTurn' })
      return
    }
    log(s, `${me.name} 逃出監獄！`, `${me.name} breaks out of Jail!`)
  }
  s.q.unshift({ k: 'drawPhase' }, { k: 'afterDraw' })
}

function drawPhase(s: GameState) {
  const p = s.turn.active
  const me = s.players[p]
  s.turn.phase = 'play'
  s.turn.drawn = []
  const n = drawCount(s, p)
  if (me.ghost === 'town') {
    phaseDraw(s, p, n)
    return
  }
  if (evOn(s, 'peyote')) {
    s.q.unshift({ k: 'ask', kind: 'peyote', player: p, got: 0 })
    return
  }
  if (evOn(s, 'liquor') && !s.turn.asked) {
    // 先問要不要喝烈酒，再回到抽牌
    s.turn.asked = true
    s.turn.phase = 'start'
    s.q.unshift({ k: 'ask', kind: 'liquor', player: p }, { k: 'drawPhase' })
    return
  }
  if (hasChar(s, p, 'evelyn')) return void s.q.unshift({ k: 'ask', kind: 'evelyn', player: p, got: 0, cards: [] })
  if (hasChar(s, p, 'dutch')) {
    const shown: number[] = []
    for (let i = 0; i < 2; i++) {
      const id = drawOne(s)
      if (id != null) shown.push(id)
    }
    if (n > 2) phaseDraw(s, p, n - 2)
    if (shown.length) s.q.unshift({ k: 'ask', kind: 'dutch', player: p, cards: shown })
    return
  }
  if (hasChar(s, p, 'kit')) {
    const shown: number[] = []
    for (let i = 0; i < n + 1; i++) {
      const id = drawOne(s)
      if (id != null) shown.push(id)
    }
    if (shown.length <= n) me.hand.push(...shown)
    else s.q.unshift({ k: 'ask', kind: 'kit', player: p, cards: shown })
    return
  }
  if (hasChar(s, p, 'pat')) return void s.q.unshift({ k: 'ask', kind: 'pat', player: p })
  if (hasChar(s, p, 'jesse')) return void s.q.unshift({ k: 'ask', kind: 'jesse', player: p })
  if (hasChar(s, p, 'pedro')) return void s.q.unshift({ k: 'ask', kind: 'pedro', player: p })
  phaseDraw(s, p, n)
  if (hasChar(s, p, 'blackjack')) {
    const second = s.turn.drawn?.[1]
    if (second != null) {
      const c = card(s, second)
      const st = suitOf(s, c)
      const red = st === 'H' || st === 'D'
      log(s, `${me.name} 亮出第二張牌 ${cardLabel(c)}${cardSuitLabel({ ...c, suit: st })}${red ? '，是紅色，多抽 1 張' : ''}。`, `${me.name} shows the second card, ${ce(c)} ${cardSuitLabel({ ...c, suit: st })}${red ? ': red, so draws 1 more' : ''}.`)
      fx(s, { kind: 'check', to: p, card: { ...c, suit: st }, ok: red })
      if (red) draw(s, p, 1)
    }
  }
}

function afterDraw(s: GameState) {
  const p = s.turn.active
  const me = s.players[p]
  if (!me.alive) return
  s.turn.phase = 'play'
  // 西部法則：亮出第二張，能用就必須先用
  if (evOn(s, 'law')) {
    const second = s.turn.drawn?.[1]
    if (second != null && me.hand.includes(second)) {
      log(s, `${me.name} 亮出第二張牌${cardLabel(card(s, second))}${cardSuitLabel(card(s, second))}。`, `${me.name} shows the second card, ${ce(card(s, second))} ${cardSuitLabel(card(s, second))}.`)
      s.turn.must = second
    }
  }
  const tasks: Task[] = []
  if (evOn(s, 'ranch') && !me.ghost) tasks.push({ k: 'ask', kind: 'ranch', player: p })
  if (evOn(s, 'handcuffs')) tasks.push({ k: 'ask', kind: 'handcuffs', player: p })
  s.q.unshift(...tasks)
}

function die(s: GameState, who: number, killer: number | null) {
  const x = s.players[who]
  if (!x.alive) return
  // 泰倫．基爾：判定不是黑桃就撐住
  if (hasChar(s, who, 'teren')) {
    if (check(s, who, (c) => c.suit !== 'S', bi('泰倫．基爾的能力', 'Teren Kill’s ability'))) {
      x.hp = 1
      draw(s, who, 1)
      log(s, `${x.name} 硬撐了下來，回到 1 點生命並抽 1 張！`, `${x.name} refuses to die: back to 1 life and draws 1!`)
      fx(s, { kind: 'heal', to: who, amount: 1 })
      return
    }
  }
  x.alive = false
  x.hp = 0
  note(s, killer, who, W.kill)
  if (s.firstDead == null) s.firstDead = who
  log(s, `💀 ${x.name} 死亡，身份是【${ROLE_NAME[x.role]}】。`, `💀 ${x.name} dies — they were the ${ROLE_EN[x.role]}.`)
  fx(s, { kind: 'death', from: killer ?? undefined, to: who })
  // 遺物：禿鷹山姆拿走，否則棄掉
  const loot = [...x.hand, ...x.table]
  x.hand = []
  x.table = []
  for (const id of loot) delete s.greenAt[id]
  const vulture = alive(s).find((q) => hasChar(s, q, 'vulture'))
  if (vulture != null && loot.length) {
    s.players[vulture].hand.push(...loot)
    log(s, `${nm(s, vulture)} 拿走了 ${x.name} 的 ${loot.length} 張牌。`, `${nm(s, vulture)} takes ${x.name}’s ${loot.length} card${loot.length > 1 ? 's' : ''}.`)
  } else for (const id of loot) toDiscard(s, id)
  // 淘金熱的裝備放回裝備牌堆底；通緝令給殺手獎勵
  if (s.gold) {
    const wanted = goldHas(s, who, 'wanted')
    s.gold.deck.push(...s.gold.equip[who])
    s.gold.equip[who] = []
    if (wanted && killer != null && killer !== who && isAlive(s, killer)) {
      draw(s, killer, 2)
      addNuggets(s, killer, 1)
      log(s, `${nm(s, killer)} 領到通緝令的賞金：2 張牌和 1 金塊。`, `${nm(s, killer)} claims the Wanted reward: 2 cards and 1 nugget.`)
    }
  }
  for (const q of alive(s)) {
    if (hasChar(s, q, 'greg')) {
      const n = heal(s, q, 2)
      if (n) log(s, `${nm(s, q)} 回 ${n} 點生命。`, `${nm(s, q)} regains ${n} life.`)
    }
    if (hasChar(s, q, 'herb')) {
      draw(s, q, 2)
      log(s, `${nm(s, q)} 抽 2 張牌。`, `${nm(s, q)} draws 2 cards.`)
    }
  }

  if (checkWin(s)) return
  // 獎懲
  if (killer != null && killer !== who && isAlive(s, killer) && !evOn(s, 'wildwestshow')) {
    if (x.role === 'outlaw') {
      draw(s, killer, 3)
      log(s, `${nm(s, killer)} 擊斃歹徒，獎勵抽 3 張牌。`, `${nm(s, killer)} killed an Outlaw and draws 3 as a reward.`)
    } else if (x.role === 'deputy' && s.players[killer].role === 'sheriff') {
      const k = s.players[killer]
      for (const id of [...k.hand, ...k.table]) toDiscard(s, id)
      k.hand = []
      k.table = []
      log(s, `警長誤殺了副警長，必須棄掉所有手牌和裝備！`, 'The Sheriff killed a Deputy and must discard every card in hand and in play!')
    }
  }
  // 死的是當前回合的人：回合立刻結束
  if (who === s.turn.active) {
    s.q = s.q.filter((t) => t.k === 'die' || t.k === 'damage' || t.k === 'afterDamage' || (t.k === 'ask' && t.kind === 'dying'))
    s.turn.phase = 'end'
    s.q.push({ k: 'nextTurn' })
  }
}

function checkWin(s: GameState): boolean {
  const living = s.players.filter((p) => p.alive && !p.ghost)
  const all = s.players
  // 西部秀結局牌：最後一個活著的人獲勝
  if (evOn(s, 'wildwestshow')) {
    if (living.length <= 1) {
      const w = living[0]
      s.result = { side: 'last', winners: w ? [w.seat] : [], reason: w ? bi(`西部秀落幕：${w.name} 是最後一個站著的人！`, `The Wild West Show is over: ${w.name} is the last one standing!`) : bi('所有人同歸於盡。', 'Everyone is dead.') }
    }
  } else {
    const sheriffAlive = living.some((p) => p.role === 'sheriff')
    if (!sheriffAlive) {
      if (living.length === 1 && living[0].role === 'renegade') {
        s.result = { side: 'renegade', winners: [living[0].seat], reason: bi(`叛徒 ${living[0].name} 成為最後的倖存者！`, `The Renegade ${living[0].name} is the last survivor!`) }
      } else {
        s.result = { side: 'outlaws', winners: all.filter((p) => p.role === 'outlaw').map((p) => p.seat), reason: bi('警長倒下了，歹徒獲勝！', 'The Sheriff has fallen: the Outlaws win!') }
      }
    } else if (!living.some((p) => p.role === 'outlaw' || p.role === 'renegade')) {
      s.result = { side: 'law', winners: all.filter((p) => p.role === 'sheriff' || p.role === 'deputy').map((p) => p.seat), reason: bi('歹徒和叛徒都被消滅，警長獲勝！', 'The Outlaws and the Renegade are gone: the Sheriff wins!') }
    }
  }
  if (s.result) {
    s.q = []
    s.turn.phase = 'end'
    log(s, `遊戲結束：${zhOf(s.result.reason)}`, `Game over: ${enOf(s.result.reason)}`)
    return true
  }
  return false
}
