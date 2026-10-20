// 開槍動作的時間軸（秒）：拔槍 → 甩出轉輪 → 一發一發裝子彈 → 轉輪轉動合上 → 扳擊錘 → 瞄準開火
// 3D 動畫和音效共用，兩邊才會對得上

export const GUN = {
  /** 從槍套拔出來 */
  draw: 0.3,
  /** 甩出轉輪 */
  open: [0.3, 0.45] as const,
  /** 三發子彈依序裝進去：[開始, 裝好] */
  rounds: [
    [0.5, 0.62],
    [0.65, 0.77],
    [0.8, 0.92],
  ] as const,
  /** 轉輪轉動 */
  spin: [0.95, 1.1] as const,
  /** 合上轉輪 */
  close: 1.1,
  /** 扳起擊錘、轉向目標 */
  cock: [1.12, 1.27] as const,
  /** 開火 */
  fire: 1.35,
  /** 同一個人連續開槍（格林機槍等）每發間隔 */
  repeat: 0.25,
  /** 最後一槍後槍還留在手上多久 */
  hold: 0.65,
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
