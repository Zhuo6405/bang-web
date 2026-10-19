import type { Card, CardColour, CardKey, Role, Suit } from './types'

export interface CardDef {
  key: CardKey
  name: string
  colour: CardColour
  desc: string
  /** 武器射程 */
  range?: number
  /** 使用時要另外棄一張手牌 */
  cost?: boolean
  /** 綠牌在場上可以當作射偏了 */
  defend?: boolean
}

export const CARD_DEFS: Record<CardKey, CardDef> = {
  bang: { key: 'bang', name: '砰！', colour: 'brown', desc: '對射程內一名玩家開一槍。每回合限用一次。' },
  missed: { key: 'missed', name: '射偏了！', colour: 'brown', desc: '被開槍時打出，躲開這一槍。' },
  beer: { key: 'beer', name: '啤酒', colour: 'brown', desc: '回復 1 點生命（不能超過上限）。瀕死時也能喝。只剩兩人時無效。' },
  saloon: { key: 'saloon', name: '酒館', colour: 'brown', desc: '所有活著的玩家各回復 1 點生命。' },
  stagecoach: { key: 'stagecoach', name: '驛馬車', colour: 'brown', desc: '從牌堆抽 2 張牌。' },
  wellsfargo: { key: 'wellsfargo', name: '富國快遞', colour: 'brown', desc: '從牌堆抽 3 張牌。' },
  store: { key: 'store', name: '雜貨店', colour: 'brown', desc: '翻開與存活人數相同的牌，從你開始每人輪流挑一張。' },
  gatling: { key: 'gatling', name: '格林機槍', colour: 'brown', desc: '對其他所有玩家各開一槍（不受距離與次數限制）。' },
  indians: { key: 'indians', name: '印第安人！', colour: 'brown', desc: '其他所有玩家各要棄一張「砰！」，否則失去 1 點生命。' },
  duel: { key: 'duel', name: '決鬥', colour: 'brown', desc: '指定任一玩家，從他開始輪流棄「砰！」，先棄不出的人失去 1 點生命。' },
  panic: { key: 'panic', name: '搶奪', colour: 'brown', desc: '拿走距離 1 以內一名玩家的一張牌（手牌或場上）。' },
  catbalou: { key: 'catbalou', name: '卡特巴洛', colour: 'brown', desc: '棄掉任一玩家的一張牌（手牌或場上）。' },
  barrel: { key: 'barrel', name: '木桶', colour: 'blue', desc: '被開槍時可以抽判定：紅心就當作「射偏了！」。' },
  dynamite: { key: 'dynamite', name: '炸藥', colour: 'blue', desc: '放在自己面前。回合開始時抽判定：黑桃 2–9 爆炸失去 3 點生命，否則傳給下一位。' },
  jail: { key: 'jail', name: '監獄', colour: 'blue', desc: '放在警長以外的玩家面前。他回合開始時抽判定：紅心就脫逃，否則跳過這回合。' },
  mustang: { key: 'mustang', name: '野馬', colour: 'blue', desc: '其他人看你的距離 +1。' },
  scope: { key: 'scope', name: '瞄準鏡', colour: 'blue', desc: '你看其他人的距離 -1。' },
  volcanic: { key: 'volcanic', name: '火山連發槍', colour: 'blue', desc: '射程 1。裝備時「砰！」沒有次數限制。', range: 1 },
  schofield: { key: 'schofield', name: '史科菲', colour: 'blue', desc: '射程 2。', range: 2 },
  remington: { key: 'remington', name: '雷明頓', colour: 'blue', desc: '射程 3。', range: 3 },
  carabine: { key: 'carabine', name: '卡賓槍', colour: 'blue', desc: '射程 4。', range: 4 },
  winchester: { key: 'winchester', name: '溫徹斯特', colour: 'blue', desc: '射程 5。', range: 5 },
  // 道奇城
  punch: { key: 'punch', name: '拳擊', colour: 'brown', desc: '對距離 1 的一名玩家開一槍（不算「砰！」次數）。' },
  dodge: { key: 'dodge', name: '閃躲', colour: 'brown', desc: '當作「射偏了！」，然後抽 1 張牌。' },
  ragtime: { key: 'ragtime', name: '拉格泰姆', colour: 'brown', cost: true, desc: '另外棄 1 張手牌：拿走任一玩家的一張牌（不限距離）。' },
  brawl: { key: 'brawl', name: '鬥毆', colour: 'brown', cost: true, desc: '另外棄 1 張手牌：其他每位玩家各被你棄掉一張牌（手牌或場上）。' },
  springfield: { key: 'springfield', name: '春田步槍', colour: 'brown', cost: true, desc: '另外棄 1 張手牌：對任一玩家開一槍（不限距離，不算次數）。' },
  tequila: { key: 'tequila', name: '龍舌蘭', colour: 'brown', cost: true, desc: '另外棄 1 張手牌：讓任一玩家（可以是自己）回 1 點生命。' },
  whisky: { key: 'whisky', name: '威士忌', colour: 'brown', cost: true, desc: '另外棄 1 張手牌：自己回 2 點生命。' },
  binocular: { key: 'binocular', name: '望遠鏡', colour: 'blue', desc: '你看其他人的距離 -1。' },
  hideout: { key: 'hideout', name: '藏身處', colour: 'blue', desc: '其他人看你的距離 +1。' },
  bible: { key: 'bible', name: '聖經', colour: 'green', defend: true, desc: '綠牌：被開槍時棄掉，當作「射偏了！」並抽 1 張。' },
  hat: { key: 'hat', name: '十加侖帽', colour: 'green', defend: true, desc: '綠牌：被開槍時棄掉，當作「射偏了！」。' },
  ironplate: { key: 'ironplate', name: '鐵板', colour: 'green', defend: true, desc: '綠牌：被開槍時棄掉，當作「射偏了！」。' },
  sombrero: { key: 'sombrero', name: '墨西哥帽', colour: 'green', defend: true, desc: '綠牌：被開槍時棄掉，當作「射偏了！」。' },
  knife: { key: 'knife', name: '小刀', colour: 'green', desc: '綠牌：棄掉，對距離 1 的一名玩家開一槍。' },
  derringer: { key: 'derringer', name: '德林傑', colour: 'green', desc: '綠牌：棄掉，對距離 1 的一名玩家開一槍，並抽 1 張。' },
  canteen: { key: 'canteen', name: '水壺', colour: 'green', desc: '綠牌：棄掉，回 1 點生命。' },
  cancan: { key: 'cancan', name: '康康舞', colour: 'green', desc: '綠牌：棄掉，當作「卡特巴洛」。' },
  conestoga: { key: 'conestoga', name: '篷車', colour: 'green', desc: '綠牌：棄掉，拿走任一玩家的一張牌（不限距離）。' },
  pepperbox: { key: 'pepperbox', name: '胡椒盒手槍', colour: 'green', desc: '綠牌：棄掉，對射程內一名玩家開一槍（不算次數）。' },
  buffalo: { key: 'buffalo', name: '野牛步槍', colour: 'green', desc: '綠牌：棄掉，對任一玩家開一槍（不限距離）。' },
  howitzer: { key: 'howitzer', name: '榴彈砲', colour: 'green', desc: '綠牌：棄掉，當作「格林機槍」。' },
  pony: { key: 'pony', name: '驛馬快遞', colour: 'green', desc: '綠牌：棄掉，抽 3 張牌。' },
}

