import { CARD_DEFS, CHAR_BY_ID } from '../engine/data'
import { ally, beliefOf, hostility, sloppy } from './mind'
import type { Action, AskView, Card, CardKey, LegalPlay, Suit } from '../engine/types'
import type { GameView, PublicPlayer } from '../engine/view'

// 簡單的啟發式 AI：只看自己的視角（不作弊）

const BASE_VALUE: Partial<Record<CardKey, number>> = {
  missed: 5,
  dodge: 5.2,
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
  hideout: 4,
  scope: 3,
  binocular: 3,
  jail: 3,
  dynamite: 1,
  volcanic: 2.5,
  schofield: 2,
  remington: 2.5,
  carabine: 3,
  winchester: 3.5,
  punch: 3,
  ragtime: 3.5,
  brawl: 3,
  springfield: 3.5,
  tequila: 3,
  whisky: 3.5,
  bible: 4.5,
  hat: 4,
  ironplate: 4,
  sombrero: 4,
  knife: 3,
  derringer: 3.5,
  canteen: 3.5,
  cancan: 3.5,
  conestoga: 3.5,
  pepperbox: 3.5,
  buffalo: 3.5,
  howitzer: 4,
  pony: 4.5,
  ghostcard: 2,
  lemat: 3,
  rattlesnake: 2.5,
  shotgun: 3,
  bounty: 2,
  lastcall: 3.5,
  tomahawk: 3.5,
  tornado: 2.5,
  fanning: 4,
  aim: 3.5,
  bandidos: 3,
  escape: 4,
  poker: 2.5,
  backfire: 5,
}

const CHAR_PREF: Record<string, number> = {
  willy: 9, slab: 8, jourdonnais: 8, bart: 7, kit: 7, lucky: 7, calamity: 7, blackjack: 6, sid: 6,
  paul: 5, rose: 6, jesse: 6, pedro: 5, suzy: 5, vulture: 6, gringo: 5,
  pixie: 8, elena: 8, bill: 6, tequilajoe: 6, greg: 6, herb: 6, molly: 7, apache: 6, sean: 5, belle: 6,
  vera: 6, chuck: 7, pat: 6, jose: 6, doc: 7,
  donbell: 7, dutch: 5, jacky: 6, josh: 5, yto: 5, luzena: 5, raddie: 6, simeon: 6,
  blackflower: 7, colorado: 7, ringer: 6, evelyn: 6, henry: 6, lemonade: 5, mick: 6, tuco: 7,
  bigspencer: 6, flint: 6, gary: 6, greygory: 6, johnpain: 6, lee: 5, teren: 6, youl: 6,
}

const rnd = Math.random

function value(v: GameView, c: Card) {
  let x = BASE_VALUE[c.key] ?? 2
  const me = v.players[v.me]
  if ((c.key === 'beer' || c.key === 'whisky') && me.hp >= me.maxHp) x = 2.5
  const col = CARD_DEFS[c.key].colour
  if (col !== 'brown' && me.table.some((t) => t.key === c.key)) x = 0.5
  if (CARD_DEFS[c.key].range && (CARD_DEFS[c.key].range ?? 0) <= v.myRange) x = 1
  return x + rnd() * 0.3
}

const sheriffSeat = (v: GameView) => v.players.find((p) => p.role === 'sheriff')?.seat ?? -1

function enemies(v: GameView, among: number[]) {
  return among
    .map((s) => v.players[s])
    .filter((p) => hostility(v, p) > 0)
    .sort((a, b) => hostility(v, b) - hostility(v, a) || a.hp - b.hp)
}
const mostHostile = (v: GameView, among: number[]) => [...among].sort((a, b) => hostility(v, v.players[b]) - hostility(v, v.players[a]))[0]

