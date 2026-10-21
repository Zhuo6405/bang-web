import type { GameState } from './types'

/**
 * 公開的互動紀錄：每次有人「指定某人」做事，就記一筆（正數＝敵意，負數＝幫忙）。
 * 電腦玩家用這份紀錄猜身分（見 src/ai/mind.ts）。
 */

/** 各種行為的敵意權重（負數＝幫忙） */
export const W = {
  /** 砰！、決鬥、瞄準、角色能力開的槍、綠牌的槍、小刀 */
  shoot: 1,
  /** 一次打兩個（連開）中的每一個 */
  shootEach: 1,
  /** 瞄準（打中失去 2 點） */
  aim: 1.3,
  /** 格林機槍、榴彈砲、印第安人：每個人都打，幾乎看不出立場 */
  area: 0.15,
  /** 群體攻擊但目標只剩 1 點生命（可能被打死） */
  areaLethal: 0.6,
  /** 搶奪、卡特巴洛、篷車、射擊場上的牌、花金塊棄裝備 */
  takeCard: 0.6,
  /** 派特．布瑞南拿場上的牌 */
  pat: 0.5,
  /** 鬥毆（大家都要棄一張）中被挑的人 */
  brawl: 0.2,
  /** 傑西．瓊斯抽別人手牌、佛林特換牌 */
  jesse: 0.3,
  /** 拿走或棄掉別人的監獄＝救他 */
  freeFromJail: -0.6,
  /** 拿走別人面前的炸藥＝幫他 */
  removeDynamite: -0.3,
  /** 監獄 */
  jail: 0.8,
  /** 響尾蛇 */
  rattlesnake: 0.7,
  /** 懸賞、通緝令 */
  bounty: 0.6,
  /** 回火反擊（被打才還手） */
  backfire: 0.5,
  /** 亨利．布洛克自動回敬 */
  henry: 0.3,
  /** 請別人喝酒、血親給血 */
  heal: -1,
  /** 用幽靈牌讓死人回來 */
  revive: -1,
  /** 打死一個人（在原本出手之外再加） */
  kill: 1.5,
} as const

/** 記一筆互動：a 對 b 做了權重 w 的事 */
export function note(s: GameState, a: number | null | undefined, b: number, w: number) {
  if (a == null || a === b || !w) return
  const n = s.players.length
  if (!s.rel || s.rel.length !== n) s.rel = Array.from({ length: n }, () => Array(n).fill(0))
  s.rel[a][b] += w
}
