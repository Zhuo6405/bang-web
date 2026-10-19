import { CARD_DEFS, CHAR_BY_ID, ROLE_SETUP } from '../engine/data'
import type { Action, AskView, Card, CardKey, LegalPlay, Role } from '../engine/types'
import type { GameView, PublicPlayer } from '../engine/view'

// 簡單的啟發式 AI：只看自己的視角（不作弊）

const BASE_VALUE: Record<CardKey, number> = {
  missed: 5,
  beer: 4.5,
  bang: 4,
  wellsfargo: 5,
  stagecoach: 4,
  gatling: 4,
  panic: 4,
  catbalou: 3.5,
  duel: 3,
  indians: 3,
  store: 2.5,
  saloon: 2,
  barrel: 5,
  mustang: 4,
  scope: 3,
  jail: 3,
  dynamite: 1,
  volcanic: 2.5,
  schofield: 2,
  remington: 2.5,
  carabine: 3,
  winchester: 3.5,
}

const CHAR_PREF: Record<string, number> = {
  willy: 9, slab: 8, jourdonnais: 8, bart: 7, kit: 7, lucky: 7, calamity: 7, blackjack: 6, sid: 6,
  paul: 5, rose: 6, jesse: 6, pedro: 5, suzy: 5, vulture: 6, gringo: 5,
}

const rnd = Math.random

function value(v: GameView, c: Card) {
  let x = BASE_VALUE[c.key] ?? 2
  const me = v.players[v.me]
  if (c.key === 'beer' && me.hp >= me.maxHp) x = 2.5
  if (CARD_DEFS[c.key].colour === 'blue' && me.table.some((t) => t.key === c.key)) x = 0.5
  if (CARD_DEFS[c.key].range && (CARD_DEFS[c.key].range ?? 0) <= v.myRange) x = 1
  return x + rnd() * 0.3
}

const sheriffSeat = (v: GameView) => v.players.find((p) => p.role === 'sheriff')?.seat ?? -1

/** 某身份還有幾個活著（由開局配置與已公開的死者推算） */
function remaining(v: GameView, role: Role) {
  const total = (ROLE_SETUP[v.players.length] ?? []).filter((r) => r === role).length
  return total - v.players.filter((p) => !p.alive && p.role === role).length
}

/** 對方是敵人的程度：> 0 敵人，< 0 自己人 */
function hostility(v: GameView, q: PublicPlayer): number {
  const me = v.players[v.me]
  const role = me.role!
  const sh = sheriffSeat(v)
  const living = v.players.filter((p) => p.alive)
  // 拖太久就越來越好戰，避免僵局
  const urgency = Math.min(3, v.turnNo / 30)
  if (q.seat === v.me) return -99
  const outlawsLeft = remaining(v, 'outlaw')
  const renegadesLeft = remaining(v, 'renegade')
  switch (role) {
    case 'sheriff':
    case 'deputy': {
      if (q.role === 'sheriff') return -10
      // 歹徒都死光了：剩下的未知者只可能是副警長或叛徒
      if (outlawsLeft === 0) {
        const unknown = living.filter((p) => p.seat !== v.me && p.role !== 'sheriff')
        const deputiesLeft = remaining(v, 'deputy') - (role === 'deputy' ? 1 : 0)
        if (deputiesLeft <= 0) return 5
        if (unknown.length <= renegadesLeft) return 5
        return -q.rep + urgency * 0.6
      }
      return -q.rep + (role === 'sheriff' ? 0.3 : 0) + urgency * 0.3
    }
    case 'outlaw':
      if (q.seat === sh) return 10
      return q.rep * 1.2 + 0.1 + urgency * 0.4
    case 'renegade': {
      if (q.seat === sh) return living.length <= 2 ? 10 : q.hp <= 2 ? -5 : -1 + urgency * 0.2
      // 歹徒死光後，所有人都是障礙（先清副警長，最後單挑警長）
      if (outlawsLeft === 0) return 4
      return -q.rep + 0.2 + urgency * 0.3
    }
  }
}

function enemies(v: GameView, among: number[]) {
  return among
    .map((s) => v.players[s])
    .filter((p) => hostility(v, p) > 0)
    .sort((a, b) => hostility(v, b) - hostility(v, a) || a.hp - b.hp)
}

export function decide(v: GameView): Action {
  const d = v.decision
  if (!d) return { type: 'end_turn' }
  if (d.type === 'choose_character') {
    const best = [...d.options].sort((a, b) => (CHAR_PREF[b] ?? 5) - (CHAR_PREF[a] ?? 5))[0]
    return { type: 'choose_character', character: best }
  }
  if (d.type === 'ask') return answer(v, d.ask)
  return playTurn(v)
}

