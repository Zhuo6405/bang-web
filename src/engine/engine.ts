import { buildCards, CARD_DEFS, CHAR_BY_ID, CHARACTERS, cardLabel, cardSuitLabel, isWeapon, ROLE_NAME, ROLE_SETUP } from './data'
import type { Action, Ask, AskOption, AskView, Card, CardKey, Decision, Fx, GameConfig, GameState, LegalPlay, Task } from './types'

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
export const hasChar = (s: GameState, p: number, id: string) => s.players[p].character === id
const tableHas = (s: GameState, p: number, k: CardKey) => s.players[p].table.some((id) => keyOf(s, id) === k)

function log(s: GameState, text: string) {
  s.log.push({ seq: ++s.seq, text, turn: s.turn.no })
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400)
}
function fx(s: GameState, f: Omit<Fx, 'seq'>) {
  s.fx.push({ seq: ++s.seq, ...f })
  if (s.fx.length > 40) s.fx.splice(0, s.fx.length - 40)
}

export function nextAlive(s: GameState, p: number) {
  const n = s.players.length
  for (let i = 1; i <= n; i++) {
    const q = (p + i) % n
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
function toDiscard(s: GameState, id: number) {
  s.discard.push(id)
}
function removeFromHand(s: GameState, p: number, id: number) {
  const h = s.players[p].hand
  const i = h.indexOf(id)
  if (i < 0) fail('那張牌不在你手上')
  h.splice(i, 1)
}
function removeFromTable(s: GameState, p: number, id: number) {
  const t = s.players[p].table
  const i = t.indexOf(id)
  if (i < 0) fail('那張牌不在場上')
  t.splice(i, 1)
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
  const pick = flipped.find((id) => good(card(s, id))) ?? flipped[0]
  for (const id of flipped) toDiscard(s, id)
  const c = card(s, pick)
  const ok = good(c)
  const shown = flipped.map((id) => cardSuitLabel(card(s, id))).join('、')
  log(s, `${nm(s, p)} 為${what}抽判定：${shown}${n > 1 ? `（取 ${cardSuitLabel(c)}）` : ''} → ${ok ? '成功' : '失敗'}`)
  fx(s, { kind: 'check', to: p, card: c, ok })
  return ok
}

// ───────────── 距離 ─────────────
export function distance(s: GameState, a: number, b: number) {
  const n = s.players.length
  let cw = 0
  for (let q = a; q !== b; q = (q + 1) % n) if (s.players[(q + 1) % n].alive || (q + 1) % n === b) cw++
  let ccw = 0
  for (let q = a; q !== b; q = (q - 1 + n) % n) if (s.players[(q - 1 + n) % n].alive || (q - 1 + n) % n === b) ccw++
  let d = Math.min(cw, ccw)
  if (tableHas(s, b, 'mustang')) d++
  if (hasChar(s, b, 'paul')) d++
  if (tableHas(s, a, 'scope')) d--
  if (hasChar(s, a, 'rose')) d--
  return Math.max(1, d)
}
export function weaponRange(s: GameState, p: number) {
  for (const id of s.players[p].table) {
    const r = CARD_DEFS[keyOf(s, id)].range
    if (r) return r
  }
  return 1
}
const unlimitedBang = (s: GameState, p: number) => hasChar(s, p, 'willy') || tableHas(s, p, 'volcanic')

// ───────────── 開局 ─────────────
export function startGame(config: GameConfig): GameState {
  const n = config.names.length
  if (!ROLE_SETUP[n] || n < 4) fail('人數需要 4–7 人')
  const s: GameState = {
    config,
    rng: config.seed | 0,
    cards: buildCards(config.expansions),
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
  }
  s.deck = shuffle(s, s.cards.map((c) => c.id))
  const roles = shuffle(s, [...ROLE_SETUP[n]])
  const chars = shuffle(s, CHARACTERS.map((c) => c.id))
  s.players = config.names.map((name, seat) => ({
    seat,
    name,
    isAI: !!config.ai[seat],
    role: roles[seat],
    character: null,
    charOptions: [chars[seat * 2], chars[seat * 2 + 1]],
    hp: 0,
    maxHp: 0,
    hand: [],
    table: [],
    alive: true,
  }))
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
  s.turn.phase = 'start'
  s.turn.no = 1
  s.q.push({ k: 'startTurn' })
  run(s)
}

// ───────────── 合法出牌 ─────────────
function hasCards(s: GameState, p: number) {
  return s.players[p].hand.length + s.players[p].table.length > 0
}

export function legalPlays(s: GameState, p: number): LegalPlay[] {
  if (s.result || s.q.length || s.turn.phase !== 'play' || s.turn.active !== p) return []
  const me = s.players[p]
  const others = alive(s).filter((q) => q !== p)
  const out: LegalPlay[] = []
  const bangOk = s.turn.bangs < 1 || unlimitedBang(s, p)
  const reach = weaponRange(s, p)
  const inRange = others.filter((q) => distance(s, p, q) <= reach)
  for (const id of me.hand) {
    const k = keyOf(s, id)
    const asBang = k === 'bang' || (k === 'missed' && hasChar(s, p, 'calamity'))
    if (asBang && bangOk && inRange.length) out.push({ card: id, as: 'bang', targets: inRange })
    switch (k) {
      case 'beer':
        if (me.hp < me.maxHp && alive(s).length > 2) out.push({ card: id, as: k, targets: null })
        break
      case 'saloon':
      case 'stagecoach':
      case 'wellsfargo':
      case 'store':
      case 'gatling':
      case 'indians':
        out.push({ card: id, as: k, targets: null })
        break
      case 'duel':
        out.push({ card: id, as: k, targets: others })
        break
      case 'panic': {
        const t = others.filter((q) => distance(s, p, q) <= 1 && hasCards(s, q))
        if (t.length) out.push({ card: id, as: k, targets: t, pickCard: true })
        break
      }
      case 'catbalou': {
        const t = others.filter((q) => hasCards(s, q))
        if (t.length) out.push({ card: id, as: k, targets: t, pickCard: true })
        break
      }
      case 'jail': {
        const t = others.filter((q) => s.players[q].role !== 'sheriff' && !tableHas(s, q, 'jail'))
        if (t.length) out.push({ card: id, as: k, targets: t })
        break
      }
      default:
        if (CARD_DEFS[k].colour === 'blue' && !tableHas(s, p, k)) out.push({ card: id, as: k, targets: null })
    }
  }
  return out
}

// ───────────── 詢問 ─────────────
function missedCards(s: GameState, p: number) {
  return s.players[p].hand.filter((id) => {
    const k = keyOf(s, id)
    return k === 'missed' || (k === 'bang' && hasChar(s, p, 'calamity'))
  })
}
function bangCards(s: GameState, p: number) {
  return s.players[p].hand.filter((id) => {
    const k = keyOf(s, id)
    return k === 'bang' || (k === 'missed' && hasChar(s, p, 'calamity'))
  })
}
function barrelSources(s: GameState, p: number, used: string[]) {
  const out: string[] = []
  if (hasChar(s, p, 'jourdonnais') && !used.includes('jour')) out.push('jour')
  if (tableHas(s, p, 'barrel') && !used.includes('barrel')) out.push('barrel')
  return out
}
function beerCards(s: GameState, p: number) {
  if (alive(s).length <= 2) return []
  return s.players[p].hand.filter((id) => keyOf(s, id) === 'beer')
}
const canSid = (s: GameState, p: number) => hasChar(s, p, 'sid') && s.players[p].hand.length >= 2

function srcName(k?: CardKey) {
  return k ? CARD_DEFS[k].name : ''
}

export function askView(s: GameState, a: Ask): AskView {
  const base: AskView = { kind: a.kind, title: '', prompt: '', options: [], cards: [], zone: 'hand', min: 1, max: 1, targets: [], shown: [] }
  const from = a.from != null ? nm(s, a.from) : ''
  switch (a.kind) {
    case 'respond': {
      const left = (a.need ?? 1) - (a.got ?? 0)
      const opts: AskOption[] = []
      if (barrelSources(s, a.player, a.barrels ?? []).length) opts.push({ id: 'barrel', label: '用木桶抽判定', primary: true })
      opts.push({ id: 'take', label: '中彈（失去 1 點生命）' })
      return {
        ...base,
        title: '有人對你開槍',
        prompt: `${from} 用【${srcName(a.src)}】對你開槍！${left > 1 ? `還需要 ${left} 張「射偏了！」。` : ''}點一張「射偏了！」躲開，或選擇下面的動作。`,
        options: opts,
        cards: missedCards(s, a.player),
      }
    }
    case 'indians':
      return { ...base, title: '印第安人來襲', prompt: `${from} 打出【印第安人！】：棄一張「砰！」，否則失去 1 點生命。`, options: [{ id: 'take', label: '失去 1 點生命' }], cards: bangCards(s, a.player) }
    case 'duel':
      return { ...base, title: '決鬥', prompt: `你和 ${from} 決鬥中：棄一張「砰！」，否則失去 1 點生命。`, options: [{ id: 'take', label: '認輸（失去 1 點生命）' }], cards: bangCards(s, a.player) }
    case 'store':
      return { ...base, title: '雜貨店', prompt: '從翻開的牌中挑一張。', zone: 'store', cards: [...s.store] }
    case 'dying': {
      const opts: AskOption[] = []
      if (canSid(s, a.player)) opts.push({ id: 'sid', label: '棄 2 張手牌回 1 點生命' })
      opts.push({ id: 'die', label: '放棄' })
      return { ...base, title: '瀕死', prompt: `你的生命歸零了！喝啤酒自救${alive(s).length <= 2 ? '（只剩兩人，啤酒無效）' : ''}，否則死亡。`, options: opts, cards: beerCards(s, a.player), max: canSid(s, a.player) ? 2 : 1 }
    }
    case 'discard': {
      const p = s.players[a.player]
      const n = p.hand.length - Math.max(0, p.hp)
      return { ...base, title: '回合結束', prompt: `手牌不能超過生命值，請棄掉 ${n} 張。`, options: [{ id: 'ok', label: '棄掉選取的牌', primary: true }], cards: [...p.hand], min: n, max: n }
    }
    case 'kit':
      return { ...base, title: '基特．卡爾森', prompt: '從牌堆頂的 3 張中挑 2 張，另一張放回牌堆頂。', zone: 'reveal', cards: a.cards ?? [], shown: (a.cards ?? []).map((id) => card(s, id)), min: 2, max: 2, options: [{ id: 'ok', label: '拿這兩張', primary: true }] }
    case 'jesse': {
      const t = alive(s).filter((q) => q !== a.player && s.players[q].hand.length > 0)
      return { ...base, title: '傑西．瓊斯', prompt: '第一張牌要從牌堆抽，還是從某位玩家手上隨機拿？', options: [{ id: 'deck', label: '從牌堆抽', primary: true }], targets: t, min: 0 }
    }
    case 'pedro': {
      const top = s.discard[s.discard.length - 1]
      return { ...base, title: '佩卓．拉米雷斯', prompt: `第一張牌要從牌堆抽，還是拿棄牌堆最上面的${top != null ? cardLabel(card(s, top)) : ''}？`, options: [{ id: 'discard', label: '拿棄牌堆那張', primary: true }, { id: 'deck', label: '從牌堆抽' }], min: 0 }
    }
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
        doSid(s, p, a.cards)
        // 瀕死時用席德能力救回來
        const head = s.q[0] as Ask
        if (head.kind === 'dying' && me.hp > 0) s.q.shift()
        run(s)
        return s
      }
      if (a.type !== 'answer') fail('請先回應目前的詢問')
      answer(s, s.q[0] as Ask, a as Extract<Action, { type: 'answer' }>)
      run(s)
      return s
    case 'play':
      if (a.type === 'end_turn') {
        s.turn.phase = 'end'
        s.q.push({ k: 'endTurn' })
      } else if (a.type === 'ability') {
        doSid(s, p, a.cards)
      } else if (a.type === 'play') {
        playCard(s, p, a)
      } else fail('現在是你的出牌階段')
      run(s)
      return s
  }
  return s
}

function doSid(s: GameState, p: number, cards: number[]) {
  const me = s.players[p]
  if (!hasChar(s, p, 'sid')) fail('只有席德．凱強有這個能力')
  if (cards.length !== 2 || new Set(cards).size !== 2 || !cards.every((id) => me.hand.includes(id))) fail('請選 2 張手牌')
  if (me.hp >= me.maxHp) fail('生命已經是滿的')
  for (const id of cards) {
    removeFromHand(s, p, id)
    toDiscard(s, id)
  }
  me.hp++
  log(s, `${me.name} 棄 2 張牌回復 1 點生命（${me.hp}/${me.maxHp}）。`)
  fx(s, { kind: 'heal', to: p, amount: 1 })
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
  removeFromHand(s, p, a.card)

  // 裝備
  if (CARD_DEFS[c.key].colour === 'blue') {
    if (c.key === 'jail') {
      s.players[t].table.push(c.id)
      log(s, `${me.name} 把 ${nm(s, t)} 關進【監獄】。`)
      fx(s, { kind: 'equip', from: p, to: t, card: c })
      rep(s, p, t)
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
    log(s, `${me.name} 裝備${cardLabel(c)}。`)
    fx(s, { kind: 'equip', from: p, to: p, card: c })
    return
  }

  toDiscard(s, c.id)
  const as = l.as
  fx(s, { kind: 'play', from: p, to: l.targets ? t : undefined, card: c })
  switch (as) {
    case 'bang':
      s.turn.bangs++
      log(s, `${me.name} 對 ${nm(s, t)} 打出${c.key === 'bang' ? '【砰！】' : '「射偏了！」當作【砰！】'}。`)
      rep(s, p, t)
      s.q.push({ k: 'shot', from: p, to: t, need: hasChar(s, p, 'slab') ? 2 : 1, src: 'bang' })
      break
    case 'beer':
      me.hp = Math.min(me.maxHp, me.hp + 1)
      log(s, `${me.name} 喝了【啤酒】（${me.hp}/${me.maxHp}）。`)
      fx(s, { kind: 'heal', to: p, amount: 1 })
      break
    case 'saloon':
      log(s, `${me.name} 打出【酒館】，所有人回復 1 點生命。`)
      for (const q of alive(s)) {
        const x = s.players[q]
        if (x.hp < x.maxHp) {
          x.hp++
          fx(s, { kind: 'heal', to: q, amount: 1 })
        }
      }
      break
    case 'stagecoach':
      draw(s, p, 2)
      log(s, `${me.name} 打出【驛馬車】，抽 2 張。`)
      break
    case 'wellsfargo':
      draw(s, p, 3)
      log(s, `${me.name} 打出【富國快遞】，抽 3 張。`)
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
      log(s, `${me.name} 架起【格林機槍】掃射所有人！`)
      for (let q = nextAlive(s, p); q !== p; q = nextAlive(s, q)) s.q.push({ k: 'shot', from: p, to: q, need: 1, src: 'gatling' })
      break
    case 'indians':
      log(s, `${me.name} 打出【印第安人！】。`)
      for (let q = nextAlive(s, p); q !== p; q = nextAlive(s, q)) s.q.push({ k: 'ask', kind: 'indians', player: q, from: p })
      break
    case 'duel':
      log(s, `${me.name} 向 ${nm(s, t)} 提出【決鬥】！`)
      rep(s, p, t)
      s.q.push({ k: 'ask', kind: 'duel', player: t, from: p })
      break
    case 'panic':
    case 'catbalou': {
      const x = s.players[t]
      let taken: number
      if (a.targetCard === 'hand' || a.targetCard == null) {
        if (!x.hand.length) fail('他沒有手牌')
        taken = x.hand[Math.floor(rand(s) * x.hand.length)]
        removeFromHand(s, t, taken)
      } else {
        taken = a.targetCard
        removeFromTable(s, t, taken)
      }
      rep(s, p, t)
      const fromWhere = a.targetCard === 'hand' || a.targetCard == null ? '一張手牌' : cardLabel(card(s, taken))
      if (as === 'panic') {
        me.hand.push(taken)
        log(s, `${me.name} 用【搶奪】拿走 ${nm(s, t)} 的${fromWhere}。`)
        fx(s, { kind: 'steal', from: t, to: p })
      } else {
        toDiscard(s, taken)
        log(s, `${me.name} 用【卡特巴洛】棄掉 ${nm(s, t)} 的${fromWhere === '一張手牌' ? `手牌${cardLabel(card(s, taken))}` : fromWhere}。`)
      }
      break
    }
    default:
      fail('這張牌現在不能用')
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
        removeFromHand(s, p, id)
        toDiscard(s, id)
        next.got = (next.got ?? 0) + 1
        log(s, `${me.name} 打出${keyOf(s, id) === 'missed' ? '【射偏了！】' : '「砰！」當作【射偏了！】'}。`)
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
      removeFromHand(s, p, id)
      toDiscard(s, id)
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
      removeFromHand(s, p, id)
      toDiscard(s, id)
      me.hp++
      log(s, `${me.name} 喝下【啤酒】撐住了（${me.hp}/${me.maxHp}）。`)
      fx(s, { kind: 'heal', to: p, amount: 1 })
      if (me.hp > 0) s.q.shift()
      return
    }
    case 'discard': {
      const ids = ans.cards ?? []
      if (ids.length !== view.min || new Set(ids).size !== ids.length || !ids.every((id) => me.hand.includes(id))) fail(`請選 ${view.min} 張要棄掉的牌`)
      for (const id of ids) {
        removeFromHand(s, p, id)
        toDiscard(s, id)
      }
      log(s, `${me.name} 棄掉 ${ids.length} 張牌。`)
      s.q.shift()
      return
    }
    case 'kit': {
      const ids = ans.cards ?? []
      const shown = a.cards ?? []
      if (ids.length !== Math.min(2, shown.length) || !ids.every((id) => shown.includes(id)) || new Set(ids).size !== ids.length) fail('請挑 2 張')
      me.hand.push(...ids)
      for (const id of shown) if (!ids.includes(id)) s.deck.push(id)
      log(s, `${me.name} 看了牌堆頂 3 張，拿走 2 張。`)
      s.q.shift()
      return
    }
    case 'jesse': {
      s.q.shift()
      if (ans.target != null) {
        if (!view.targets.includes(ans.target)) fail('他沒有手牌')
        const x = s.players[ans.target]
        const id = x.hand[Math.floor(rand(s) * x.hand.length)]
        removeFromHand(s, ans.target, id)
        me.hand.push(id)
        log(s, `${me.name} 從 ${x.name} 手上拿了一張牌。`)
        fx(s, { kind: 'steal', from: ans.target, to: p })
        draw(s, p, 1)
      } else draw(s, p, 2)
      return
    }
    case 'pedro': {
      s.q.shift()
      if (ans.opt === 'discard' && s.discard.length) {
        const id = s.discard.pop()!
        me.hand.push(id)
        log(s, `${me.name} 拿走棄牌堆的${cardLabel(card(s, id))}。`)
        draw(s, p, 1)
      } else draw(s, p, 2)
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
    for (const q of alive(s)) if (hasChar(s, q, 'suzy') && s.players[q].hand.length === 0 && s.turn.phase !== 'choose') {
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

/** 沒有任何選擇的詢問直接替玩家處理（例如沒有射偏了也沒有木桶） */
function autoAsk(s: GameState, a: Ask): boolean {
  if (!isAlive(s, a.player)) {
    s.q.shift()
    return true
  }
  const v = askView(s, a)
  switch (a.kind) {
    case 'respond':
    case 'indians':
    case 'duel':
      if (!v.cards.length && v.options.length === 1) {
        s.q.shift()
        s.q.unshift({ k: 'damage', to: a.player, amount: 1, from: a.from ?? null })
        if (a.kind === 'duel') log(s, `${nm(s, a.player)} 沒有「砰！」，輸了決鬥。`)
        return true
      }
      return false
    case 'store':
      if (s.store.length <= 1) {
        s.q.shift()
        const id = s.store.pop()
        if (id != null) {
          s.players[a.player].hand.push(id)
          log(s, `${nm(s, a.player)} 拿走雜貨店最後一張${cardLabel(card(s, id))}。`)
        }
        return true
      }
      return false
    case 'dying':
      if (s.players[a.player].hp > 0) {
        s.q.shift()
        return true
      }
      if (!v.cards.length && !canSid(s, a.player)) {
        s.q.shift()
        s.q.unshift({ k: 'die', who: a.player, killer: a.from ?? null })
        return true
      }
      return false
    case 'discard':
      if (v.min <= 0) {
        s.q.shift()
        return true
      }
      return false
    case 'pedro':
      if (!s.discard.length) {
        s.q.shift()
        draw(s, a.player, 2)
        return true
      }
      return false
    case 'jesse':
      if (!v.targets.length) {
        s.q.shift()
        draw(s, a.player, 2)
        return true
      }
      return false
    default:
      return false
  }
}

function step(s: GameState, t: Task) {
  switch (t.k) {
    case 'startTurn':
      return startTurn(s)
    case 'drawPhase':
      return drawPhase(s)
    case 'shot': {
      if (!isAlive(s, t.to)) return
      fx(s, { kind: 'shoot', from: t.from, to: t.to })
      s.q.unshift({ k: 'ask', kind: 'respond', player: t.to, from: t.from, need: t.need, got: 0, barrels: [], src: t.src })
      return
    }
    case 'damage': {
      const x = s.players[t.to]
      if (!x.alive) return
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
    case 'endTurn': {
      const p = s.turn.active
      const x = s.players[p]
      if (x.alive && x.hand.length > Math.max(0, x.hp)) s.q.unshift({ k: 'ask', kind: 'discard', player: p }, { k: 'nextTurn' })
      else s.q.unshift({ k: 'nextTurn' })
      return
    }
    case 'nextTurn': {
      const next = nextAlive(s, s.turn.active)
      s.turn = { active: next, no: s.turn.no + 1, bangs: 0, phase: 'start' }
      s.q.unshift({ k: 'startTurn' })
      return
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
  log(s, `── 第 ${s.turn.no} 回合：${me.name} ──`)
  fx(s, { kind: 'turn', to: p })
  // 炸藥
  const dyn = me.table.find((id) => keyOf(s, id) === 'dynamite')
  if (dyn != null) {
    const safe = check(s, p, (c) => !(c.suit === 'S' && c.rank >= 2 && c.rank <= 9), '【炸藥】')
    removeFromTable(s, p, dyn)
    if (!safe) {
      toDiscard(s, dyn)
      log(s, `【炸藥】在 ${me.name} 面前爆炸！`)
      fx(s, { kind: 'explode', to: p })
      s.q.unshift({ k: 'damage', to: p, amount: 3, from: null }, { k: 'startTurn' })
      // 炸完再重新開始這回合（監獄與抽牌）；炸死的話 startTurn 會直接換人
      return
    }
    let q = nextAlive(s, p)
    while (q !== p && tableHas(s, q, 'dynamite')) q = nextAlive(s, q)
    s.players[q].table.push(dyn)
    log(s, `【炸藥】沒爆，傳給 ${nm(s, q)}。`)
  }
  // 監獄
  const jail = me.table.find((id) => keyOf(s, id) === 'jail')
  if (jail != null) {
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
  s.q.unshift({ k: 'drawPhase' })
}

function drawPhase(s: GameState) {
  const p = s.turn.active
  const me = s.players[p]
  s.turn.phase = 'play'
  if (hasChar(s, p, 'kit')) {
    const shown: number[] = []
    for (let i = 0; i < 3; i++) {
      const id = drawOne(s)
      if (id != null) shown.push(id)
    }
    if (shown.length <= 2) me.hand.push(...shown)
    else s.q.unshift({ k: 'ask', kind: 'kit', player: p, cards: shown })
    return
  }
  if (hasChar(s, p, 'jesse')) {
    s.q.unshift({ k: 'ask', kind: 'jesse', player: p })
    return
  }
  if (hasChar(s, p, 'pedro')) {
    s.q.unshift({ k: 'ask', kind: 'pedro', player: p })
    return
  }
  if (hasChar(s, p, 'blackjack')) {
    draw(s, p, 2)
    const second = me.hand[me.hand.length - 1]
    if (second != null) {
      const c = card(s, second)
      const red = c.suit === 'H' || c.suit === 'D'
      log(s, `${me.name} 亮出第二張牌 ${cardLabel(c)}${cardSuitLabel(c)}${red ? '，是紅色，多抽 1 張' : ''}。`)
      fx(s, { kind: 'check', to: p, card: c, ok: red })
      if (red) draw(s, p, 1)
    }
    return
  }
  draw(s, p, 2)
}

function die(s: GameState, who: number, killer: number | null) {
  const x = s.players[who]
  if (!x.alive) return
  x.alive = false
  x.hp = 0
  log(s, `💀 ${x.name} 死亡，身份是【${ROLE_NAME[x.role]}】。`)
  fx(s, { kind: 'death', from: killer ?? undefined, to: who })
  // 遺物：禿鷹山姆拿走，否則棄掉
  const loot = [...x.hand, ...x.table]
  x.hand = []
  x.table = []
  const vulture = alive(s).find((q) => hasChar(s, q, 'vulture'))
  if (vulture != null && loot.length) {
    s.players[vulture].hand.push(...loot)
    log(s, `${nm(s, vulture)} 拿走了 ${x.name} 的 ${loot.length} 張牌。`)
  } else for (const id of loot) toDiscard(s, id)

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
  const living = s.players.filter((p) => p.alive)
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