export const isWeapon = (k: CardKey) => CARD_DEFS[k].range != null

/** 基本版 80 張：[牌, 花色, 點數] */
const BASE: [CardKey, Suit, number | string][] = [
  ['barrel', 'S', 'Q'], ['barrel', 'S', 'K'],
  ['dynamite', 'H', 2],
  ['scope', 'S', 'A'],
  ['mustang', 'H', 8], ['mustang', 'H', 9],
  ['jail', 'S', 'J'], ['jail', 'H', 4], ['jail', 'S', 10],
  ['remington', 'C', 'K'],
  ['carabine', 'C', 'A'],
  ['schofield', 'C', 'J'], ['schofield', 'C', 'Q'], ['schofield', 'S', 'K'],
  ['volcanic', 'S', 10], ['volcanic', 'C', 10],
  ['winchester', 'S', 8],
  ['bang', 'S', 'A'],
  ...([2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'] as const).map((r) => ['bang', 'D', r] as [CardKey, Suit, number | string]),
  ...([2, 3, 4, 5, 6, 7, 8, 9] as const).map((r) => ['bang', 'C', r] as [CardKey, Suit, number | string]),
  ['bang', 'H', 'Q'], ['bang', 'H', 'K'], ['bang', 'H', 'A'],
  ...([6, 7, 8, 9, 10, 'J'] as const).map((r) => ['beer', 'H', r] as [CardKey, Suit, number | string]),
  ['catbalou', 'H', 'K'], ['catbalou', 'D', 9], ['catbalou', 'D', 10], ['catbalou', 'D', 'J'],
  ['stagecoach', 'S', 9], ['stagecoach', 'S', 9],
  ['duel', 'D', 'Q'], ['duel', 'S', 'J'], ['duel', 'C', 8],
  ['store', 'C', 9], ['store', 'S', 'Q'],
  ['gatling', 'H', 10],
  ['indians', 'D', 'K'], ['indians', 'D', 'A'],
  ...([10, 'J', 'Q', 'K', 'A'] as const).map((r) => ['missed', 'C', r] as [CardKey, Suit, number | string]),
  ...([2, 3, 4, 5, 6, 7, 8] as const).map((r) => ['missed', 'S', r] as [CardKey, Suit, number | string]),
  ['panic', 'H', 'J'], ['panic', 'H', 'Q'], ['panic', 'H', 'A'], ['panic', 'D', 8],
  ['saloon', 'H', 5],
  ['wellsfargo', 'H', 3],
]

/** 道奇城 40 張 */
const DODGE: [CardKey, Suit, number | string][] = [
  ['barrel', 'C', 'A'], ['binocular', 'D', 10], ['dynamite', 'C', 10], ['mustang', 'H', 5], ['remington', 'D', 6], ['carabine', 'S', 5], ['hideout', 'D', 'K'],
  ['bang', 'S', 8], ['bang', 'C', 5], ['bang', 'C', 6], ['bang', 'C', 'K'],
  ['beer', 'H', 6], ['beer', 'S', 6],
  ['catbalou', 'C', 8], ['store', 'S', 'A'], ['indians', 'D', 5], ['missed', 'D', 8], ['panic', 'H', 'J'],
  ['punch', 'S', 10], ['ragtime', 'H', 9], ['brawl', 'S', 'J'], ['dodge', 'D', 7], ['dodge', 'H', 'K'], ['springfield', 'S', 'K'], ['tequila', 'C', 9], ['whisky', 'H', 'Q'],
  ['bible', 'H', 10], ['hat', 'D', 'J'], ['ironplate', 'D', 'A'], ['ironplate', 'S', 'Q'], ['sombrero', 'C', 7],
  ['knife', 'H', 8], ['derringer', 'S', 7], ['canteen', 'H', 7], ['cancan', 'C', 'J'], ['conestoga', 'D', 9],
  ['buffalo', 'C', 'Q'], ['pony', 'D', 'Q'], ['pepperbox', 'H', 'A'], ['howitzer', 'S', 9],
]

const RANKS: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 }

export function buildCards(expansions: string[] = []): Card[] {
  const list = [...BASE, ...(expansions.includes('dodge_city') ? DODGE : [])]
  return list.map(([key, suit, r], id) => ({ id, key, suit, rank: typeof r === 'number' ? r : RANKS[r] }))
}

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
export const SUIT_NAME: Record<Suit, string> = { S: '黑桃', H: '紅心', D: '方塊', C: '梅花' }
export const rankLabel = (r: number) => (r <= 10 ? String(r) : ['J', 'Q', 'K', 'A'][r - 11])
export const cardLabel = (c: Card) => `【${CARD_DEFS[c.key].name}】`
export const cardSuitLabel = (c: Card) => `${SUIT_SYMBOL[c.suit]}${rankLabel(c.rank)}`

export interface CharDef {
  id: string
  name: string
  hp: number
  text: string
  set: string
}

export const CHARACTERS: CharDef[] = [
  { id: 'bart', name: '巴特．卡西迪', hp: 4, set: 'base', text: '每失去 1 點生命，就從牌堆抽 1 張牌。' },
  { id: 'blackjack', name: '黑傑克', hp: 4, set: 'base', text: '抽牌階段亮出第二張牌：如果是紅心或方塊，再多抽 1 張。' },
  { id: 'calamity', name: '災難珍妮', hp: 4, set: 'base', text: '「砰！」和「射偏了！」可以互相當作對方使用。' },
  { id: 'gringo', name: '艾爾．格林哥', hp: 3, set: 'base', text: '每被一名玩家造成 1 點傷害，就從他的手牌隨機拿 1 張。' },
  { id: 'jesse', name: '傑西．瓊斯', hp: 4, set: 'base', text: '抽牌階段的第一張牌可以改從任一玩家的手牌隨機拿。' },
  { id: 'jourdonnais', name: '喬登奈', hp: 4, set: 'base', text: '永遠視為裝備著木桶；再裝木桶可以判定兩次。' },
  { id: 'kit', name: '基特．卡爾森', hp: 4, set: 'base', text: '抽牌階段看牌堆頂 3 張，挑 2 張，另一張放回牌堆頂。' },
  { id: 'lucky', name: '幸運杜克', hp: 4, set: 'base', text: '每次抽判定都翻 2 張，挑對自己有利的一張。' },
  { id: 'paul', name: '保羅．瑞格雷', hp: 3, set: 'base', text: '其他人看他的距離 +1。' },
  { id: 'pedro', name: '佩卓．拉米雷斯', hp: 4, set: 'base', text: '抽牌階段的第一張牌可以改拿棄牌堆最上面那張。' },
  { id: 'rose', name: '蘿絲．杜蘭', hp: 4, set: 'base', text: '她看其他人的距離 -1。' },
  { id: 'sid', name: '席德．凱強', hp: 4, set: 'base', text: '隨時可以棄 2 張手牌回復 1 點生命。' },
  { id: 'slab', name: '殺手史萊柏', hp: 4, set: 'base', text: '他的「砰！」要用 2 張「射偏了！」才躲得掉。' },
  { id: 'suzy', name: '蘇西．拉法葉', hp: 4, set: 'base', text: '只要手牌變成 0 張，就立刻抽 1 張。' },
  { id: 'vulture', name: '禿鷹山姆', hp: 4, set: 'base', text: '有玩家死亡時，拿走他所有的手牌和裝備。' },
  { id: 'willy', name: '小子威利', hp: 4, set: 'base', text: '「砰！」沒有次數限制。' },
  // 道奇城
  { id: 'pixie', name: '小精靈彼特', hp: 3, set: 'dodge_city', text: '抽牌階段抽 3 張。' },
  { id: 'tequilajoe', name: '龍舌蘭喬', hp: 4, set: 'dodge_city', text: '喝啤酒回 2 點生命。' },
  { id: 'greg', name: '葛雷格．迪格', hp: 4, set: 'dodge_city', text: '其他玩家死亡時，他回 2 點生命。' },
  { id: 'herb', name: '賀伯．杭特', hp: 4, set: 'dodge_city', text: '其他玩家死亡時，他抽 2 張牌。' },
  { id: 'elena', name: '艾蓮娜．富恩特', hp: 3, set: 'dodge_city', text: '任何手牌都可以當作「射偏了！」。' },
  { id: 'bill', name: '無臉比爾', hp: 4, set: 'dodge_city', text: '抽牌階段抽 1 張，每少 1 點生命再多抽 1 張。' },
  { id: 'molly', name: '莫莉．史塔克', hp: 4, set: 'dodge_city', text: '在自己回合以外打出手牌時，抽 1 張。' },
  { id: 'apache', name: '阿帕契小子', hp: 3, set: 'dodge_city', text: '別人打出的方塊牌對他無效（決鬥除外）。' },
  { id: 'sean', name: '尚恩．馬洛里', hp: 3, set: 'dodge_city', text: '回合結束時手牌最多可以留 10 張。' },
  { id: 'belle', name: '貝兒．史塔', hp: 4, set: 'dodge_city', text: '她的回合中，其他人場上的牌全部失效。' },
  { id: 'vera', name: '薇拉．卡斯特', hp: 3, set: 'dodge_city', text: '回合開始時，選一名活著的玩家，複製他的能力到她下一回合。' },
  { id: 'chuck', name: '恰克．溫甘', hp: 4, set: 'dodge_city', text: '自己回合中可以失去 1 點生命，抽 2 張牌（不能是最後 1 點）。' },
  { id: 'pat', name: '派特．布瑞南', hp: 4, set: 'dodge_city', text: '抽牌階段可以改成拿走任一玩家場上的一張牌。' },
  { id: 'jose', name: '荷西．德爾加多', hp: 4, set: 'dodge_city', text: '自己回合中可以棄 1 張藍牌抽 2 張，每回合最多 2 次。' },
  { id: 'doc', name: '霍利戴醫生', hp: 4, set: 'dodge_city', text: '每回合一次，棄 2 張手牌，對射程內一人開一槍（不算次數）。' },
]
export const CHAR_BY_ID: Record<string, CharDef> = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]))