function answer(v: GameView, a: AskView): Action {
  const me = v.players[v.me]
  const hand = new Map(v.hand.map((c) => [c.id, c]))
  const cheapest = (ids: number[], n: number) =>
    [...ids].sort((x, y) => value(v, hand.get(x) ?? v.store.find((c) => c.id === x)!) - value(v, hand.get(y) ?? v.store.find((c) => c.id === y)!)).slice(0, n)
  switch (a.kind) {
    case 'respond':
      if (a.options.some((o) => o.id === 'barrel')) return { type: 'answer', opt: 'barrel' }
      if (a.cards.length) return { type: 'answer', cards: cheapest(a.cards, 1) }
      return { type: 'answer', opt: 'take' }
    case 'indians':
    case 'duel':
      if (a.cards.length) return { type: 'answer', cards: cheapest(a.cards, 1) }
      return { type: 'answer', opt: 'take' }
    case 'store': {
      const best = [...v.store].filter((c) => a.cards.includes(c.id)).sort((x, y) => value(v, y) - value(v, x))[0]
      return { type: 'answer', cards: [best.id] }
    }
    case 'dying':
      if (a.cards.length) return { type: 'answer', cards: [a.cards[0]] }
      if (a.options.some((o) => o.id === 'sid')) return { type: 'ability', ability: 'sid', cards: cheapest(v.hand.map((c) => c.id), 2) }
      return { type: 'answer', opt: 'die' }
    case 'discard':
      return { type: 'answer', opt: 'ok', cards: cheapest(a.cards, a.min) }
    case 'kit': {
      const best = [...a.shown].sort((x, y) => value(v, y) - value(v, x)).slice(0, 2)
      return { type: 'answer', opt: 'ok', cards: best.map((c) => c.id) }
    }
    case 'jesse': {
      const t = enemies(v, a.targets).sort((x, y) => y.handCount - x.handCount)[0]
      return t ? { type: 'answer', target: t.seat } : { type: 'answer', opt: 'deck' }
    }
    case 'pedro':
      return { type: 'answer', opt: v.discardTop && value(v, v.discardTop) >= 3.5 ? 'discard' : 'deck' }
  }
  void me
  return { type: 'answer', opt: 'take' }
}

const PRIORITY: CardKey[] = ['wellsfargo', 'stagecoach', 'barrel', 'mustang', 'scope', 'winchester', 'carabine', 'remington', 'schofield', 'volcanic', 'beer', 'store']

function playTurn(v: GameView): Action {
  const me = v.players[v.me]
  const legal = v.legal
  const byKey = (k: CardKey) => legal.filter((l) => l.as === k)
  const cardOf = (l: LegalPlay) => v.hand.find((c) => c.id === l.card)!
  const others = v.players.filter((p) => p.alive && p.seat !== v.me)
  const foes = enemies(v, others.map((p) => p.seat))
  const friends = others.filter((p) => hostility(v, p) < 0)

  // 席德：多的手牌換血
  if (me.character === 'sid' && me.hp < me.maxHp && v.hand.length >= 4) {
    const two = [...v.hand].sort((a, b) => value(v, a) - value(v, b)).slice(0, 2)
    if (two.every((c) => value(v, c) < 3)) return { type: 'ability', ability: 'sid', cards: two.map((c) => c.id) }
  }

  for (const k of PRIORITY) {
    for (const l of byKey(k)) {
      const c = cardOf(l)
      if (CARD_DEFS[k].range) {
        const r = CARD_DEFS[k].range!
        const bangs = v.hand.filter((x) => x.key === 'bang').length
        if (k === 'volcanic' ? v.myRange <= 1 && bangs >= 2 : r > v.myRange) return play(l)
        continue
      }
      if (k === 'beer' && me.hp >= me.maxHp) continue
      void c
      return play(l)
    }
  }
  for (const l of byKey('saloon')) if (me.hp < me.maxHp || friends.some((f) => f.hp < f.maxHp)) return play(l)

  for (const l of byKey('jail')) {
    const t = enemies(v, l.targets!)[0]
    if (t) return play(l, t.seat)
  }
  for (const k of ['panic', 'catbalou'] as const) {
    for (const l of byKey(k)) {
      const t = enemies(v, l.targets!)[0]
      if (t) return play(l, t.seat, pickTargetCard(t))
      // 幫自己人拆掉監獄或炸藥
      const f = l.targets!.map((s) => v.players[s]).find((p) => hostility(v, p) < 0 && p.table.some((c) => c.key === 'jail' || c.key === 'dynamite'))
      if (f) return play(l, f.seat, f.table.find((c) => c.key === 'jail' || c.key === 'dynamite')!.id)
    }
  }
  for (const l of byKey('dynamite')) if (me.role !== 'sheriff' && others.length >= 3 && me.hp >= 3 && rnd() < 0.4) return play(l)

  const foeCount = foes.length
  const friendCount = friends.length
  for (const l of byKey('indians')) if (foeCount >= friendCount) return play(l)
  for (const l of byKey('gatling')) if (foeCount >= friendCount) return play(l)

  const myBangs = v.hand.filter((c) => c.key === 'bang' || (me.character === 'calamity' && c.key === 'missed')).length
  for (const l of byKey('duel')) {
    const t = enemies(v, l.targets!)[0]
    if (t && myBangs >= 1 && t.handCount <= 4) return play(l, t.seat)
  }
  for (const l of byKey('bang')) {
    const t = enemies(v, l.targets!)[0]
    if (t) return play(l, t.seat)
    // 警長一開始沒有線索：偶爾亂槍打鳥
    if (me.role === 'sheriff' && v.turnNo > 1 && rnd() < 0.35) {
      const pick = l.targets!.filter((s) => v.players[s].rep <= 0)
      if (pick.length) return play(l, pick[Math.floor(rnd() * pick.length)])
    }
  }
  return { type: 'end_turn' }
}

function pickTargetCard(t: PublicPlayer): number | 'hand' {
  const order: CardKey[] = ['barrel', 'mustang', 'volcanic', 'winchester', 'carabine', 'remington', 'scope', 'schofield']
  for (const k of order) {
    const c = t.table.find((x) => x.key === k)
    if (c) return c.id
  }
  if (t.handCount > 0) return 'hand'
  const notJail = t.table.find((c) => c.key !== 'jail' && c.key !== 'dynamite')
  return (notJail ?? t.table[0]).id
}

function play(l: LegalPlay, target?: number, targetCard?: number | 'hand'): Action {
  return { type: 'play', card: l.card, as: l.as, target, targetCard }
}

export const charName = (id: string) => CHAR_BY_ID[id]?.name ?? id