export function decide(v: GameView): Action {
  const d = v.decision
  if (!d) return { type: 'end_turn' }
  if (d.type === 'choose_character') {
    // 避開別人已經選的，在比較好用的幾個角色裡隨機挑一個
    const others = new Set(v.pick?.picks.filter(Boolean) ?? [])
    const free = d.options.filter((c) => !others.has(c))
    const list = (free.length ? free : d.options).map((c) => ({ c, w: (CHAR_PREF[c] ?? 5) + Math.random() * 3 }))
    const best = list.sort((a, b) => b.w - a.w)[0].c
    return { type: 'choose_character', character: best }
  }
  if (d.type === 'ask') return answer(v, d.ask)
  return playTurn(v)
}

function cardById(v: GameView, id: number): Card | undefined {
  return v.hand.find((c) => c.id === id) ?? v.store.find((c) => c.id === id) ?? v.players.flatMap((p) => p.table).find((c) => c.id === id)
}

function answer(v: GameView, a: AskView): Action {
  const me = v.players[v.me]
  const cheapest = (ids: number[], n: number) =>
    [...ids].sort((x, y) => value(v, cardById(v, x) ?? v.hand[0]) - value(v, cardById(v, y) ?? v.hand[0])).slice(0, n)
  const tableIds = new Set(a.table.map((c) => c.id))
  switch (a.kind) {
    case 'respond': {
      if (a.options.some((o) => o.id === 'barrel')) return { type: 'answer', opt: 'barrel' }
      const fromTable = a.cards.filter((id) => tableIds.has(id))
      if (fromTable.length) return { type: 'answer', cards: [fromTable[0]] }
      if (a.cards.length) return { type: 'answer', cards: cheapest(a.cards, 1) }
      return { type: 'answer', opt: 'take' }
    }
    case 'indians':
    case 'duel':
    case 'roulette':
      if (a.cards.length) return { type: 'answer', cards: cheapest(a.cards, 1) }
      return { type: 'answer', opt: 'take' }
    case 'ricochet': {
      if (a.cards.length && rnd() < 0.7) return { type: 'answer', cards: cheapest(a.cards, 1) }
      return { type: 'answer', opt: 'take' }
    }
    case 'store': {
      const best = [...v.store].filter((c) => a.cards.includes(c.id)).sort((x, y) => value(v, y) - value(v, x))[0]
      return { type: 'answer', cards: [best.id] }
    }
    case 'dying':
      if (a.cards.length) return { type: 'answer', cards: [a.cards[0]] }
      if (v.abilities.some((x) => x.id === 'rucksack')) return { type: 'ability', ability: 'rucksack' }
      if (v.abilities.some((x) => x.id === 'sid')) return { type: 'ability', ability: 'sid', cards: cheapest(v.hand.map((c) => c.id), 2) }
      return { type: 'answer', opt: 'die' }
    case 'discard':
      return { type: 'answer', opt: 'ok', cards: cheapest(a.cards, a.min) }
    case 'kit': {
      const best = [...a.shown].sort((x, y) => value(v, y) - value(v, x)).slice(0, a.min)
      return { type: 'answer', opt: 'ok', cards: best.map((c) => c.id) }
    }
    case 'jesse': {
      const t = enemies(v, a.targets).sort((x, y) => y.handCount - x.handCount)[0]
      return t ? { type: 'answer', target: t.seat } : { type: 'answer', opt: 'deck' }
    }
    case 'pedro':
      return { type: 'answer', opt: v.discardTop && value(v, v.discardTop) >= 3.5 ? 'discard' : 'deck' }
    case 'pat': {
      const owner = (c: Card) => v.players.find((p) => p.table.some((x) => x.id === c.id))!
      const best = a.shown.filter((c) => hostility(v, owner(c)) > 0 && value(v, c) >= 4).sort((x, y) => value(v, y) - value(v, x))[0]
      return best ? { type: 'answer', cards: [best.id] } : { type: 'answer', opt: 'deck' }
    }
    case 'vera': {
      const t = [...a.targets].sort((x, y) => (CHAR_PREF[v.players[y].character ?? ''] ?? 5) - (CHAR_PREF[v.players[x].character ?? ''] ?? 5))[0]
      return t != null ? { type: 'answer', target: t } : { type: 'answer', opt: 'skip' }
    }
    case 'brawl': {
      const owner = v.players.find((p) => a.shown.length && p.table.some((c) => c.id === a.shown[0].id))
      if (owner && ally(v, owner)) {
        const bad = a.shown.find((c) => c.key === 'jail' || c.key === 'dynamite')
        if (bad) return { type: 'answer', cards: [bad.id] }
      }
      if (owner && hostility(v, owner) > 0) {
        const good = [...a.shown].filter((c) => c.key !== 'jail' && c.key !== 'dynamite').sort((x, y) => value(v, y) - value(v, x))[0]
        if (good && value(v, good) >= 3.5) return { type: 'answer', cards: [good.id] }
      }
      if (a.options.some((o) => o.id === 'hand')) return { type: 'answer', opt: 'hand' }
      return { type: 'answer', cards: [a.cards[0]] }
    }
    case 'daltons':
      return { type: 'answer', cards: cheapest(a.cards, 1) }
    case 'handcuffs': {
      const score: Record<Suit, number> = { H: 0, D: 0, C: 0, S: 0 }
      for (const c of v.hand) score[c.suit] += value(v, c)
      const best = (Object.keys(score) as Suit[]).sort((x, y) => score[y] - score[x])[0]
      return { type: 'answer', opt: best }
    }
    case 'newidentity':
      return { type: 'answer', opt: me.hp <= 1 ? 'swap' : 'keep' }
    case 'blood': {
      const sh = sheriffSeat(v)
      const friend = a.targets.find((q) => ally(v, v.players[q]) && v.players[q].hp <= 2)
      if (me.hp >= 3 && friend != null && (friend === sh || rnd() < 0.5)) return { type: 'answer', target: friend }
      return { type: 'answer', opt: 'skip' }
    }
    case 'liquor':
      return { type: 'answer', opt: me.hp <= 2 && me.hp < me.maxHp ? 'heal' : 'draw' }
    case 'peyote':
      return { type: 'answer', opt: rnd() < 0.5 ? 'red' : 'black' }
    case 'ranch': {
      const junk = v.hand.filter((c) => value(v, c) < 2.6).map((c) => c.id)
      return { type: 'answer', opt: 'ok', cards: junk }
    }
    case 'dutch': {
      const best = [...a.shown].sort((x, y) => value(v, y) - value(v, x))[0]
      return { type: 'answer', cards: [best.id] }
    }
    case 'evelyn': {
      const t = enemies(v, a.targets)[0]
      return t && rnd() < 0.7 ? { type: 'answer', target: t.seat } : { type: 'answer', opt: 'draw' }
    }
    case 'bandidos': {
      const junk = [...v.hand].sort((x, y) => value(v, x) - value(v, y)).slice(0, a.min)
      if (a.min && (me.hp <= 2 || junk.every((c) => value(v, c) < 3.5))) return { type: 'answer', opt: 'ok', cards: junk.map((c) => c.id) }
      if (a.options.some((o) => o.id === 'escape')) return { type: 'answer', opt: 'escape' }
      if (a.options.some((o) => o.id === 'mick')) return { type: 'answer', opt: 'mick' }
      return me.hp >= 3 || !a.min ? { type: 'answer', opt: 'take' } : { type: 'answer', opt: 'ok', cards: junk.map((c) => c.id) }
    }
    case 'poker':
    case 'tornado':
    case 'youl':
      return { type: 'answer', cards: cheapest(a.cards, 1) }
    case 'pokertake': {
      const best = [...a.shown].sort((x, y) => value(v, y) - value(v, x)).slice(0, a.max)
      return { type: 'answer', opt: 'ok', cards: best.map((c) => c.id) }
    }
    case 'lemonade': {
      const junk = v.hand.filter((c) => value(v, c) < 3).sort((x, y) => value(v, x) - value(v, y))[0]
      return junk ? { type: 'answer', cards: [junk.id] } : { type: 'answer', opt: 'skip' }
    }
  }
  return { type: 'answer', opt: 'take' }
}

