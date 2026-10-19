import { buildCards, CARD_DEFS, CHAR_BY_ID, CHARACTERS, cardLabel, cardSuitLabel, EVENT_BY_ID, EVENTS, isWeapon, maxPlayersFor, ROLE_NAME, ROLE_SETUP, SUIT_NAME } from './data'
import type {
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
  LegalAbility,
  LegalPlay,
  Suit,
  Task,
} from './types'

export class RuleError extends Error {}
const fail = (msg: string): never => {
  throw new RuleError(msg)
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

/** 角色能力（宿醉時全部失效；薇拉可以複製別人的能力） */
export function hasChar(s: GameState, p: number, id: string) {
  if (evOn(s, 'hangover')) return false
  const x = s.players[p]
  if (!x) return false
  return x.character === id || (x.character === 'vera' && x.copy === id)
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

function log(s: GameState, text: string) {
  s.log.push({ seq: ++s.seq, text, turn: s.turn.no })
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
    log(s, '牌堆用完，把棄牌堆洗成新的牌堆。')
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
  if (i < 0) fail('那張牌不在手上')
  h.splice(i, 1)
}
function removeFromTable(s: GameState, p: number, id: number) {
  const t = s.players[p].table
  const i = t.indexOf(id)
  if (i < 0) fail('那張牌不在場上')
  t.splice(i, 1)
}
function heal(s: GameState, p: number, n: number) {
  const x = s.players[p]
  const before = x.hp
  x.hp = Math.min(x.maxHp, x.hp + n)
  if (x.hp > before) fx(s, { kind: 'heal', to: p, amount: x.hp - before })
  return x.hp - before
}
/** 莫莉．史塔克：在自己回合以外用掉手牌就抽 1 張 */
function molly(s: GameState, p: number) {
  if (hasChar(s, p, 'molly') && s.turn.active !== p) {
    draw(s, p, 1)
    log(s, `${nm(s, p)} 在回合外出牌，抽 1 張。`)
  }
}

/** 抽判定：翻牌堆頂。幸運杜克翻兩張挑有利的。回傳是否「有利」 */
function check(s: GameState, p: number, good: (c: Card) => boolean, what: string): boolean {
  const n = hasChar(s, p, 'lucky') ? 2 : 1
  const flipped: number[] = []
  for (let i = 0; i < n; i++) {
    const id = drawOne(s)
    if (id != null) flipped.push(id)
  }
  if (!flipped.length) return false
  const eff = (id: number) => ({ ...card(s, id), suit: suitOf(s, card(s, id)) })
  const pick = flipped.find((id) => good(eff(id))) ?? flipped[0]
  for (const id of flipped) toDiscard(s, id)
  const c = eff(pick)
  const ok = good(c)
  const shown = flipped.map((id) => cardSuitLabel(eff(id))).join('、')
  log(s, `${nm(s, p)} 為${what}抽判定：${shown}${n > 1 ? `（取 ${cardSuitLabel(c)}）` : ''} → ${ok ? '成功' : '失敗'}`)
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
const handLimit = (s: GameState, p: number) => (hasChar(s, p, 'sean') ? 10 : Math.max(0, s.players[p].hp))
/** 這張牌對阿帕契小子無效嗎？ */
const apacheBlocks = (s: GameState, user: number | null, target: number, c: Card | null) =>
  !!c && user != null && user !== target && hasChar(s, target, 'apache') && suitOf(s, c) === 'D'

// ───────────── 開局 ─────────────
export function startGame(config: GameConfig): GameState {
  const n = config.names.length
  const exp = config.expansions ?? []
  if (!ROLE_SETUP[n] || n < 4 || n > maxPlayersFor(exp)) fail(`人數需要 4–${maxPlayersFor(exp)} 人`)
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
    rep: Array(n).fill(0),
    dir: 1,
    greenAt: {},
    events: null,
    firstDead: null,
    deadManDone: false,
  }
  s.deck = shuffle(s, s.cards.map((c) => c.id))
  const roles = shuffle(s, [...ROLE_SETUP[n]])
  const pool = CHARACTERS.filter((c) => c.set === 'base' || exp.includes(c.set)).map((c) => c.id)
  const chars = shuffle(s, pool)
  s.players = config.names.map((name, seat) => ({
    seat,
    name,
    isAI: !!config.ai[seat],
    role: roles[seat],
    character: null,
    charOptions: [chars[(seat * 2) % chars.length], chars[(seat * 2 + 1) % chars.length]],
    hp: 0,
    maxHp: 0,
    hand: [],
    table: [],
    alive: true,
  }))
  // 事件牌堆
  const sets = (['high_noon', 'fistful'] as const).filter((x) => exp.includes(x))
  if (sets.length) {
    let body = shuffle(s, EVENTS.filter((e) => sets.includes(e.set as (typeof sets)[number]) && !e.final).map((e) => e.id))
    if (sets.length > 1) body = body.slice(0, 14)
    const finals = EVENTS.filter((e) => sets.includes(e.set as (typeof sets)[number]) && e.final).map((e) => e.id)
    s.events = { deck: [...body, finals[Math.floor(rand(s) * finals.length)]], current: null }
  }
  const sheriff = s.players.find((p) => p.role === 'sheriff')!
  s.turn.active = sheriff.seat
  log(s, `${sheriff.name} 是警長。每個人從兩張角色中挑一張。`)
  return s
}

function afterCharacters(s: GameState) {
  for (const p of s.players) {
    const c = CHAR_BY_ID[p.character!]
    p.maxHp = c.hp + (p.role === 'sheriff' ? 1 : 0)
    p.hp = p.maxHp
    draw(s, p.seat, p.hp)
  }
  log(s, '發牌完成，每人手牌數等於生命值。警長先開始。')
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
  const hurt = me.hp < me.maxHp
  const canCost = me.hand.length >= 2
  const bangCount = me.hand.filter((id) => isBangCard(s, p, id)).length

  for (const id of me.hand) {
    const c = card(s, id)
    if (cuffs && suitOf(s, c) !== cuffs) continue
    const k = c.key
    const add = (l: Omit<LegalPlay, 'card' | 'source'>) => out.push({ card: id, source: 'hand', ...l })
    if (isBangCard(s, p, id)) {
      if (bangOk && inRange.length) add({ as: 'bang', targets: inRange })
      if (evOn(s, 'sniper') && bangOk && bangCount >= 2 && inRange.length) add({ as: 'sniper', targets: inRange, cost: 1, costKind: 'bang' })
      if (evOn(s, 'ricochet') && !evOn(s, 'sermon')) {
        const t = others.filter((q) => s.players[q].table.length)
        if (t.length) add({ as: 'ricochet', targets: t, pickCard: true, tableOnly: true })
      }
    }
    switch (k) {
      case 'beer':
        if (hurt && alive(s).length > 2 && !evOn(s, 'reverend')) add({ as: k, targets: null })
        break
      case 'saloon':
      case 'stagecoach':
      case 'wellsfargo':
      case 'store':
      case 'gatling':
      case 'indians':
        add({ as: k, targets: null })
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
        const t = alive(s).filter((q) => s.players[q].hp < s.players[q].maxHp)
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
          if (withCards.length) add({ as: k, targets: withCards, pickCard: true })
          break
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
  // 西部法則：必須先打出亮出的那張
  if (must != null) {
    const forced = out.filter((l) => l.card === must)
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
  if (hasChar(s, p, 'sid') && me.hand.length >= 2 && me.hp < me.maxHp) out.push({ id: 'sid', label: '席德：棄 2 張回 1 點生命', cards: 2 })
  if (!myPlay) return out
  const uses = s.turn.uses ?? {}
  if (hasChar(s, p, 'chuck') && me.hp > 1) out.push({ id: 'chuck', label: '恰克：失去 1 點生命抽 2 張', cards: 0 })
  const blues = me.hand.filter((id) => CARD_DEFS[keyOf(s, id)].colour === 'blue')
  if (hasChar(s, p, 'jose') && (uses.jose ?? 0) < 2 && blues.length) out.push({ id: 'jose', label: '荷西：棄 1 張藍牌抽 2 張', cards: 1, cardIds: blues })
  if (hasChar(s, p, 'doc') && !(uses.doc ?? 0) && me.hand.length >= 2) {
    const reach = weaponRange(s, p)
    const t = alive(s).filter((q) => q !== p && distance(s, p, q) <= reach)
    if (t.length) out.push({ id: 'doc', label: '霍利戴：棄 2 張開一槍', cards: 2, targets: t })
  }
  return out
}

// ───────────── 詢問 ─────────────
/** 可以當作射偏了的手牌 */
function missedCards(s: GameState, p: number) {
  return s.players[p].hand.filter((id) => {
    const k = keyOf(s, id)
    if (hasChar(s, p, 'elena')) return true
    return k === 'missed' || k === 'dodge' || (k === 'bang' && hasChar(s, p, 'calamity'))
  })
}
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

function srcName(k?: CardKey) {
  return k ? CARD_DEFS[k].name : ''
}

export function askView(s: GameState, a: Ask): AskView {
  const base: AskView = { kind: a.kind, title: '', prompt: '', options: [], cards: [], zone: 'hand', min: 1, max: 1, targets: [], shown: [], table: [] }
  const from = a.from != null ? nm(s, a.from) : ''
  const cardsOf = (ids: number[]) => ids.map((id) => card(s, id))
  switch (a.kind) {
    case 'respond': {
      const left = (a.need ?? 1) - (a.got ?? 0)
      const opts: AskOption[] = []
      if (barrelSources(s, a.player, a.barrels ?? []).length) opts.push({ id: 'barrel', label: '用木桶抽判定', primary: true })
      opts.push({ id: 'take', label: '中彈（失去 1 點生命）' })
      return {
        ...base,
        title: '有人對你開槍',
        prompt: `${a.from != null ? from : '有人'}用【${srcName(a.src)}】對你開槍！${left > 1 ? `還需要 ${left} 張「射偏了！」。` : ''}點一張「射偏了！」躲開，或選擇下面的動作。`,
        options: opts,
        cards: [...missedCards(s, a.player), ...defendTable(s, a.player)],
        table: cardsOf(defendTable(s, a.player)),
      }
    }
    case 'indians':
      return { ...base, title: '印第安人來襲', prompt: `${from} 打出【印第安人！】：棄一張「砰！」，否則失去 1 點生命。`, options: [{ id: 'take', label: '失去 1 點生命' }], cards: bangCards(s, a.player) }
    case 'duel':
      return { ...base, title: '決鬥', prompt: `你和 ${from} 決鬥中：棄一張「砰！」，否則失去 1 點生命。`, options: [{ id: 'take', label: '認輸（失去 1 點生命）' }], cards: bangCards(s, a.player) }
    case 'store':
      return { ...base, title: '雜貨店', prompt: '從翻開的牌中挑一張。', zone: 'store', cards: [...s.store] }
    case 'dying': {
      const opts: AskOption[] = [{ id: 'die', label: '放棄' }]
      const beers = beerCards(s, a.player)
      return {
        ...base,
        title: '瀕死',
        prompt: `你的生命歸零了！${evOn(s, 'reverend') ? '（牧師：不能喝啤酒）' : alive(s).length <= 2 ? '（只剩兩人，啤酒無效）' : '喝啤酒自救，'}否則死亡。`,
        options: opts,
        cards: beers,
        table: cardsOf(beers.filter((id) => s.players[a.player].table.includes(id))),
      }
    }
    case 'discard': {
      const p = s.players[a.player]
      const n = p.hand.length - handLimit(s, a.player)
      return { ...base, title: '回合結束', prompt: `手牌不能超過${hasChar(s, a.player, 'sean') ? ' 10 張' : '生命值'}，請棄掉 ${n} 張。`, options: [{ id: 'ok', label: '棄掉選取的牌', primary: true }], cards: [...p.hand], min: n, max: n }
    }
    case 'kit': {
      const n = Math.max(1, (a.cards ?? []).length - 1)
      return { ...base, title: '基特．卡爾森', prompt: `從牌堆頂的 ${(a.cards ?? []).length} 張中挑 ${n} 張，另一張放回牌堆頂。`, zone: 'reveal', cards: a.cards ?? [], shown: cardsOf(a.cards ?? []), min: n, max: n, options: [{ id: 'ok', label: '拿這些牌', primary: true }] }
    }
    case 'jesse': {
      const t = alive(s).filter((q) => q !== a.player && s.players[q].hand.length > 0)
      return { ...base, title: '傑西．瓊斯', prompt: '第一張牌要從牌堆抽，還是從某位玩家手上隨機拿？', options: [{ id: 'deck', label: '從牌堆抽', primary: true }], targets: t, min: 0 }
    }
    case 'pedro': {
      const top = s.discard[s.discard.length - 1]
      return { ...base, title: '佩卓．拉米雷斯', prompt: `第一張牌要從牌堆抽，還是拿棄牌堆最上面的${top != null ? cardLabel(card(s, top)) : ''}？`, options: [{ id: 'discard', label: '拿棄牌堆那張', primary: true }, { id: 'deck', label: '從牌堆抽' }], min: 0 }
    }
    case 'pat': {
      const ids = alive(s)
        .filter((q) => q !== a.player)
        .flatMap((q) => s.players[q].table)
      return { ...base, title: '派特．布瑞南', prompt: '要正常抽牌，還是拿走某人場上的一張牌（只拿這一張）？', zone: 'reveal', cards: ids, shown: cardsOf(ids), options: [{ id: 'deck', label: '正常抽牌', primary: true }], min: 0 }
    }
    case 'vera': {
      const t = alive(s).filter((q) => q !== a.player && s.players[q].character && s.players[q].character !== 'vera')
      return { ...base, title: '薇拉．卡斯特', prompt: '選一名玩家，複製他的能力到你的下一回合。', targets: t, options: [{ id: 'skip', label: '不複製' }], min: 0 }
    }
    case 'brawl': {
      const x = s.players[a.target!]
      const opts: AskOption[] = x.hand.length ? [{ id: 'hand', label: `隨機一張手牌（${x.hand.length} 張）`, primary: true }] : []
      return { ...base, title: '鬥毆', prompt: `棄掉 ${x.name} 的哪一張牌？`, zone: 'reveal', cards: [...x.table], shown: cardsOf(x.table), options: opts }
    }
    case 'ricochet': {
      const c = card(s, a.targetCard!)
      return { ...base, title: '跳彈', prompt: `${from} 對你場上的${cardLabel(c)}開槍！出一張「射偏了！」保住它，否則它會被棄掉。`, options: [{ id: 'take', label: `讓它被打掉` }], cards: missedCards(s, a.player) }
    }
    case 'daltons': {
      const ids = s.players[a.player].table.filter((id) => CARD_DEFS[keyOf(s, id)].colour === 'blue')
      return { ...base, title: '道爾頓幫', prompt: '棄掉一張你場上的藍牌。', zone: 'reveal', cards: ids, shown: cardsOf(ids) }
    }
    case 'handcuffs':
      return {
        ...base,
        title: '手銬',
        prompt: '宣告一個花色：這回合只能打出這個花色的牌。',
        options: (['H', 'D', 'C', 'S'] as Suit[]).map((x) => ({ id: x, label: SUIT_NAME[x] })),
        min: 0,
      }
    case 'newidentity': {
      const other = s.players[a.player].charOptions.find((c) => c !== s.players[a.player].character)
      return {
        ...base,
        title: '新身分',
        prompt: other ? `要換成開局的另一張角色「${CHAR_BY_ID[other].name}」嗎？（${CHAR_BY_ID[other].text}）換了會從 2 點生命重新開始。` : '沒有可以換的角色。',
        options: [
          { id: 'swap', label: '換角色' },
          { id: 'keep', label: '不換', primary: true },
        ],
        min: 0,
      }
    }
    case 'blood': {
      const t = alive(s).filter((q) => q !== a.player && s.players[q].hp < s.players[q].maxHp)
      return { ...base, title: '結拜兄弟', prompt: '要失去 1 點生命，讓另一名玩家回 1 點嗎？', targets: t, options: [{ id: 'skip', label: '不要', primary: true }], min: 0 }
    }
    case 'liquor':
      return {
        ...base,
        title: '烈酒',
        prompt: '要放棄這回合抽牌，改回 1 點生命嗎？',
        options: [
          { id: 'draw', label: '正常抽牌', primary: true },
          { id: 'heal', label: '不抽牌，回 1 點生命' },
        ],
        min: 0,
      }
    case 'peyote':
      return {
        ...base,
        title: '仙人掌',
        prompt: `猜牌堆頂下一張是紅色還是黑色：猜對就拿走再猜，猜錯就停。${(a.got ?? 0) ? `（已經猜對 ${a.got} 張）` : ''}`,
        options: [
          { id: 'red', label: '紅色（紅心／方塊）', primary: true },
          { id: 'black', label: '黑色（黑桃／梅花）', primary: true },
        ],
        min: 0,
      }
    case 'ranch':
      return { ...base, title: '牧場', prompt: '選任意張手牌棄掉，再抽同樣張數（不換就直接按確定）。', cards: [...s.players[a.player].hand], min: 0, max: s.players[a.player].hand.length, options: [{ id: 'ok', label: '確定', primary: true }] }
    case 'roulette':
      return { ...base, title: '俄羅斯輪盤', prompt: '棄一張「射偏了！」傳給下一個人，否則失去 2 點生命。', options: [{ id: 'take', label: '失去 2 點生命' }], cards: missedCards(s, a.player) }
  }
}

// ───────────── 決定 ─────────────
export function getDecisions(s: GameState): Decision[] {
  if (s.result) return []
  if (s.turn.phase === 'choose') {
    return s.players.filter((p) => !p.character).map((p) => ({ type: 'choose_character', player: p.seat, options: p.charOptions }))
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
  if (!dec) fail('現在不是你的行動時機')
  const me = s.players[p]
  switch (dec!.type) {
    case 'choose_character':
      if (a.type !== 'choose_character' || !me.charOptions.includes(a.character)) fail('請從兩張角色中選一張')
      me.character = (a as { character: string }).character
      if (s.players.every((x) => x.character)) afterCharacters(s)
      return s
    case 'ask':
      if (a.type === 'ability') {
        useAbility(s, p, a)
        const head = s.q[0] as Ask
        if (head?.kind === 'dying' && me.hp > 0) s.q.shift()
        run(s)
        return s
      }
      if (a.type !== 'answer') fail('請先回應目前的詢問')
      answer(s, s.q[0] as Ask, a as Extract<Action, { type: 'answer' }>)
      run(s)
      return s
    case 'play':
      if (a.type === 'end_turn') {
        const must = s.turn.must
        if (must != null && legalPlays(s, p).some((l) => l.card === must)) fail('西部法則：亮出的那張牌必須先打出')
        s.turn.phase = 'end'
        s.q.push({ k: 'endTurn' })
      } else if (a.type === 'ability') {
        useAbility(s, p, a)
      } else if (a.type === 'play') {
        playCard(s, p, a)
      } else fail('現在是你的出牌階段')
      run(s)
      return s
  }
  return s
}

function useAbility(s: GameState, p: number, a: Extract<Action, { type: 'ability' }>) {
  const me = s.players[p]
  const ab = legalAbilities(s, p).find((x) => x.id === a.ability)
  if (!ab) fail('這個能力現在不能用')
  const cards = a.cards ?? []
  if (cards.length !== ab!.cards || new Set(cards).size !== cards.length || !cards.every((id) => me.hand.includes(id) && (!ab!.cardIds || ab!.cardIds.includes(id)))) {
    fail(`請選 ${ab!.cards} 張可以用的手牌`)
  }
  for (const id of cards) {
    removeFromHand(s, p, id)
    toDiscard(s, id)
  }
  const uses = (s.turn.uses ??= {})
  uses[a.ability] = (uses[a.ability] ?? 0) + 1
  switch (a.ability as AbilityId) {
    case 'sid':
      heal(s, p, 1)
      log(s, `${me.name} 棄 2 張牌回復 1 點生命（${me.hp}/${me.maxHp}）。`)
      break
    case 'chuck':
      me.hp--
      fx(s, { kind: 'hit', to: p, amount: 1 })
      draw(s, p, 2)
      log(s, `${me.name} 失去 1 點生命，抽 2 張牌。`)
      break
    case 'jose':
      draw(s, p, 2)
      log(s, `${me.name} 棄掉藍牌${cardLabel(card(s, cards[0]))}，抽 2 張牌。`)
      break
    case 'doc': {
      if (a.target == null || !ab!.targets!.includes(a.target)) fail('請選射程內的目標')
      log(s, `${me.name} 棄 2 張牌，對 ${nm(s, a.target!)} 開槍。`)
      rep(s, p, a.target!)
      s.q.push({ k: 'shot', from: p, to: a.target!, need: 1, src: 'bang' })
      break
    }
  }
}

function rep(s: GameState, user: number, target: number) {
  const sheriff = s.players.findIndex((x) => x.role === 'sheriff')
  if (target === sheriff) s.rep[user] -= 2
  else if (s.rep[target] < 0) s.rep[user] += 1
  else if (s.rep[target] > 0) s.rep[user] -= 1
}

function playCard(s: GameState, p: number, a: Extract<Action, { type: 'play' }>) {
  const legal = legalPlays(s, p).filter((l) => l.card === a.card)
  if (!legal.length) fail('這張牌現在不能用')
  const l = (a.as ? legal.find((x) => x.as === a.as) : legal[0]) ?? legal[0]
  if (l.targets && (a.target == null || !l.targets.includes(a.target))) fail('請選擇一個合法的目標')
  const me = s.players[p]
  const c = card(s, a.card)
  const t = a.target!
  // 代價：另外棄手牌
  const extra = a.extra ?? []
  if ((l.cost ?? 0) > 0) {
    if (extra.length !== l.cost || extra.includes(a.card) || new Set(extra).size !== extra.length || !extra.every((id) => me.hand.includes(id))) fail(`請另外選 ${l.cost} 張手牌棄掉`)
    if (l.costKind === 'bang' && !extra.every((id) => isBangCard(s, p, id))) fail('狙擊手要另一張「砰！」')
  }
  // 跳彈／搶奪的目標牌
  if (l.pickCard) {
    if (a.targetCard == null) fail('請選擇對方的哪一張牌')
    if (a.targetCard === 'hand' && (l.tableOnly || !s.players[t].hand.length)) fail('請選對方場上的牌')
    if (a.targetCard !== 'hand' && !s.players[t].table.includes(a.targetCard as number)) fail('那張牌不在他場上')
  }
  if (s.turn.must === a.card) s.turn.must = null

  if (l.source === 'table') removeFromTable(s, p, a.card)
  else removeFromHand(s, p, a.card)
  for (const id of extra) {
    removeFromHand(s, p, id)
    toDiscard(s, id)
  }

  // 裝備
  const col = CARD_DEFS[c.key].colour
  if (l.source === 'hand' && (col === 'blue' || col === 'green') && l.as === c.key) {
    if (c.key === 'jail') {
      s.players[t].table.push(c.id)
      log(s, `${me.name} 把 ${nm(s, t)} 關進【監獄】。`)
      fx(s, { kind: 'equip', from: p, to: t, card: c })
      rep(s, p, t)
      if (apacheBlocks(s, p, t, c)) {
        removeFromTable(s, t, c.id)
        toDiscard(s, c.id)
        log(s, `方塊牌對 ${nm(s, t)} 無效，監獄被丟掉。`)
      }
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
    log(s, `${me.name} ${col === 'green' ? '把綠牌' : '裝備'}${cardLabel(c)}${col === 'green' ? '放到場上（下一回合起可用）' : ''}。`)
    fx(s, { kind: 'equip', from: p, to: p, card: c })
    return
  }

  toDiscard(s, c.id)
  const as = l.as
  fx(s, { kind: 'play', from: p, to: l.targets ? t : undefined, card: c })
  const blocked = l.targets && apacheBlocks(s, p, t, c) && as !== 'duel'
  if (blocked) {
    log(s, `${me.name} 打出${cardLabel(c)}，但方塊牌對 ${nm(s, t)}（阿帕契小子）無效。`)
    if (as === 'bang' || as === 'sniper') s.turn.bangs++
    return
  }
  const shot = (need: number, src: CardKey) => {
    rep(s, p, t)
    s.q.push({ k: 'shot', from: p, to: t, need, src, suit: suitOf(s, c) })
  }
  switch (as) {
    case 'bang':
      s.turn.bangs++
      log(s, `${me.name} 對 ${nm(s, t)} 打出${c.key === 'bang' ? '【砰！】' : '「射偏了！」當作【砰！】'}。`)
      shot(hasChar(s, p, 'slab') ? 2 : 1, 'bang')
      break
    case 'sniper':
      s.turn.bangs++
      log(s, `${me.name} 棄 2 張「砰！」狙擊 ${nm(s, t)}（要 2 張「射偏了！」才躲得掉）。`)
      shot(2, 'bang')
      break
    case 'ricochet': {
      const tc = a.targetCard as number
      log(s, `${me.name} 用【砰！】射擊 ${nm(s, t)} 場上的${cardLabel(card(s, tc))}。`)
      rep(s, p, t)
      s.q.push({ k: 'ask', kind: 'ricochet', player: t, from: p, targetCard: tc })
      break
    }
    case 'punch':
    case 'knife':
    case 'derringer':
    case 'springfield':
    case 'pepperbox':
    case 'buffalo':
      log(s, `${me.name} 用${cardLabel(c)}對 ${nm(s, t)} 開槍。`)
      if (as === 'derringer') draw(s, p, 1)
      shot(1, as)
      break
    case 'beer': {
      const n = heal(s, p, hasChar(s, p, 'tequilajoe') ? 2 : 1)
      log(s, `${me.name} 喝了【啤酒】，回 ${n} 點（${me.hp}/${me.maxHp}）。`)
      break
    }
    case 'canteen':
      heal(s, p, 1)
      log(s, `${me.name} 喝了【水壺】（${me.hp}/${me.maxHp}）。`)
      break
    case 'whisky':
      heal(s, p, 2)
      log(s, `${me.name} 喝了【威士忌】（${me.hp}/${me.maxHp}）。`)
      break
    case 'tequila':
      heal(s, t, 1)
      log(s, `${me.name} 請 ${nm(s, t)} 喝【龍舌蘭】（${s.players[t].hp}/${s.players[t].maxHp}）。`)
      break
    case 'saloon':
      log(s, `${me.name} 打出【酒館】，所有人回復 1 點生命。`)
      for (const q of alive(s)) heal(s, q, 1)
      break
    case 'stagecoach':
      draw(s, p, 2)
      log(s, `${me.name} 打出【驛馬車】，抽 2 張。`)
      break
    case 'wellsfargo':
    case 'pony':
      draw(s, p, 3)
      log(s, `${me.name} 打出${cardLabel(c)}，抽 3 張。`)
      break
    case 'store': {
      const n = alive(s).length
      s.store = []
      for (let i = 0; i < n; i++) {
        const id = drawOne(s)
        if (id != null) s.store.push(id)
      }
      log(s, `${me.name} 打出【雜貨店】，翻開 ${s.store.map((id) => cardLabel(card(s, id))).join('')}。`)
      let q = p
      for (let i = 0; i < n; i++) {
        s.q.push({ k: 'ask', kind: 'store', player: q, from: p })
        q = nextAlive(s, q)
      }
      break
    }
    case 'gatling':
    case 'howitzer':
      log(s, `${me.name} 用${cardLabel(c)}掃射所有人！`)
      for (let q = nextAlive(s, p); q !== p; q = nextAlive(s, q)) {
        if (apacheBlocks(s, p, q, c)) log(s, `方塊牌對 ${nm(s, q)} 無效。`)
        else s.q.push({ k: 'shot', from: p, to: q, need: 1, src: as, suit: suitOf(s, c) })
      }
      break
    case 'indians':
      log(s, `${me.name} 打出【印第安人！】。`)
      for (let q = nextAlive(s, p); q !== p; q = nextAlive(s, q)) {
        if (apacheBlocks(s, p, q, c)) log(s, `方塊牌對 ${nm(s, q)} 無效。`)
        else s.q.push({ k: 'ask', kind: 'indians', player: q, from: p })
      }
      break
    case 'duel':
      log(s, `${me.name} 向 ${nm(s, t)} 提出【決鬥】！`)
      rep(s, p, t)
      s.q.push({ k: 'ask', kind: 'duel', player: t, from: p })
      break
    case 'brawl':
      log(s, `${me.name} 引發【鬥毆】！`)
      for (let q = nextAlive(s, p); q !== p; q = nextAlive(s, q)) {
        if (!hasCards(s, q)) continue
        if (apacheBlocks(s, p, q, c)) log(s, `方塊牌對 ${nm(s, q)} 無效。`)
        else s.q.push({ k: 'ask', kind: 'brawl', player: p, target: q })
      }
      break
    case 'panic':
    case 'catbalou':
    case 'ragtime':
    case 'cancan':
    case 'conestoga': {
      const steal = as === 'panic' || as === 'ragtime' || as === 'conestoga'
      takeCard(s, p, t, a.targetCard!, steal, cardLabel(c))
      rep(s, p, t)
      break
    }
    default:
      fail('這張牌現在不能用')
  }
}

/** 拿走（或棄掉）別人的一張牌 */
function takeCard(s: GameState, p: number, t: number, which: number | 'hand', steal: boolean, via: string) {
  const x = s.players[t]
  const me = s.players[p]
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
  if (steal) {
    me.hand.push(taken)
    log(s, `${me.name} 用${via}拿走 ${x.name} 的${where}。`)
    fx(s, { kind: 'steal', from: t, to: p })
  } else {
    toDiscard(s, taken)
    log(s, `${me.name} 用${via}棄掉 ${x.name} 的${which === 'hand' ? `手牌${cardLabel(card(s, taken))}` : where}。`)
  }
}

function answer(s: GameState, a: Ask, ans: Extract<Action, { type: 'answer' }>) {
  const p = a.player
  const me = s.players[p]
  const view = askView(s, a)
  const pickOne = () => {
    const id = ans.cards?.[0]
    if (id == null || !view.cards.includes(id)) fail('請選一張可以用的牌')
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
        s.q.unshift({ k: 'damage', to: p, amount: 1, from: a.from ?? null })
        return
      }
      const next: Ask = { ...a, barrels: [...(a.barrels ?? [])] }
      if (ans.opt === 'barrel') {
        const src = barrelSources(s, p, next.barrels!)[0]
        if (!src) fail('沒有可用的木桶')
        next.barrels!.push(src)
        if (check(s, p, (c) => c.suit === 'H', src === 'jour' ? '喬登奈的能力' : '【木桶】')) next.got = (next.got ?? 0) + 1
      } else {
        const id = pickOne()
        const k = keyOf(s, id)
        const fromTable = me.table.includes(id)
        spend(id)
        next.got = (next.got ?? 0) + 1
        log(s, `${me.name} 用${fromTable ? '場上的' : ''}${cardLabel(card(s, id))}${k === 'missed' ? '' : '當作【射偏了！】'}。`)
        if (k === 'dodge' || k === 'bible') draw(s, p, 1)
      }
      if ((next.got ?? 0) >= (next.need ?? 1)) {
        log(s, `${me.name} 躲過了這一槍。`)
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
        if (a.kind === 'duel') log(s, `${me.name} 輸了決鬥。`)
        return
      }
      const id = pickOne()
      spend(id)
      log(s, `${me.name} 棄了一張${cardLabel(card(s, id))}。`)
      if (a.kind === 'duel') s.q.unshift({ k: 'ask', kind: 'duel', player: a.from!, from: p })
      return
    }
    case 'store': {
      const id = pickOne()
      s.q.shift()
      s.store = s.store.filter((x) => x !== id)
      me.hand.push(id)
      log(s, `${me.name} 從雜貨店拿了${cardLabel(card(s, id))}。`)
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
      log(s, `${me.name} 喝下${cardLabel(card(s, id))}撐住了（${me.hp}/${me.maxHp}）。`)
      fx(s, { kind: 'heal', to: p, amount: 1 })
      if (me.hp > 0) s.q.shift()
      return
    }
    case 'discard': {
      const ids = ans.cards ?? []
      if (ids.length !== view.min || new Set(ids).size !== ids.length || !ids.every((id) => me.hand.includes(id))) fail(`請選 ${view.min} 張要棄掉的牌`)
      for (const id of ids) {
        removeFromHand(s, p, id)
        // 廢棄礦坑：棄的牌蓋回牌堆頂
        if (evOn(s, 'mine')) s.deck.push(id)
        else toDiscard(s, id)
      }
      log(s, `${me.name} 棄掉 ${ids.length} 張牌${evOn(s, 'mine') ? '（放回牌堆頂）' : ''}。`)
      s.q.shift()
      return
    }
    case 'kit': {
      const ids = ans.cards ?? []
      const shown = a.cards ?? []
      if (ids.length !== view.min || !ids.every((id) => shown.includes(id)) || new Set(ids).size !== ids.length) fail(`請挑 ${view.min} 張`)
      me.hand.push(...ids)
      for (const id of shown) if (!ids.includes(id)) s.deck.push(id)
      log(s, `${me.name} 看了牌堆頂 ${shown.length} 張，拿走 ${ids.length} 張。`)
      s.q.shift()
      return
    }
    case 'jesse': {
      s.q.shift()
      const n = drawCount(s, p)
      if (ans.target != null) {
        if (!view.targets.includes(ans.target)) fail('他沒有手牌')
        const x = s.players[ans.target]
        const id = x.hand[Math.floor(rand(s) * x.hand.length)]
        removeFromHand(s, ans.target, id)
        me.hand.push(id)
        log(s, `${me.name} 從 ${x.name} 手上拿了一張牌。`)
        fx(s, { kind: 'steal', from: ans.target, to: p })
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
        log(s, `${me.name} 拿走棄牌堆的${cardLabel(card(s, id))}。`)
        phaseDraw(s, p, n - 1)
      } else phaseDraw(s, p, n)
      return
    }
    case 'pat': {
      s.q.shift()
      const id = ans.cards?.[0]
      if (id != null) {
        if (!view.cards.includes(id)) fail('請選場上的一張牌')
        const owner = s.players.find((x) => x.table.includes(id))!.seat
        takeCard(s, p, owner, id, true, '派特的能力')
      } else phaseDraw(s, p, drawCount(s, p))
      return
    }
    case 'vera': {
      s.q.shift()
      if (ans.target != null) {
        if (!view.targets.includes(ans.target)) fail('請選一名活著的玩家')
        me.copy = s.players[ans.target].character
        log(s, `${me.name} 複製了 ${nm(s, ans.target)} 的能力（${CHAR_BY_ID[me.copy!].name}）。`)
      } else me.copy = null
      return
    }
    case 'brawl': {
      s.q.shift()
      const which: number | 'hand' = ans.opt === 'hand' ? 'hand' : (ans.cards?.[0] ?? (s.players[a.target!].hand.length ? 'hand' : s.players[a.target!].table[0]))
      if (which !== 'hand' && !view.cards.includes(which)) fail('請選他場上的一張牌')
      takeCard(s, p, a.target!, which, false, '【鬥毆】')
      return
    }
    case 'ricochet': {
      s.q.shift()
      if (ans.opt === 'take') {
        const owner = s.players[p]
        if (owner.table.includes(a.targetCard!)) {
          removeFromTable(s, p, a.targetCard!)
          toDiscard(s, a.targetCard!)
          log(s, `${owner.name} 場上的${cardLabel(card(s, a.targetCard!))}被打掉了。`)
        }
        return
      }
      const id = pickOne()
      spend(id)
      log(s, `${me.name} 打出${cardLabel(card(s, id))}保住了場上的牌。`)
      return
    }
    case 'daltons': {
      const id = pickOne()
      s.q.shift()
      removeFromTable(s, p, id)
      toDiscard(s, id)
      log(s, `${me.name} 棄掉場上的${cardLabel(card(s, id))}。`)
      return
    }
    case 'handcuffs': {
      const suit = ans.opt as Suit
      if (!['H', 'D', 'C', 'S'].includes(suit)) fail('請選一個花色')
      s.q.shift()
      s.turn.suit = suit
      log(s, `${me.name} 宣告了${SUIT_NAME[suit]}。`)
      return
    }
    case 'newidentity': {
      s.q.shift()
      const other = me.charOptions.find((c) => c !== me.character)
      if (ans.opt === 'swap' && other) {
        me.character = other
        me.copy = null
        me.maxHp = CHAR_BY_ID[other].hp + (me.role === 'sheriff' ? 1 : 0)
        me.hp = Math.min(2, me.maxHp)
        log(s, `${me.name} 換成了 ${CHAR_BY_ID[other].name}，生命變成 ${me.hp}。`)
      }
      return
    }
    case 'blood': {
      s.q.shift()
      if (ans.target != null) {
        if (!view.targets.includes(ans.target) || me.hp <= 1) fail('不能這樣給血')
        me.hp--
        fx(s, { kind: 'hit', to: p, amount: 1 })
        heal(s, ans.target, 1)
        log(s, `${me.name} 失去 1 點生命，讓 ${nm(s, ans.target)} 回 1 點。`)
      }
      return
    }
    case 'liquor': {
      s.q.shift()
      if (ans.opt === 'heal') {
        heal(s, p, 1)
        log(s, `${me.name} 放棄抽牌，喝烈酒回 1 點生命。`)
        s.q = s.q.filter((t) => t.k !== 'drawPhase')
        s.turn.phase = 'play'
      }
      return
    }
    case 'peyote': {
      if (ans.opt !== 'red' && ans.opt !== 'black') fail('請猜紅色或黑色')
      s.q.shift()
      const id = drawOne(s)
      if (id == null) return
      const st = suitOf(s, card(s, id))
      const red = st === 'H' || st === 'D'
      const ok = (ans.opt === 'red') === red
      fx(s, { kind: 'check', to: p, card: { ...card(s, id), suit: st }, ok })
      if (ok) {
        me.hand.push(id)
        log(s, `${me.name} 猜${ans.opt === 'red' ? '紅' : '黑'}，翻出 ${cardSuitLabel({ ...card(s, id), suit: st })}，猜對了！`)
        s.q.unshift({ ...a, got: (a.got ?? 0) + 1 })
      } else {
        toDiscard(s, id)
        log(s, `${me.name} 猜${ans.opt === 'red' ? '紅' : '黑'}，翻出 ${cardSuitLabel({ ...card(s, id), suit: st })}，猜錯了。`)
      }
      return
    }
    case 'ranch': {
      const ids = ans.cards ?? []
      if (new Set(ids).size !== ids.length || !ids.every((id) => me.hand.includes(id))) fail('請選自己的手牌')
      s.q.shift()
      for (const id of ids) {
        removeFromHand(s, p, id)
        toDiscard(s, id)
      }
      draw(s, p, ids.length)
      if (ids.length) log(s, `${me.name} 在牧場換了 ${ids.length} 張牌。`)
      return
    }
    case 'roulette': {
      s.q.shift()
      if (ans.opt === 'take') {
        log(s, `${me.name} 沒有「射偏了！」，輪盤停在他身上。`)
        s.q.unshift({ k: 'damage', to: p, amount: 2, from: null })
        return
      }
      const id = pickOne()
      spend(id)
      log(s, `${me.name} 棄了${cardLabel(card(s, id))}。`)
      s.q.unshift({ k: 'ask', kind: 'roulette', player: nextAlive(s, p) })
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
        log(s, `${nm(s, q)} 手牌用完，抽 1 張。`)
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
        if (a.kind === 'duel') log(s, `${nm(s, a.player)} 沒有「砰！」，輸了決鬥。`)
        return auto({ k: 'damage', to: a.player, amount: 1, from: a.from ?? null })
      }
      return false
    case 'roulette':
      if (!v.cards.length) {
        log(s, `${nm(s, a.player)} 沒有「射偏了！」，輪盤停在他身上。`)
        return auto({ k: 'damage', to: a.player, amount: 2, from: null })
      }
      return false
    case 'ricochet':
      if (!v.cards.length) {
        const owner = s.players[a.player]
        if (owner.table.includes(a.targetCard!)) {
          removeFromTable(s, a.player, a.targetCard!)
          toDiscard(s, a.targetCard!)
          log(s, `${owner.name} 場上的${cardLabel(card(s, a.targetCard!))}被打掉了。`)
        }
        return auto()
      }
      return false
    case 'store':
      if (s.store.length <= 1) {
        const id = s.store.pop()
        if (id != null) {
          s.players[a.player].hand.push(id)
          log(s, `${nm(s, a.player)} 拿走雜貨店最後一張${cardLabel(card(s, id))}。`)
        }
        return auto()
      }
      return false
    case 'dying':
      if (s.players[a.player].hp > 0) return auto()
      if (!v.cards.length && !canSid(s, a.player)) return auto({ k: 'die', who: a.player, killer: a.from ?? null })
      return false
    case 'discard':
      return v.min <= 0 ? auto() : false
    case 'pedro':
      if (!s.discard.length) {
        auto()
        phaseDraw(s, a.player, drawCount(s, a.player))
        return true
      }
      return false
    case 'jesse':
      if (!v.targets.length) {
        auto()
        phaseDraw(s, a.player, drawCount(s, a.player))
        return true
      }
      return false
    case 'pat':
      if (!v.cards.length) {
        auto()
        phaseDraw(s, a.player, drawCount(s, a.player))
        return true
      }
      return false
    case 'vera':
    case 'blood':
      return v.targets.length ? false : auto()
    case 'daltons':
      return v.cards.length ? false : auto()
    case 'brawl': {
      const x = s.players[a.target!]
      if (!x.hand.length && !x.table.length) return auto()
      return false
    }
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
  if (s.players[p].ghost) return 3
  let n = 2
  if (hasChar(s, p, 'pixie')) n = 3
  if (hasChar(s, p, 'bill')) n = 1 + (s.players[p].maxHp - s.players[p].hp)
  if (evOn(s, 'thirst')) n = 1
  if (evOn(s, 'train')) n++
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
    case 'shot': {
      if (!isAlive(s, t.to)) return
      if (t.from != null) fx(s, { kind: 'shoot', from: t.from, to: t.to })
      if (t.from != null && t.from !== t.to && hasChar(s, t.to, 'apache') && t.suit === 'D') {
        log(s, `方塊牌對 ${nm(s, t.to)}（阿帕契小子）無效。`)
        return
      }
      s.q.unshift({ k: 'ask', kind: 'respond', player: t.to, from: t.from, need: t.need, got: 0, barrels: [], src: t.src })
      return
    }
    case 'damage': {
      const x = s.players[t.to]
      if (!x.alive) return
      if (x.ghost) {
        log(s, `${x.name} 是幽靈，不會受傷。`)
        return
      }
      x.hp -= t.amount
      log(s, `${x.name} 失去 ${t.amount} 點生命（${Math.max(0, x.hp)}/${x.maxHp}）。`)
      fx(s, { kind: 'hit', from: t.from ?? undefined, to: t.to, amount: t.amount })
      const after: Task = { k: 'afterDamage', to: t.to, amount: t.amount, from: t.from }
      if (x.hp <= 0) s.q.unshift({ k: 'ask', kind: 'dying', player: t.to, from: t.from }, after)
      else s.q.unshift(after)
      return
    }
    case 'afterDamage': {
      const x = s.players[t.to]
      if (!x.alive) return
      if (hasChar(s, t.to, 'bart')) {
        draw(s, t.to, t.amount)
        log(s, `${x.name} 受傷，抽 ${t.amount} 張牌。`)
      }
      if (hasChar(s, t.to, 'gringo') && t.from != null && t.from !== t.to && isAlive(s, t.from)) {
        const src = s.players[t.from]
        for (let i = 0; i < t.amount && src.hand.length; i++) {
          const id = src.hand[Math.floor(rand(s) * src.hand.length)]
          removeFromHand(s, t.from, id)
          x.hand.push(id)
        }
        log(s, `${x.name} 從 ${src.name} 手上拿走一張牌。`)
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
  // 幽靈：回合結束就離場
  if (x.ghost) {
    for (const id of [...x.hand, ...x.table]) toDiscard(s, id)
    x.hand = []
    x.table = []
    x.ghost = false
    x.alive = false
    log(s, `${x.name} 的幽靈消散了。`)
    s.q.unshift({ k: 'nextTurn' })
    return
  }
  const tasks: Task[] = []
  if (x.alive && x.hand.length > handLimit(s, p)) tasks.push({ k: 'ask', kind: 'discard', player: p })
  tasks.push({ k: 'nextTurn' })
  s.q.unshift(...tasks)
  // 復仇：抽到紅心再玩一回合
  if (evOn(s, 'vendetta') && x.alive && !s.turn.extra) {
    if (check(s, p, (c) => c.suit === 'H', '【復仇】')) {
      log(s, `${x.name} 要再玩一回合！`)
      s.q = s.q.map((t) => (t.k === 'nextTurn' ? ({ k: 'startTurn' } as Task) : t))
      s.turn = { active: p, no: s.turn.no + 1, bangs: 0, phase: 'start', uses: {}, extra: true }
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
      log(s, `☠ ${x.name} 死而復生，帶著 2 點生命回來了！`)
      fx(s, { kind: 'revive', to: q })
      break
    }
    if (evOn(s, 'ghosttown') && x.character) {
      x.alive = true
      x.ghost = true
      log(s, `👻 ${x.name} 以幽靈身分回到牌桌。`)
      fx(s, { kind: 'revive', to: q })
      break
    }
  }
  s.turn = { active: q, no: s.turn.no + 1, bangs: 0, phase: 'start', uses: {} }
  s.q.unshift({ k: 'startTurn' })
}

function startTurn(s: GameState) {
  const p = s.turn.active
  const me = s.players[p]
  if (!me.alive) {
    s.q.unshift({ k: 'nextTurn' })
    return
  }
  log(s, `── 第 ${s.turn.no} 回合：${me.name}${me.ghost ? '（幽靈）' : ''} ──`)
  fx(s, { kind: 'turn', to: p })
  if (hasChar(s, p, 'vera') || me.character === 'vera') me.copy = null
  const tasks: Task[] = []
  // 警長回合開始：翻開下一張事件牌（第一輪不翻）
  if (me.role === 'sheriff' && s.events && s.turn.no > 1 && !s.turn.extra && s.events.deck.length) {
    const ev = s.events.deck.shift()!
    s.events.current = ev
    const def = EVENT_BY_ID[ev]
    log(s, `📜 事件：【${def.name}】${def.text}`)
    fx(s, { kind: 'event', event: ev })
    s.dir = ev === 'goldrush' ? -1 : 1
    if (ev === 'doctor') {
      const living = alive(s)
      const min = Math.min(...living.map((q) => s.players[q].hp))
      for (const q of living) if (s.players[q].hp === min) heal(s, q, 1)
      log(s, `生命最少的人各回 1 點生命。`)
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
  }
  // 每回合開始的事件
  if (evOn(s, 'highnoon')) tasks.push({ k: 'damage', to: p, amount: 1, from: null })
  if (evOn(s, 'fistful')) {
    const n = me.hand.length
    if (n) log(s, `${me.name} 手上有 ${n} 張牌，要挨 ${n} 槍！`)
    for (let i = 0; i < n; i++) tasks.push({ k: 'shot', from: null, to: p, need: 1, src: 'bang' })
  }
  if (evOn(s, 'newidentity')) tasks.push({ k: 'ask', kind: 'newidentity', player: p })
  if (evOn(s, 'blood') && me.hp > 1) tasks.push({ k: 'ask', kind: 'blood', player: p })
  if (me.character === 'vera' && !evOn(s, 'hangover')) tasks.push({ k: 'ask', kind: 'vera', player: p })
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
    const safe = check(s, p, (c) => !(c.suit === 'S' && c.rank >= 2 && c.rank <= 9), '【炸藥】')
    removeFromTable(s, p, dyn)
    if (!safe) {
      toDiscard(s, dyn)
      log(s, `【炸藥】在 ${me.name} 面前爆炸！`)
      fx(s, { kind: 'explode', to: p })
      s.q.unshift({ k: 'damage', to: p, amount: 3, from: null }, { k: 'turnChecks' })
      return
    }
    let q = nextAlive(s, p)
    while (q !== p && ownsKey(s, q, 'dynamite')) q = nextAlive(s, q)
    s.players[q].table.push(dyn)
    log(s, `【炸藥】沒爆，傳給 ${nm(s, q)}。`)
  }
  // 監獄
  const jail = me.table.find((id) => keyOf(s, id) === 'jail')
  if (jail != null && on) {
    const free = check(s, p, (c) => c.suit === 'H', '【監獄】')
    removeFromTable(s, p, jail)
    toDiscard(s, jail)
    if (!free) {
      log(s, `${me.name} 被關在監獄裡，跳過這回合。`)
      s.q.unshift({ k: 'nextTurn' })
      return
    }
    log(s, `${me.name} 逃出監獄！`)
  }
  s.q.unshift({ k: 'drawPhase' }, { k: 'afterDraw' })
}

function drawPhase(s: GameState) {
  const p = s.turn.active
  const me = s.players[p]
  s.turn.phase = 'play'
  s.turn.drawn = []
  const n = drawCount(s, p)
  if (me.ghost) {
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
      log(s, `${me.name} 亮出第二張牌 ${cardLabel(c)}${cardSuitLabel({ ...c, suit: st })}${red ? '，是紅色，多抽 1 張' : ''}。`)
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
      log(s, `${me.name} 亮出第二張牌${cardLabel(card(s, second))}${cardSuitLabel(card(s, second))}。`)
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
  x.alive = false
  x.hp = 0
  if (s.firstDead == null) s.firstDead = who
  log(s, `💀 ${x.name} 死亡，身份是【${ROLE_NAME[x.role]}】。`)
  fx(s, { kind: 'death', from: killer ?? undefined, to: who })
  // 遺物：禿鷹山姆拿走，否則棄掉
  const loot = [...x.hand, ...x.table]
  x.hand = []
  x.table = []
  for (const id of loot) delete s.greenAt[id]
  const vulture = alive(s).find((q) => hasChar(s, q, 'vulture'))
  if (vulture != null && loot.length) {
    s.players[vulture].hand.push(...loot)
    log(s, `${nm(s, vulture)} 拿走了 ${x.name} 的 ${loot.length} 張牌。`)
  } else for (const id of loot) toDiscard(s, id)
  for (const q of alive(s)) {
    if (hasChar(s, q, 'greg')) {
      const n = heal(s, q, 2)
      if (n) log(s, `${nm(s, q)} 回 ${n} 點生命。`)
    }
    if (hasChar(s, q, 'herb')) {
      draw(s, q, 2)
      log(s, `${nm(s, q)} 抽 2 張牌。`)
    }
  }

  if (checkWin(s)) return
  // 獎懲
  if (killer != null && killer !== who && isAlive(s, killer)) {
    if (x.role === 'outlaw') {
      draw(s, killer, 3)
      log(s, `${nm(s, killer)} 擊斃歹徒，獎勵抽 3 張牌。`)
    } else if (x.role === 'deputy' && s.players[killer].role === 'sheriff') {
      const k = s.players[killer]
      for (const id of [...k.hand, ...k.table]) toDiscard(s, id)
      k.hand = []
      k.table = []
      log(s, `警長誤殺了副警長，必須棄掉所有手牌和裝備！`)
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
  const sheriffAlive = living.some((p) => p.role === 'sheriff')
  const all = s.players
  if (!sheriffAlive) {
    if (living.length === 1 && living[0].role === 'renegade') {
      s.result = { side: 'renegade', winners: [living[0].seat], reason: `叛徒 ${living[0].name} 成為最後的倖存者！` }
    } else {
      s.result = { side: 'outlaws', winners: all.filter((p) => p.role === 'outlaw').map((p) => p.seat), reason: '警長倒下了，歹徒獲勝！' }
    }
  } else if (!living.some((p) => p.role === 'outlaw' || p.role === 'renegade')) {
    s.result = { side: 'law', winners: all.filter((p) => p.role === 'sheriff' || p.role === 'deputy').map((p) => p.seat), reason: '歹徒和叛徒都被消滅，警長獲勝！' }
  }
  if (s.result) {
    s.q = []
    s.turn.phase = 'end'
    log(s, `遊戲結束：${s.result.reason}`)
    return true
  }
  return false
}
