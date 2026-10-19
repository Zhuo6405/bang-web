// 《BANG!》規則引擎的資料型別。狀態是純資料（可 JSON 化），引擎以純函式運作。

export type Suit = 'S' | 'H' | 'D' | 'C'

export type CardKey =
  // 基本版：棕色（立即使用）
  | 'bang'
  | 'missed'
  | 'beer'
  | 'saloon'
  | 'stagecoach'
  | 'wellsfargo'
  | 'store'
  | 'gatling'
  | 'indians'
  | 'duel'
  | 'panic'
  | 'catbalou'
  // 基本版：藍色（裝備）
  | 'barrel'
  | 'dynamite'
  | 'jail'
  | 'mustang'
  | 'scope'
  | 'volcanic'
  | 'schofield'
  | 'remington'
  | 'carabine'
  | 'winchester'

export type CardColour = 'brown' | 'blue' | 'green'

export interface Card {
  id: number
  key: CardKey
  suit: Suit
  /** 2–10，J=11，Q=12，K=13，A=14 */
  rank: number
}

export type Role = 'sheriff' | 'deputy' | 'outlaw' | 'renegade'

export interface Player {
  seat: number
  name: string
  isAI: boolean
  role: Role
  character: string | null
  charOptions: string[]
  hp: number
  maxHp: number
  hand: number[]
  /** 場上的裝備（藍牌） */
  table: number[]
  alive: boolean
}

export interface GameConfig {
  names: string[]
  ai: boolean[]
  seed: number
  expansions: string[]
}

export type FxKind =
  | 'shoot' // 開槍（from → to）
  | 'miss' // 躲開
  | 'hit' // 受傷
  | 'heal'
  | 'check' // 抽判定
  | 'death'
  | 'explode'
  | 'play' // 打出一張牌
  | 'steal'
  | 'equip'
  | 'turn'

export interface Fx {
  seq: number
  kind: FxKind
  from?: number
  to?: number
  card?: Card
  ok?: boolean
  amount?: number
}

export interface LogEntry {
  seq: number
  text: string
  turn: number
}

export type AskKind =
  | 'respond' // 被開槍：出射偏了、用木桶，或受傷
  | 'indians' // 印第安人：棄一張砰！或受傷
  | 'duel' // 決鬥：棄一張砰！或受傷
  | 'store' // 雜貨店：挑一張
  | 'dying' // 瀕死：喝啤酒自救
  | 'discard' // 回合結束棄牌
  | 'kit' // 基特．卡爾森：三選二
  | 'jesse' // 傑西．瓊斯：第一張從哪抽
  | 'pedro' // 佩卓．拉米雷斯：第一張從哪抽

export interface Ask {
  k: 'ask'
  kind: AskKind
  player: number
  /** 攻擊者／對手 */
  from?: number | null
  /** 需要幾張射偏了 */
  need?: number
  got?: number
  /** 這一槍已用過的木桶來源 */
  barrels?: string[]
  /** 給這個人看的牌（基特的三張） */
  cards?: number[]
  /** 造成這次詢問的牌 */
  src?: CardKey
}

export type Task =
  | Ask
  | { k: 'startTurn' }
  | { k: 'drawPhase' }
  | { k: 'shot'; from: number; to: number; need: number; src: CardKey }
  | { k: 'damage'; to: number; amount: number; from: number | null }
  | { k: 'afterDamage'; to: number; amount: number; from: number | null }
  | { k: 'die'; who: number; killer: number | null }
  | { k: 'endTurn' }
  | { k: 'nextTurn' }

export interface Turn {
  active: number
  no: number
  bangs: number
  phase: 'choose' | 'start' | 'play' | 'end'
}

export interface GameResult {
  winners: number[]
  /** 獲勝陣營 */
  side: 'law' | 'outlaws' | 'renegade'
  reason: string
}

export interface GameState {
  config: GameConfig
  rng: number
  cards: Card[]
  deck: number[]
  discard: number[]
  players: Player[]
  turn: Turn
  q: Task[]
  /** 雜貨店翻開的牌 */
  store: number[]
  log: LogEntry[]
  fx: Fx[]
  seq: number
  result: GameResult | null
  /** 公開的「對警長的態度」：攻擊警長會減分，攻擊警長的敵人會加分（AI 用） */
  rep: number[]
}

export type Action =
  | { type: 'choose_character'; character: string }
  | { type: 'play'; card: number; target?: number; targetCard?: number | 'hand'; as?: CardKey }
  | { type: 'ability'; ability: 'sid'; cards: number[] }
  | { type: 'end_turn' }
  | { type: 'answer'; opt?: string; cards?: number[]; target?: number }

export interface AskOption {
  id: string
  label: string
  primary?: boolean
}

export interface AskView {
  kind: AskKind
  title: string
  prompt: string
  options: AskOption[]
  /** 可以點選的牌（手牌或展示的牌） */
  cards: number[]
  /** 牌在哪裡：手牌、雜貨店、私下展示 */
  zone: 'hand' | 'store' | 'reveal'
  min: number
  max: number
  /** 可以選的玩家（傑西．瓊斯） */
  targets: number[]
  /** 展示給你看的牌（基特） */
  shown: Card[]
}

export type Decision =
  | { type: 'choose_character'; player: number; options: string[] }
  | { type: 'play'; player: number }
  | { type: 'ask'; player: number; ask: AskView }

export interface LegalPlay {
  card: number
  /** 當作哪張牌使用 */
  as: CardKey
  /** null = 不需要目標 */
  targets: number[] | null
  /** 是否要再選目標的哪一張牌 */
  pickCard?: boolean
}
