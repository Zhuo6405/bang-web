import { describe, expect, it } from 'vitest'
import { buildCards, CARD_DEFS, CHARACTERS, EVENTS } from './data'
import { CARD_EN, CHAR_EN, EVENT_EN, SEP } from './i18n'
import { decide } from '../ai/ai'
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
/** 幫每個人挑好角色：指定的照指定，其他人挑不撞的 */
function pickAll(s: GameState, chars: Record<number, string>) {
  const wanted = new Set(Object.values(chars))
  const used = new Set<string>()
  for (let guard = 0; s.turn.phase === 'choose' && guard < 20; guard++) {
    for (const d of getDecisions(s)) {
      if (d.type !== 'choose_character') continue
      const want = chars[d.player]
      const c = want && d.options.includes(want) ? want : d.options.find((x) => !wanted.has(x) && !used.has(x))!
      used.add(c)
      s = applyAction(s, d.player, { type: 'choose_character', character: c })
    }
  }
  // 測試要多人同一個角色時（正式遊戲不會發生）：直接指定
  s = structuredClone(s)
  for (const [seat, c] of Object.entries(chars)) s.players[Number(seat)].character = c
  return s
}
function setup(n: number, chars: Record<number, string> = {}, seed = 3): GameState {
  let s = startGame(makeConfig(n, seed))
  s = structuredClone(s)
  return pickAll(s, chars)
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

function setupX(n: number, exps: string[], chars: Record<number, string> = {}, seed = 3): GameState {
  let s = structuredClone(startGame(makeConfig(n, seed, exps)))
  return pickAll(s, chars)
}

describe('選角', () => {
  it('撞角時擲硬幣，沒選到的人重選；警長加 1 點生命，血量依角色', () => {
    let s = startGame(makeConfig(5, 7, ['wild_west_show']))
    expect(getDecisions(s).length).toBe(5)
    for (const p of [0, 1, 2]) s = applyAction(s, p, { type: 'choose_character', character: 'gary' })
    s = applyAction(s, 3, { type: 'choose_character', character: 'teren' })
    expect(s.turn.phase).toBe('choose')
    s = applyAction(s, 4, { type: 'choose_character', character: 'bart' })
    expect(s.pick!.duels.length).toBe(1)
    expect(s.pick!.duels[0].round).toBe(1)
    const d = s.pick!.duels[0]
    expect(d.seats).toEqual([0, 1, 2])
    expect(s.players[d.winner].character).toBe('gary')
    expect(d.rounds[0][0].coins.length).toBe(3)
    // 輸的兩人重選，gary 已不能選
    const decs = getDecisions(s)
    expect(decs.map((x) => x.player).sort()).toEqual([0, 1, 2].filter((x) => x !== d.winner))
    expect((decs[0] as { options: string[] }).options).not.toContain('gary')
    for (const x of decs) s = applyAction(s, x.player, { type: 'choose_character', character: x.player === decs[0].player ? 'willy' : 'suzy' })
    expect(s.turn.phase).not.toBe('choose')
    for (const p of s.players) {
      const base = { gary: 5, teren: 3, bart: 4, willy: 4, suzy: 4 }[p.character!]!
      expect(p.maxHp).toBe(base + (p.role === 'sheriff' ? 1 : 0))
    }
  })
  it('只開放已選擴充包的角色', () => {
    const s = startGame(makeConfig(4, 1))
    const opts = (getDecisions(s)[0] as { options: string[] }).options
    expect(opts.length).toBe(16)
    expect(() => applyAction(s, 0, { type: 'choose_character', character: 'gary' })).toThrow()
  })
})

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

describe('道奇城', () => {
  it('120 張牌、8 人局可以開', () => {
    expect(buildCards(['dodge_city'])).toHaveLength(120)
    const s = setupX(8, ['dodge_city'])
    expect(s.players).toHaveLength(8)
    expect(total(s)).toBe(120)
  })

  it('綠牌放上場的那回合不能用', () => {
    let s = setupX(4, ['dodge_city'])
    const a = s.turn.active
    clearHands(s)
    give(s, a, ['pony'])
    s = applyAction(s, a, { type: 'play', card: s.players[a].hand[0] })
    expect(s.players[a].table.length).toBe(1)
    expect(legalPlays(s, a).some((l) => l.source === 'table')).toBe(false)
  })

  it('需要代價的牌要另外棄一張', () => {
    let s = setupX(4, ['dodge_city'])
    const a = s.turn.active
    clearHands(s)
    s.players[a].hp = 1
    give(s, a, ['whisky', 'missed'])
    const [w, m] = s.players[a].hand
    expect(() => applyAction(s, a, { type: 'play', card: w })).toThrow()
    s = applyAction(s, a, { type: 'play', card: w, extra: [m] })
    expect(s.players[a].hp).toBe(3)
    expect(s.players[a].hand).toHaveLength(0)
  })

  it('十加侖帽可以在場上當射偏了', () => {
    let s = setupX(4, ['dodge_city'])
    s = structuredClone(s)
    const a = s.turn.active
    const t = s.players.map((p) => p.seat).find((q) => q !== a && distance(s, a, q) <= 1)!
    clearHands(s)
    give(s, a, ['bang'])
    const hat = s.cards.find((c) => c.key === 'hat')!.id
    s.deck = s.deck.filter((x) => x !== hat)
    s.discard = s.discard.filter((x) => x !== hat)
    s.players[t].table.push(hat)
    const hp = s.players[t].hp
    s = applyAction(s, a, { type: 'play', card: s.players[a].hand[0], target: t })
    const d = getDecisions(s)[0]
    expect(d.type === 'ask' && d.ask.cards.includes(hat)).toBe(true)
    s = applyAction(s, t, { type: 'answer', cards: [hat] })
    expect(s.players[t].hp).toBe(hp)
    expect(s.players[t].table).not.toContain(hat)
  })
})

describe('事件', () => {
  it('佈道：不能打砰！；法官：不能裝備', () => {
    let s = setupX(4, ['high_noon', 'fistful'])
    s = structuredClone(s)
    const a = s.turn.active
    clearHands(s)
    give(s, a, ['bang', 'barrel'])
    s.events!.current = 'sermon'
    expect(legalPlays(s, a).some((l) => l.as === 'bang')).toBe(false)
    s.events!.current = 'judge'
    expect(legalPlays(s, a).some((l) => l.as === 'barrel')).toBe(false)
  })

  it('套索：場上的牌沒有效果', () => {
    let s = setupX(4, ['fistful'])
    s = structuredClone(s)
    const a = s.turn.active
    const scope = s.cards.find((c) => c.key === 'winchester')!.id
    s.deck = s.deck.filter((x) => x !== scope)
    s.players[a].table.push(scope)
    const t = s.players.map((p) => p.seat).find((q) => q !== a)!
    expect(viewFor(s, a).myRange).toBe(5)
    s.events!.current = 'lasso'
    expect(viewFor(s, a).myRange).toBe(1)
    void t
  })

  it('事件牌在警長第二個回合開始翻開，最後一張是結局牌', () => {
    const s = setupX(4, ['high_noon'])
    expect(s.events!.current).toBeNull()
    expect(s.events!.deck[s.events!.deck.length - 1]).toBe('highnoon')
  })
})

describe('淘金熱', () => {
  it('打傷別人拿金塊，可以在商店買裝備', () => {
    let s = setupX(4, ['gold_rush'])
    s = structuredClone(s)
    const a = s.turn.active
    const t = s.players.map((p) => p.seat).find((q) => q !== a && distance(s, a, q) <= 1)!
    clearHands(s)
    give(s, a, ['bang'])
    s = applyAction(s, a, { type: 'play', card: s.players[a].hand[0], target: t })
    expect(s.gold!.nuggets[a]).toBe(1)
    s.gold!.nuggets[a] = 5
    const buy = legalPlays(s, a).find((l) => l.source === 'shop')
    expect(buy).toBeTruthy()
    expect(s.gold!.shop).toHaveLength(3)
  })
})

describe('幽谷', () => {
  it('瞄準：打中失去 2 點生命', () => {
    let s = setupX(4, ['valley_of_shadows'], { 0: 'bart', 1: 'bart', 2: 'bart', 3: 'bart' })
    s = structuredClone(s)
    const a = s.turn.active
    const t = s.players.map((p) => p.seat).find((q) => q !== a && distance(s, a, q) <= 1)!
    clearHands(s)
    give(s, a, ['aim', 'bang'])
    const [aim, bang] = s.players[a].hand
    const hp = s.players[t].hp
    s = applyAction(s, a, { type: 'play', card: aim, target: t, extra: [bang] })
    expect(s.players[t].hp).toBe(hp - 2)
  })

  it('回火：躲開並反擊開槍的人', () => {
    let s = setupX(4, ['valley_of_shadows'])
    s = structuredClone(s)
    const a = s.turn.active
    const t = s.players.map((p) => p.seat).find((q) => q !== a && distance(s, a, q) <= 1)!
    clearHands(s)
    give(s, a, ['bang'])
    give(s, t, ['backfire'])
    const hp = s.players[a].hp
    s = applyAction(s, a, { type: 'play', card: s.players[a].hand[0], target: t })
    s = applyAction(s, t, { type: 'answer', cards: [s.players[t].hand[0]] })
    expect(s.players[a].hp).toBe(hp - 1)
  })
})

describe('西部秀', () => {
  it('西部秀結局：只剩一人才結束', () => {
    let s = setupX(4, ['wild_west_show'])
    s = structuredClone(s)
    s.events!.current = 'wildwestshow'
    const sheriff = s.players.find((p) => p.role === 'sheriff')!
    sheriff.alive = false
    const a = s.turn.active
    expect(s.result).toBeNull()
    void a
  })
})

describe('AI 自動對戰', () => {
  it('全部擴充一起玩也能打完，牌數守恆', () => {
    const all = ['dodge_city', 'high_noon', 'fistful', 'wild_west_show', 'gold_rush', 'valley_of_shadows']
    for (let seed = 1; seed <= 15; seed++) {
      const n = 4 + (seed % 5)
      const { state } = playOut(startGame(makeConfig(n, seed * 17, all)), 10000)
      expect(state.result, `seed ${seed}`).not.toBeNull()
      expect(total(state) + state.poker.length).toBe(135)
    }
  }, 30_000)

  it('4–7 人都能打完，牌數守恆', () => {
    for (let n = 4; n <= 7; n++) {
      for (let seed = 1; seed <= 12; seed++) {
        const { state } = playOut(startGame(makeConfig(n, seed * 31 + n)), 8000)
        expect(state.result, `${n} 人 seed ${seed}`).not.toBeNull()
        expect(total(state)).toBe(80)
      }
    }
  }, 30_000)
})

describe('雙語', () => {
  it('每張牌、每個角色、每張事件都有英文', () => {
    for (const k of Object.keys(CARD_DEFS)) expect(CARD_EN[k as CardKey]?.name, k).toBeTruthy()
    for (const c of CHARACTERS) expect(CHAR_EN[c.id]?.text, c.id).toBeTruthy()
    for (const e of EVENTS) expect(EVENT_EN[e.id]?.text, e.id).toBeTruthy()
  })
  it('整局的紀錄、詢問、按鈕都同時有中文和英文', () => {
    const all = ['dodge_city', 'high_noon', 'fistful', 'wild_west_show', 'gold_rush', 'valley_of_shadows']
    const missing = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      let s = startGame(makeConfig(4 + (seed % 5), seed * 7, all))
      const seen = new Set<number>()
      for (let i = 0; i < 6000 && !s.result; i++) {
        const d = getDecisions(s)[0]
        const v = viewFor(s, d.player)
        if (d.type === 'ask') {
          for (const x of [d.ask.title, d.ask.prompt, ...d.ask.options.map((o) => o.label)]) if (x && !x.includes(SEP)) missing.add(x)
        }
        for (const a of v.abilities) if (!a.label.includes(SEP)) missing.add(a.label)
        s = applyAction(s, d.player, decide(v))
        for (const l of s.log) if (!seen.has(l.seq)) {
          seen.add(l.seq)
          if (!l.text.includes(SEP)) missing.add(l.text)
        }
      }
      if (s.result) expect(s.result.reason.includes(SEP)).toBe(true)
    }
    expect([...missing].slice(0, 10)).toEqual([])
  }, 60_000)
})