export const ROLE_NAME: Record<Role, string> = { sheriff: '警長', deputy: '副警長', outlaw: '歹徒', renegade: '叛徒' }
export const ROLE_GOAL: Record<Role, string> = {
  sheriff: '消滅所有歹徒和叛徒。',
  deputy: '保護警長，消滅所有歹徒和叛徒。',
  outlaw: '殺死警長。',
  renegade: '成為最後一個活著的人（最後要單挑贏警長）。',
}

/** 依人數分配身份 */
export const ROLE_SETUP: Record<number, Role[]> = {
  3: ['deputy', 'outlaw', 'renegade'],
  4: ['sheriff', 'renegade', 'outlaw', 'outlaw'],
  5: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'deputy'],
  6: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy'],
  7: ['sheriff', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy', 'deputy'],
  8: ['sheriff', 'renegade', 'renegade', 'outlaw', 'outlaw', 'outlaw', 'deputy', 'deputy'],
}
export const MIN_PLAYERS = 4
export const MAX_PLAYERS = 8
/** 8 人局需要道奇城 */
export const maxPlayersFor = (expansions: string[]) => (expansions.includes('dodge_city') ? 8 : 7)

export interface EventDef {
  id: string
  name: string
  set: 'high_noon' | 'fistful'
  text: string
  /** 最後一張（放在事件牌堆底） */
  final?: boolean
}

