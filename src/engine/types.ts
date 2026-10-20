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
  // 幽谷
  | 'ghostcard'
  | 'lemat'
  | 'rattlesnake'
  | 'shotgun'
  | 'bounty'
  | 'lastcall'
  | 'tomahawk'
  | 'tornado'
  | 'fanning'
  | 'aim'
  | 'bandidos'
  | 'escape'
  | 'poker'
  | 'backfire'

/** 淘金熱的裝備（另一副牌，用金塊買） */
export type GoldKey =
  | 'shotglass'
  | 'bottle'
  | 'pardner'
  | 'goldrushcard'
  | 'rum'
  | 'unionpacific'
  | 'calumet'
  | 'gunbelt'
  | 'horseshoe'
  | 'pickaxe'
  | 'wanted'
  | 'goldpan'
  | 'boots'
  | 'luckycharm'
  | 'rucksack'

export interface GoldCard {
  uid: number
  key: GoldKey
}

export interface GoldState {
  cards: GoldCard[]
  deck: number[]
  /** 商店裡翻開的三張 */
  shop: number[]
  nuggets: number[]
  /** 每個人面前的黑框裝備（通緝令放在被通緝的人面前） */
  equip: number[][]
  /** 喬許．麥克勞德抽到、這回合可以免費使用的棕框裝備 */
  free: (number | null)[]
}

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
  /** 幽靈：town = 鬼鎮事件（玩一回合）、card = 幽谷的幽靈牌（牌在就留著） */
  ghost?: 'town' | 'card' | null
  /** 葛雷戈里．戴克這一輪得到的兩個角色能力 */
  copies?: string[]
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
  | 'dutch' // 荷蘭佬威爾：兩張留一張
  | 'evelyn' // 伊芙琳：放棄抽牌改開槍
  | 'bandidos' // 土匪：棄 2 張或失去 1 點生命
  | 'poker' // 撲克：棄一張手牌
  | 'pokertake' // 撲克：沒有 A，拿走最多 2 張
  | 'tornado' // 龍捲風：棄一張手牌
  | 'lemonade' // 檸檬水吉姆：棄一張回 1 血
  | 'youl' // 尤爾．葛林納：給他一張牌

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
  /** 中彈時失去幾點生命（瞄準） */
  dmg?: number
  /** 開槍的那張牌（回火、懸賞用） */
  bangCard?: boolean
}

export type Task =
  | Ask
  | { k: 'startTurn' }
  | { k: 'turnChecks' }
  | { k: 'drawPhase' }
  | { k: 'afterDraw' }
  | { k: 'shot'; from: number | null; to: number; need: number; src: CardKey; suit?: Suit; dmg?: number; bangCard?: boolean; sure?: boolean }
  | { k: 'damage'; to: number; amount: number; from: number | null; bangCard?: boolean }
  | { k: 'drawN'; to: number; n: number }
  | { k: 'pokerEnd'; user: number }
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
  /** 這回合打出幾張牌（蘇珊娜小姐） */
  played?: number
  /** 淘金熱卡：回合結束後再玩一回合 */
  again?: boolean
  /** 蘇珊娜小姐已經罰過 */
  susanna?: boolean
  /** 響尾蛇這回合已經判定過 */
  snake?: boolean
  /** 李．范．克利夫：上一張打出的棕牌效果 */
  last?: { as: PlayAs; target?: number; targetCard?: number | 'hand'; target2?: number; card: number } | null
}

export interface GameResult {
  winners: number[]
  /** 獲勝陣營 */
  side: 'law' | 'outlaws' | 'renegade' | 'last'
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
  /** 淘金熱 */
  gold: GoldState | null
  /** 撲克：大家棄出的牌 */
  poker: number[]
  /** 回合方向（淘金潮事件會逆轉） */
  dir: 1 | -1
  /** 綠牌放上場的回合：下一回合起才能用 */
  greenAt: Record<string, number>
  /** 正午／一把卡牌的事件 */
  events: EventState | null
  /** 第一個死掉的人（死人復活事件） */
  firstDead: number | null
  deadManDone: boolean
  /** 開局自由選角：每輪大家同時挑，撞角就擲硬幣 */
  pick?: PickState | null
}

export type Action =
  | { type: 'choose_character'; character: string }
  | { type: 'play'; card: number; as?: PlayAs; target?: number; targetCard?: number | 'hand'; extra?: number[]; target2?: number }
  | { type: 'ability'; ability: AbilityId; cards?: number[]; target?: number }
  | { type: 'end_turn' }
  | { type: 'answer'; opt?: string; cards?: number[]; target?: number }

export type PlayAs = CardKey | GoldKey | 'sniper' | 'ricochet' | 'flower' | 'nugget' | 'golddrop'
export type AbilityId = 'sid' | 'chuck' | 'jose' | 'doc' | 'jacky' | 'josh' | 'raddie' | 'goldpan' | 'rucksack' | 'flint' | 'lee'

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
  /** 從手牌、場上的綠牌，或淘金熱商店 */
  source: 'hand' | 'table' | 'shop'
  /** 商店價格（金塊） */
  price?: number
  /** 連開：第二個目標的候選（依第一個目標而定） */
  second?: Record<number, number[]>
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

/** 撞角時的擲硬幣：每一輪每人擲出的硬幣（true＝人頭） */
export interface CoinDuel {
  /** 第幾輪選角發生的 */
  round: number
  char: string
  seats: number[]
  rounds: { seat: number; coins: boolean[] }[][]
  winner: number
}

export interface PickState {
  /** 這局可以選的角色（依擴充包） */
  pool: string[]
  /** 這一輪每個人送出的選擇（還沒定案） */
  picks: (string | null)[]
  round: number
  /** 所有擲硬幣結果（依輪次累積） */
  duels: CoinDuel[]
}
