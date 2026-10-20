import { distance, evOn, getDecisions, goldKey, legalAbilities, legalPlays, weaponRange } from './engine'
import { reputation } from './reputation'
import type { Card, CoinDuel, Decision, Fx, GameResult, GameState, GoldKey, LegalAbility, LegalPlay, LogEntry, Role, Suit } from './types'

export interface PublicPlayer {
  seat: number
  name: string
  isAI: boolean
  alive: boolean
  hp: number
  maxHp: number
  handCount: number
  table: Card[]
  character: string | null
  /** 自己、警長、死者，或遊戲結束後才看得到 */
  role: Role | null
  /** 從你的位置看過去的距離 */
  dist: number
  /** 公開的立場分數：> 0 像警長方，< 0 像歹徒（只根據大家看得到的行為） */
  rep: number
  ghost: boolean
  nuggets: number
  /** 淘金熱的黑框裝備 */
  gold: { uid: number; key: GoldKey }[]
  /** 薩卡加維亞事件：手牌公開 */
  openHand: Card[] | null
}

export interface GameView {
  me: number
  phase: GameState['turn']['phase']
  active: number
  turnNo: number
  bangsUsed: number
  myRange: number
  players: PublicPlayer[]
  hand: Card[]
  myCharOptions: string[]
  /** 選角階段：大家的選擇（公開）、已定案的角色、擲硬幣結果 */
  pick: { pool: string[]; picks: (string | null)[]; locked: Record<string, number>; round: number; duels: CoinDuel[] } | null
  deckCount: number
  discardTop: Card | null
  store: Card[]
  decision: Decision | null
  /** 現在有人要做決定（不一定是你） */
  waitingFor: number[]
  legal: LegalPlay[]
  abilities: LegalAbility[]
  /** 西部法則：必須先打出的牌 */
  must: number | null
  /** 手銬：這回合宣告的花色 */
  suit: Suit | null
  /** 目前的事件 */
  event: string | null
  eventsLeft: number
  dir: 1 | -1
  /** 還不能用的綠牌（這回合才放上場） */
  fresh: number[]
  /** 淘金熱 */
  goldOn: boolean
  shop: { uid: number; key: GoldKey }[]
  goldDeck: number
  myNuggets: number
  /** 喬許抽到、可以免費使用的裝備 */
  myFree: { uid: number; key: GoldKey } | null
  log: LogEntry[]
  fx: Fx[]
  result: GameResult | null
}

export function viewFor(s: GameState, me: number): GameView {
  const over = !!s.result
  const decs = getDecisions(s)
  const mine = decs.find((d) => d.player === me) ?? null
  const rep = reputation(s)
  return {
    me,
    phase: s.turn.phase,
    active: s.turn.active,
    turnNo: s.turn.no,
    bangsUsed: s.turn.bangs,
    myRange: s.players[me].character ? weaponRange(s, me) : 1,
    players: s.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      isAI: p.isAI,
      alive: p.alive,
      hp: p.hp,
      maxHp: p.maxHp,
      handCount: p.hand.length,
      table: p.table.map((id) => s.cards[id]),
      character: p.character,
      role: over || p.seat === me || p.role === 'sheriff' || !p.alive || p.ghost ? p.role : null,
      dist: p.seat === me || !p.alive || !s.players[me].alive || s.turn.phase === 'choose' ? 0 : distance(s, me, p.seat),
      rep: rep[p.seat],
      ghost: !!p.ghost,
      nuggets: s.gold?.nuggets[p.seat] ?? 0,
      gold: (s.gold?.equip[p.seat] ?? []).map((uid) => ({ uid, key: goldKey(s, uid) })),
      openHand: evOn(s, 'sacagaway') && p.seat !== me ? p.hand.map((id) => s.cards[id]) : null,
    })),
    hand: s.players[me].hand.map((id) => s.cards[id]),
    myCharOptions: s.players[me].charOptions,
    pick:
      s.pick
        ? {
            pool: s.pick.pool,
            picks: s.pick.picks,
            locked: Object.fromEntries(s.players.filter((p) => p.character).map((p) => [p.character!, p.seat])),
            round: s.pick.round,
            duels: s.pick.duels,
          }
        : null,
    deckCount: s.deck.length,
    discardTop: s.discard.length ? s.cards[s.discard[s.discard.length - 1]] : null,
    store: s.store.map((id) => s.cards[id]),
    decision: mine,
    waitingFor: decs.map((d) => d.player),
    legal: mine?.type === 'play' ? legalPlays(s, me) : [],
    abilities: mine ? legalAbilities(s, me) : [],
    must: s.turn.must ?? null,
    suit: s.turn.suit ?? null,
    event: s.events?.current ?? null,
    eventsLeft: s.events?.deck.length ?? 0,
    dir: s.dir,
    fresh: Object.entries(s.greenAt)
      .filter(([, t]) => t === s.turn.no)
      .map(([id]) => Number(id)),
    goldOn: !!s.gold,
    shop: (s.gold?.shop ?? []).map((uid) => ({ uid, key: goldKey(s, uid) })),
    goldDeck: s.gold?.deck.length ?? 0,
    myNuggets: s.gold?.nuggets[me] ?? 0,
    myFree: s.gold?.free[me] != null ? { uid: s.gold.free[me]!, key: goldKey(s, s.gold.free[me]!) } : null,
    // 結束後給完整紀錄，讓大家回頭看
    log: s.result ? s.log : s.log.slice(-120),
    fx: s.fx,
    result: s.result,
  }
}