export const EVENTS: EventDef[] = [
  // 正午
  { id: 'blessing', name: '祝福', set: 'high_noon', text: '所有牌的花色都視為紅心。' },
  { id: 'curse', name: '詛咒', set: 'high_noon', text: '所有牌的花色都視為黑桃。' },
  { id: 'ghosttown', name: '鬼鎮', set: 'high_noon', text: '死去的玩家在自己回合以幽靈身分回來：抽 3 張、不會受傷，回合結束後再次離場。' },
  { id: 'goldrush', name: '淘金潮', set: 'high_noon', text: '回合順序改為逆時針。' },
  { id: 'daltons', name: '道爾頓幫', set: 'high_noon', text: '翻開時，場上有藍牌的人各棄掉一張自己的藍牌。' },
  { id: 'doctor', name: '醫生', set: 'high_noon', text: '翻開時，生命最少的玩家各回 1 點生命。' },
  { id: 'reverend', name: '牧師', set: 'high_noon', text: '不能喝啤酒。' },
  { id: 'train', name: '火車進站', set: 'high_noon', text: '抽牌階段多抽 1 張。' },
  { id: 'hangover', name: '宿醉', set: 'high_noon', text: '所有角色失去能力。' },
  { id: 'sermon', name: '佈道', set: 'high_noon', text: '自己的回合中不能打出「砰！」。' },
  { id: 'thirst', name: '口渴', set: 'high_noon', text: '抽牌階段只抽 1 張。' },
  { id: 'shootout', name: '槍戰', set: 'high_noon', text: '每回合可以打出 2 張「砰！」。' },
  { id: 'handcuffs', name: '手銬', set: 'high_noon', text: '抽牌後宣告一個花色，這回合只能打出那個花色的牌。' },
  { id: 'newidentity', name: '新身分', set: 'high_noon', text: '回合開始時可以換成開局時另一張角色，換了就從 2 點生命重新開始。' },
  { id: 'highnoon', name: '正午決戰', set: 'high_noon', final: true, text: '每位玩家在回合開始時失去 1 點生命。' },
  // 一把卡牌
  { id: 'ambush', name: '埋伏', set: 'fistful', text: '任兩人之間的基本距離都是 1。' },
  { id: 'sniper', name: '狙擊手', set: 'fistful', text: '回合中可以一次棄 2 張「砰！」，開一槍要 2 張「射偏了！」才躲得掉（算這回合的「砰！」）。' },
  { id: 'deadman', name: '死人復活', set: 'fistful', text: '第一個死掉的玩家在他的回合帶著 2 點生命和 2 張牌回來。' },
  { id: 'blood', name: '結拜兄弟', set: 'fistful', text: '回合開始時可以失去 1 點生命（不能是最後 1 點），讓另一名玩家回 1 點。' },
  { id: 'judge', name: '法官', set: 'fistful', text: '不能把牌放到任何人面前（不能裝備、不能關監獄）。' },
  { id: 'lasso', name: '套索', set: 'fistful', text: '所有人場上的牌都沒有效果。' },
  { id: 'law', name: '西部法則', set: 'fistful', text: '抽牌時亮出第二張，能用的話這回合必須先用掉。' },
  { id: 'liquor', name: '烈酒', set: 'fistful', text: '可以放棄抽牌，改回 1 點生命。' },
  { id: 'mine', name: '廢棄礦坑', set: 'fistful', text: '抽牌改從棄牌堆抽；回合結束棄的牌放回牌堆頂。' },
  { id: 'peyote', name: '仙人掌', set: 'fistful', text: '不抽牌，改成猜下一張是紅是黑：猜對就拿走再猜，猜錯就停。' },
  { id: 'ranch', name: '牧場', set: 'fistful', text: '抽牌後可以棄任意張手牌，再抽同樣張數。' },
  { id: 'ricochet', name: '跳彈', set: 'fistful', text: '可以對任一人場上的一張牌打出「砰！」：主人不出「射偏了！」那張牌就被棄掉。' },
  { id: 'roulette', name: '俄羅斯輪盤', set: 'fistful', text: '翻開時從警長開始輪流棄「射偏了！」，第一個棄不出的人失去 2 點生命。' },
  { id: 'vendetta', name: '復仇', set: 'fistful', text: '回合結束時抽判定：紅心就再玩一回合（只能一次）。' },
  { id: 'fistful', name: '一把卡牌', set: 'fistful', final: true, text: '回合開始時，手上有幾張牌就挨幾槍。' },
]
export const EVENT_BY_ID: Record<string, EventDef> = Object.fromEntries(EVENTS.map((e) => [e.id, e]))

export const AI_NAMES = ['比利', '安妮', '傑克', '桃樂絲', '湯姆', '露比', '老喬', '漢克', '黛西']

/** 擴充：第一階段只有基本版，其餘陸續開放 */
export const EXPANSIONS: { id: string; name: string; ready: boolean }[] = [
  { id: 'dodge_city', name: '道奇城', ready: true },
  { id: 'high_noon', name: '正午', ready: true },
  { id: 'fistful', name: '一把卡牌', ready: true },
  { id: 'wild_west_show', name: '西部秀', ready: false },
  { id: 'gold_rush', name: '淘金熱', ready: false },
  { id: 'valley_of_shadows', name: '幽谷', ready: false },
  { id: 'armed_dangerous', name: '全副武裝', ready: false },
]
