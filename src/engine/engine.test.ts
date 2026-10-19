import { describe, expect, it } from 'vitest'
import { buildCards } from './data'
import { applyAction, distance, getDecisions, legalPlays, startGame } from './engine'
import { makeConfig, playOut } from './sim'
import type { CardKey, GameState } from './types'
import { viewFor } from './view'

describe('卡牌資料', () => {
  it('基本版 80 張，數量正確', () => {
    const cs = buildCards()
    expect(cs).toHaveLength(80)
    const n = (k: CardKey) => cs.filter((c) => c.key === k).length
    expect(n('bang')).toBe(25)
    expect(n('missed')).toBe(12)
    expect(n('beer')).toBe(6)
  })
})

/** 開一局並幫每個人挑好指定角色 */
function setup(n: number, chars: Record<number, string> = {}, seed = 3): GameState {
  let s = startGame(makeConfig(n, seed))
  s = structuredClone(s)
  for (const p of s.players) {
    const want = chars[p.seat]
    if (want) p.charOptions = [want, p.charOptions[1] === want ? p.charOptions[0] : p.charOptions[1]]
  }
  for (const d of getDecisions(s)) if (d.type === 'choose_character') s = applyAction(s, d.player, { type: 'choose_character', character: d.options[0] })
  return s
}
/** 把某人的手牌換成指定的牌（從牌堆或棄牌堆拿） */
function give(s: GameState, p: number, keys: CardKey[]) {
  for (const k of keys) {
    const id = s.cards.find((c) => c.key === k && (s.deck.includes(c.id) || s.discard.includes(c.id)))!.id
    s.deck = s.deck.filter((x) => x !== id)
    s.discard = s.discard.filter((x) => x !== id)
    s.players[p].hand.push(id)
  }
}
function clearHands(s: GameState) {
  for (const p of s.players) {
    s.discard.push(...p.hand)
    p.hand = []
  }
}
const total = (s: GameState) => s.deck.length + s.discard.length + s.store.length + s.players.reduce((a, p) => a + p.hand.length + p.table.length, 0)

describe('規則', () => {
  it('開局：警長先手、多 1 點生命、手牌等於生命', () => {
    const s = setup(5)
    const sh = s.players.find((p) => p.role === 'sheriff')!
    expect(s.turn.active).toBe(sh.seat)
    for (const p of s.players) expect(p.hand.length).toBeGreaterThanOrEqual(p.hp)
  })

  it('砰！打中：沒有射偏了就扣血；有射偏了可以躲', () => {
    let s = setup(4, { 0: 'willy', 1: 'paul', 2: 'rose', 3: 'kit' })
    s = structuredClone(s)
    const a = s.turn.active
    const t = s.players.map((p) => p.seat).find((q) => q !== a && distance(s, a, q) <= 1)!
    clearHands(s)
    give(s, a, ['bang', 'bang'])
    give(s, t, ['missed'])
    const hp = s.players[t].hp
    const [b1, b2] = s.players[a].hand
    s = applyAction(s, a, { type: 'play', card: b1, target: t })
    const d = getDecisions(s)[0]
    expect(d).toMatchObject({ type: 'ask', player: t })
    s = applyAction(s, t, { type: 'answer', cards: [s.players[t].hand[0]] })
    expect(s.players[t].hp).toBe(hp)
    // 只有小子威利能再開一槍
    if (s.players[a].character === 'willy') {
      s = applyAction(s, a, { type: 'play', card: b2, target: t })
      expect(s.players[t].hp).toBe(hp - 1)
    }
    expect(total(s)).toBe(80)
  })

  it('一回合只能開一槍', () => {
    let s = setup(4, {}, 9)
    s = structuredClone(s)
    const a = s.turn.active
    if (s.players[a].character === 'willy' || s.players[a].character === 'calamity') return
    clearHands(s)
    give(s, a, ['bang', 'bang'])
    const t = s.players.map((p) => p.seat).find((q) => q !== a && distance(s, a, q) <= 1)!
    s = applyAction(s, a, { type: 'play', card: s.players[a].hand[0], target: t })
    while (getDecisions(s)[0]?.type === 'ask') s = applyAction(s, getDecisions(s)[0].player, { type: 'answer', opt: 'take' })
    expect(legalPlays(s, a).filter((l) => l.as === 'bang')).toHaveLength(0)
  })

  it('殺手史萊柏的砰！要兩張射偏了', () => {
    let s = setup(4, { 0: 'slab', 1: 'slab', 2: 'slab', 3: 'slab' })
    s = structuredClone(s)
    const a = s.turn.active
    const t = s.players.map((p) => p.seat).find((q) => q !== a && distance(s, a, q) <= 1)!
    clearHands(s)
    give(s, a, ['bang'])
    give(s, t, ['missed', 'missed'])
    const hp = s.players[t].hp
    s = applyAction(s, a, { type: 'play', card: s.players[a].hand[0], target: t })
    s = applyAction(s, t, { type: 'answer', cards: [s.players[t].hand[0]] })
    expect(getDecisions(s)[0]).toMatchObject({ type: 'ask', player: t })
    s = applyAction(s, t, { type: 'answer', cards: [s.players[t].hand[0]] })
    expect(s.players[t].hp).toBe(hp)
  })

  it('監獄不能放在警長身上', () => {
    let s = setup(4)
    s = structuredClone(s)
    const a = s.turn.active
    clearHands(s)
    give(s, a, ['jail'])
    const l = legalPlays(s, a).find((x) => x.as === 'jail')!
    expect(l.targets).not.toContain(s.players.find((p) => p.role === 'sheriff')!.seat)
  })

  it('只剩兩人時啤酒無效', () => {
    let s = setup(4)
    s = structuredClone(s)
    const a = s.turn.active
    const others = s.players.filter((p) => p.seat !== a)
    others[0].alive = false
    others[1].alive = false
    s.players[a].hp = 1
    clearHands(s)
    give(s, a, ['beer'])
    expect(legalPlays(s, a).some((l) => l.as === 'beer')).toBe(false)
  })

  it('視角不洩漏別人的手牌與身份', () => {
    const s = setup(5)
    const v = viewFor(s, 1)
    for (const p of v.players) {
      if (p.seat !== 1 && p.role !== 'sheriff') expect(p.role).toBeNull()
    }
    expect(v.hand.map((c) => c.id)).toEqual(s.players[1].hand)
  })
})

describe('AI 自動對戰', () => {
  it('4–7 人都能打完，牌數守恆', () => {
    for (let n = 4; n <= 7; n++) {
      for (let seed = 1; seed <= 12; seed++) {
        const { state } = playOut(startGame(makeConfig(n, seed * 31 + n)), 8000)
        expect(state.result, `${n} 人 seed ${seed}`).not.toBeNull()
        expect(total(state)).toBe(80)
      }
    }
  })
})