const PRIORITY: CardKey[] = [
  'wellsfargo', 'stagecoach', 'pony',
  'barrel', 'mustang', 'hideout', 'scope', 'binocular',
  'winchester', 'carabine', 'remington', 'schofield', 'volcanic', 'shotgun', 'lemat',
  'bible', 'hat', 'ironplate', 'sombrero', 'knife', 'derringer', 'canteen', 'cancan', 'conestoga', 'pepperbox', 'buffalo', 'howitzer',
  'beer', 'store',
]

function playTurn(v: GameView): Action {
  const me = v.players[v.me]
  // 簡單難度偶爾會忘了出牌就結束回合
  if (sloppy(v) && rnd() < 0.5 && v.must == null) return { type: 'end_turn' }
  const legal = v.legal
  const byAs = (k: string) => legal.filter((l) => l.as === k && l.source !== 'shop')
  const cardOf = (l: LegalPlay) => (l.source === 'table' ? me.table : v.hand).find((c) => c.id === l.card)!
  const others = v.players.filter((p) => p.alive && p.seat !== v.me)
  const foes = enemies(v, others.map((p) => p.seat))
  const friends = others.filter((p) => ally(v, p))
  const hurt = me.hp < me.maxHp

  // 西部法則：必須先打出亮出的牌
  if (v.must != null) {
    const forced = legal.filter((l) => l.card === v.must)
    if (forced.length) {
      const l = forced[0]
      const t = l.targets ? (enemies(v, l.targets)[0]?.seat ?? mostHostile(v, l.targets)) : undefined
      return play(v, l, t, t != null && l.pickCard ? pickTargetCard(v.players[t], !!l.tableOnly) : undefined)
    }
  }

  // 角色能力
  for (const ab of v.abilities) {
    if (ab.id === 'sid' && hurt && v.hand.length >= 4) {
      const two = [...v.hand].sort((a, b) => value(v, a) - value(v, b)).slice(0, 2)
      if (two.every((c) => value(v, c) < 3)) return { type: 'ability', ability: 'sid', cards: two.map((c) => c.id) }
    }
    if (ab.id === 'chuck' && me.hp >= 3 && v.hand.length <= 3 && rnd() < 0.6) return { type: 'ability', ability: 'chuck' }
    if (ab.id === 'jose') {
      const junk = v.hand.filter((c) => ab.cardIds!.includes(c.id) && value(v, c) < 2)
      if (junk.length) return { type: 'ability', ability: 'jose', cards: [junk[0].id] }
    }
    if (ab.id === 'rucksack' && me.maxHp - me.hp >= 2) return { type: 'ability', ability: 'rucksack' }
    if (ab.id === 'jacky') {
      const t = enemies(v, ab.targets!)[0]
      if (t) return { type: 'ability', ability: 'jacky', target: t.seat }
    }
    if ((ab.id === 'raddie' || ab.id === 'goldpan') && v.hand.length <= 3 && v.myNuggets >= 3) return { type: 'ability', ability: ab.id }
    if (ab.id === 'josh' && v.myNuggets >= 4 && rnd() < 0.5) return { type: 'ability', ability: 'josh' }
    if (ab.id === 'flint') {
      const t = enemies(v, ab.targets!).find((p) => p.handCount >= 3)
      const give = [...v.hand].sort((a, b) => value(v, a) - value(v, b))[0]
      if (t && give && value(v, give) < 3) return { type: 'ability', ability: 'flint', cards: [give.id], target: t.seat }
    }
    if (ab.id === 'lee' && ab.cardIds!.length >= 2 && rnd() < 0.5) return { type: 'ability', ability: 'lee', cards: [ab.cardIds![0]] }
    if (ab.id === 'doc' && v.hand.length >= 4) {
      const t = enemies(v, ab.targets!)[0]
      if (t) {
        const two = [...v.hand].sort((a, b) => value(v, a) - value(v, b)).slice(0, 2)
        return { type: 'ability', ability: 'doc', cards: two.map((c) => c.id), target: t.seat }
      }
    }
  }

  // 淘金熱商店：先買有用的
  for (const l of legal.filter((x) => x.source === 'shop')) {
    const key = l.as
    if (key === 'golddrop') continue
    if (['pickaxe', 'horseshoe', 'boots', 'luckycharm', 'rucksack', 'gunbelt', 'calumet', 'goldpan'].includes(key) && rnd() < 0.8) return play(v, l)
    if (key === 'unionpacific') return play(v, l)
    if (key === 'goldrushcard' && me.hp <= me.maxHp - 2) return play(v, l)
    if (key === 'rum' && me.maxHp - me.hp >= 2) return play(v, l)
    if (key === 'shotglass') {
      const t = l.targets!.map((q) => v.players[q]).filter((p) => ally(v, p)).sort((a, b) => a.hp - b.hp)[0]
      if (t) return play(v, l, t.seat)
    }
    if ((key === 'wanted' || key === 'bang' || key === 'duel') && l.targets) {
      const t = enemies(v, l.targets)[0]
      if (t) return play(v, l, t.seat)
    }
    if ((key === 'catbalou' || key === 'panic') && l.targets) {
      const t = enemies(v, l.targets)[0]
      if (t) return play(v, l, t.seat, pickTargetCard(t, false))
    }
  }
  for (const l of byAs('nugget')) if (!hurt) return play(v, l)

  // 幽谷
  for (const l of byAs('lastcall')) if (hurt) return play(v, l)
  for (const k of ['rattlesnake', 'bounty'] as const)
    for (const l of byAs(k)) {
      const t = enemies(v, l.targets!)[0]
      if (t) return play(v, l, t.seat)
    }
  for (const l of byAs('ghostcard')) {
    const f = l.targets!.find((q) => v.players[q].role && ally(v, v.players[q]))
    if (f != null) return play(v, l, f)
  }
  for (const k of ['tomahawk', 'flower', 'aim'] as const)
    for (const l of byAs(k)) {
      const t = enemies(v, l.targets!)[0]
      if (t) return play(v, l, t.seat)
    }
  for (const l of byAs('fanning')) {
    const t = enemies(v, l.targets!)[0]
    if (t) {
      return play(v, l, t.seat)
    }
  }

  for (const k of PRIORITY) {
    for (const l of byAs(k)) {
      const def = CARD_DEFS[k]
      if (def.range) {
        const bangs = v.hand.filter((x) => x.key === 'bang').length
        if (k === 'volcanic' ? v.myRange <= 1 && bangs >= 2 : k === 'shotgun' || k === 'lemat' ? v.myRange <= 1 && !me.table.some((c) => CARD_DEFS[c.key].range) : def.range > v.myRange) return play(v, l)
        continue
      }
      if ((k === 'beer' || k === 'canteen') && !hurt) continue
      // 場上的攻擊綠牌：有敵人才用
      if (l.source === 'table' && l.targets) {
        const t = enemies(v, l.targets)[0]
        if (t) return play(v, l, t.seat, l.pickCard ? pickTargetCard(t, false) : undefined)
        continue
      }
      if (l.source === 'table' && k === 'howitzer' && foes.length < friends.length) continue
      void cardOf
      return play(v, l)
    }
  }
  for (const l of byAs('whisky')) if (me.maxHp - me.hp >= 1) return play(v, l)
  for (const l of byAs('tequila')) {
    const t = l.targets!.map((q) => v.players[q]).filter((p) => ally(v, p)).sort((a, b) => a.hp - b.hp)[0]
    if (t) return play(v, l, t.seat)
  }
  for (const l of byAs('saloon')) if (hurt || friends.some((f) => f.hp < f.maxHp)) return play(v, l)

  for (const l of byAs('jail')) {
    const t = enemies(v, l.targets!)[0]
    if (t) return play(v, l, t.seat)
  }
  for (const k of ['panic', 'catbalou', 'ragtime'] as const) {
    for (const l of byAs(k)) {
      const t = enemies(v, l.targets!)[0]
      if (t) return play(v, l, t.seat, pickTargetCard(t, false))
      // 幫自己人拆掉監獄或炸藥
      const f = l.targets!.map((s) => v.players[s]).find((p) => ally(v, p) && p.table.some((c) => c.key === 'jail' || c.key === 'dynamite'))
      if (f) return play(v, l, f.seat, f.table.find((c) => c.key === 'jail' || c.key === 'dynamite')!.id)
    }
  }
  for (const l of byAs('dynamite')) if (me.role !== 'sheriff' && others.length >= 3 && me.hp >= 3 && rnd() < 0.4) return play(v, l)

  const foeCount = foes.length
  const friendCount = friends.length
  for (const k of ['indians', 'gatling', 'brawl', 'bandidos', 'poker'] as const) for (const l of byAs(k)) if (foeCount >= friendCount && l.source !== 'shop') return play(v, l)
  for (const l of byAs('tornado')) if (v.hand.length <= 2) return play(v, l)

  const myBangs = v.hand.filter((c) => c.key === 'bang' || (me.character === 'calamity' && c.key === 'missed')).length
  for (const l of byAs('duel')) {
    const t = enemies(v, l.targets!)[0]
    if (t && myBangs >= 1 && t.handCount <= 4) return play(v, l, t.seat)
  }
  for (const k of ['punch', 'springfield', 'sniper'] as const) {
    for (const l of byAs(k)) {
      const t = enemies(v, l.targets!)[0]
      if (t && (k !== 'sniper' || t.handCount >= 2)) return play(v, l, t.seat)
    }
  }
  for (const l of byAs('bang')) {
    const t = enemies(v, l.targets!)[0]
    if (t) return play(v, l, t.seat)
    // 警長試探：沒有把握的對象時，偶爾對最可疑的人開一槍
    if (me.role === 'sheriff' && v.turnNo > 1 && rnd() < 0.25) {
      const pick = [...l.targets!].sort((a, b) => (beliefOf(v, b).outlaw ?? 0) - (beliefOf(v, a).outlaw ?? 0))[0]
      if (pick != null && (beliefOf(v, pick).outlaw ?? 0) >= 0.45) return play(v, l, pick)
    }
  }
  for (const l of byAs('ricochet')) {
    const t = enemies(v, l.targets!)[0]
    if (t && t.table.some((c) => value(v, c) >= 4)) return play(v, l, t.seat, pickTargetCard(t, true))
  }
  return { type: 'end_turn' }
}

