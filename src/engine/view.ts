import { distance, getDecisions, legalPlays, weaponRange } from './engine'
import type { Card, Decision, Fx, GameResult, GameState, LegalPlay, LogEntry, Role } from './types'

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
  rep: number
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
  deckCount: number
  discardTop: Card | null
  store: Card[]
  decision: Decision | null
  /** 現在有人要做決定（不一定是你） */
  waitingFor: number[]
  legal: LegalPlay[]
  log: LogEntry[]
  fx: Fx[]
  result: GameResult | null
}

export function viewFor(s: GameState, me: number): GameView {
  const over = !!s.result
  const decs = getDecisions(s)
  const mine = decs.find((d) => d.player === me) ?? null
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
      role: over || p.seat === me || p.role === 'sheriff' || !p.alive ? p.role : null,
      dist: p.seat === me || !p.alive || !s.players[me].alive || s.turn.phase === 'choose' ? 0 : distance(s, me, p.seat),
      rep: s.rep[p.seat],
    })),
    hand: s.players[me].hand.map((id) => s.cards[id]),
    myCharOptions: s.players[me].charOptions,
    deckCount: s.deck.length,
    discardTop: s.discard.length ? s.cards[s.discard[s.discard.length - 1]] : null,
    store: s.store.map((id) => s.cards[id]),
    decision: mine,
    waitingFor: decs.map((d) => d.player),
    legal: mine?.type === 'play' ? legalPlays(s, me) : [],
    log: s.log.slice(-120),
    fx: s.fx,
    result: s.result,
  }
}
