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
  // 道奇城：棕色
  | 'punch'
  | 'dodge'
  | 'ragtime'
  | 'brawl'
  | 'springfield'
  | 'tequila'
  | 'whisky'
  // 道奇城：藍色
  | 'binocular'
  | 'hideout'
  // 道奇城：綠色（放到場上，下一回合起才能用）
  | 'bible'
  | 'hat'
  | 'ironplate'
  | 'sombrero'
  | 'knife'
  | 'derringer'
  | 'canteen'
  | 'cancan'
  | 'conestoga'
  | 'pepperbox'
  | 'buffalo'
  | 'howitzer'
  | 'pony'

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
  /** 場上的裝備（藍牌、綠牌） */
  table: number[]
  alive: boolean
  /** 薇拉．卡斯特這一輪複製的角色 */
  copy?: string | null
  /** 鬼鎮事件：死者以幽靈身分回來玩一回合 */
  ghost?: boolean
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
  | 'event' // 翻開事件牌
  | 'revive'

export interface Fx {
  seq: number
  kind: FxKind
  from?: number
  to?: number
  card?: Card
  ok?: boolean
  amount?: number
  event?: string
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
  | 'pat' // 派特．布瑞南：抽牌或拿場上一張牌
  | 'vera' // 薇拉．卡斯特：複製誰的能力
  | 'brawl' // 鬥毆：挑對方的哪一張牌棄掉
  | 'ricochet' // 跳彈：被打的那張場上牌，主人要不要出射偏了
  | 'daltons' // 道爾頓幫：棄一張藍色裝備
  | 'handcuffs' // 手銬：宣告花色
  | 'newidentity' // 新身分：要不要換角色
  | 'blood' // 結拜兄弟：要不要給血
  | 'liquor' // 烈酒：要不要放棄抽牌回血
  | 'peyote' // 仙人掌：猜顏色
  | 'ranch' // 牧場：換牌
  | 'roulette' // 俄羅斯輪盤

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
  /** 鬥毆／跳彈的對象 */
  target?: number
  /** 跳彈打的那張牌 */
  targetCard?: number
}

export type Task =
  | Ask
  | { k: 'startTurn' }
  | { k: 'turnChecks' }
  | { k: 'drawPhase' }
  | { k: 'afterDraw' }
  | { k: 'shot'; from: number | null; to: number; need: number; src: CardKey; suit?: Suit }
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
  /** 手銬：這回合只能用的花色 */
  suit?: Suit | null
  /** 西部法則：必須打出的那張牌 */
  must?: number | null
  /** 角色能力本回合用過幾次 */
  uses?: Record<string, number>
  /** 復仇事件：這回合是額外回合 */
  extra?: boolean
  /** 這回合抽牌階段抽到的牌（西部法則用） */
  drawn?: number[]
  /** 烈酒：這回合已經問過 */
  asked?: boolean
}

export interface GameResult {
  winners: number[]
  /** 獲勝陣營 */
  side: 'law' | 'outlaws' | 'renegade'
  reason: string
}

export interface EventState {
  deck: string[]
  current: string | null
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
  /** 回合方向（淘金潮事件會逆轉） */
  dir: 1 | -1
  /** 綠牌放上場的回合：下一回合起才能用 */
  greenAt: Record<string, number>
  /** 正午／一把卡牌的事件 */
  events: EventState | null
  /** 第一個死掉的人（死人復活事件） */
  firstDead: number | null
  deadManDone: boolean
}

export type Action =
  | { type: 'choose_character'; character: string }
  | { type: 'play'; card: number; as?: PlayAs; target?: number; targetCard?: number | 'hand'; extra?: number[] }
  | { type: 'ability'; ability: AbilityId; cards?: number[]; target?: number }
  | { type: 'end_turn' }
  | { type: 'answer'; opt?: string; cards?: number[]; target?: number }

export type PlayAs = CardKey | 'sniper' | 'ricochet'
export type AbilityId = 'sid' | 'chuck' | 'jose' | 'doc'

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
  /** 可以點選的牌（手牌、場上綠牌或展示的牌） */
  cards: number[]
  /** 牌在哪裡：手牌、雜貨店、私下展示 */
  zone: 'hand' | 'store' | 'reveal'
  min: number
  max: number
  /** 可以選的玩家 */
  targets: number[]
  /** 展示給你看的牌（基特、派特） */
  shown: Card[]
  /** 場上可以用的綠牌（例如十加侖帽當射偏了） */
  table: Card[]
}

export type Decision =
  | { type: 'choose_character'; player: number; options: string[] }
  | { type: 'play'; player: number }
  | { type: 'ask'; player: number; ask: AskView }

export interface LegalPlay {
  card: number
  /** 當作哪張牌使用 */
  as: PlayAs
  /** null = 不需要目標 */
  targets: number[] | null
  /** 是否要再選目標的哪一張牌 */
  pickCard?: boolean
  /** 只能選場上的牌（跳彈） */
  tableOnly?: boolean
  /** 從手牌還是場上的綠牌 */
  source: 'hand' | 'table'
  /** 另外要棄幾張手牌當代價 */
  cost?: number
  /** 代價必須是哪種牌（狙擊手要另一張砰！） */
  costKind?: CardKey
}

export interface LegalAbility {
  id: AbilityId
  label: string
  /** 要選幾張手牌 */
  cards: number
  /** 可以選的牌（荷西只能棄藍牌） */
  cardIds?: number[]
  targets?: number[]
}