function pickTargetCard(t: PublicPlayer, tableOnly: boolean): number | 'hand' {
  const order: CardKey[] = ['barrel', 'mustang', 'hideout', 'volcanic', 'winchester', 'carabine', 'remington', 'scope', 'binocular', 'schofield', 'bible', 'hat', 'ironplate', 'sombrero']
  for (const k of order) {
    const c = t.table.find((x) => x.key === k)
    if (c) return c.id
  }
  if (!tableOnly && t.handCount > 0) return 'hand'
  const notJail = t.table.find((c) => c.key !== 'jail' && c.key !== 'dynamite')
  return (notJail ?? t.table[0]).id
}

function play(v: GameView, l: LegalPlay, target?: number, targetCard?: number | 'hand'): Action {
  let extra: number[] | undefined
  if (l.cost) {
    const pool = v.hand.filter((c) => c.id !== l.card && (!l.costKind || c.key === 'bang' || (l.costKind === 'bang' && c.key === 'missed' && v.players[v.me].character === 'calamity')))
    extra = [...pool].sort((a, b) => value(v, a) - value(v, b)).slice(0, l.cost).map((c) => c.id)
  }
  // 連開這類要第二個目標的：挑最有敵意的那個（不管從哪條路徑打出都補上）
  const opts = target != null ? (l.second?.[target] ?? []) : []
  const target2 = opts.length ? [...opts].sort((a, b) => hostility(v, v.players[b]) - hostility(v, v.players[a]))[0] : undefined
  return { type: 'play', card: l.card, as: l.as, target, targetCard, extra, target2 }
}

export const charName = (id: string) => CHAR_BY_ID[id]?.name ?? id
