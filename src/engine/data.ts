import type { Card, CardColour, CardKey, Role, Suit } from './types'

export interface CardDef {
  key: CardKey
  name: string
  colour: CardColour
  desc: string
  /** 武器射程 */
  range?: number
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

const RANKS: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 }

export function buildCards(expansions: string[] = []): Card[] {
  void expansions
  return BASE.map(([key, suit, r], id) => ({ id, key, suit, rank: typeof r === 'number' ? r : RANKS[r] }))
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
export const MAX_PLAYERS = 7

export const AI_NAMES = ['比利', '安妮', '傑克', '桃樂絲', '湯姆', '露比', '老喬', '漢克', '黛西']

/** 擴充：第一階段只有基本版，其餘陸續開放 */
export const EXPANSIONS: { id: string; name: string; ready: boolean }[] = [
  { id: 'dodge_city', name: '道奇城', ready: false },
  { id: 'high_noon', name: '正午', ready: false },
  { id: 'fistful', name: '一把卡牌', ready: false },
  { id: 'wild_west_show', name: '西部秀', ready: false },
  { id: 'gold_rush', name: '淘金熱', ready: false },
  { id: 'valley_of_shadows', name: '幽谷', ready: false },
  { id: 'armed_dangerous', name: '全副武裝', ready: false },
]
