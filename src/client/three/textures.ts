import * as THREE from 'three'
import { CARD_DEFS, rankLabel, SUIT_SYMBOL } from '../../engine/data'
import type { Card } from '../../engine/types'
import { cardName, type Lang } from '../../engine/i18n'

// 牌面用 canvas 畫成貼圖：中文直接用瀏覽器字型，不需要另外下載字體檔

const SERIF = "'Noto Serif TC', 'Songti TC', 'PMingLiU', serif"
const WEST = "'Rye', 'Noto Serif TC', serif"
export const BORDER: Record<string, string> = { brown: '#7a4a22', blue: '#2b5684', green: '#3f6b35' }
const SUIT_COLOUR: Record<Card['suit'], string> = { H: '#b0281f', D: '#b0281f', S: '#1f1a16', C: '#1f1a16' }

const cache = new Map<string, THREE.CanvasTexture>()

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(key, tex)
  return tex
}

/** 字型載入後重畫 */
export function clearTextures() {
  for (const t of cache.values()) t.dispose()
  cache.clear()
}

/** 在寬度內放得下的最大字級 */
function fit(g: CanvasRenderingContext2D, text: string, max: number, from: number, to: number, weight = 900) {
  let size = from
  for (; size > to; size -= 2) {
    g.font = `${weight} ${size}px ${SERIF}`
    if (g.measureText(text).width <= max) break
  }
  g.font = `${weight} ${size}px ${SERIF}`
  return size
}

/** 依寬度換行：中文逐字，英文逐詞 */
function wrap(g: CanvasRenderingContext2D, text: string, max: number) {
  const words = /[A-Za-z]/.test(text) ? text.split(/(\s+)/) : [...text]
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (line && g.measureText(line + w).width > max) {
      lines.push(line.trim())
      line = w.trimStart()
    } else line += w
  }
  if (line.trim()) lines.push(line.trim())
  return lines
}

export function cardTexture(card: Card, lang: Lang = 'zh') {
  const def = CARD_DEFS[card.key]
  return make(`card-${lang}-${card.key}-${card.suit}-${card.rank}`, 256, 360, (g) => {
    g.fillStyle = BORDER[def.colour]
    g.fillRect(0, 0, 256, 360)
    g.fillStyle = '#efe3c4'
    g.beginPath()
    g.roundRect(12, 12, 232, 336, 12)
    g.fill()
    // 角落的花色點數（抽判定時要看）
    g.fillStyle = SUIT_COLOUR[card.suit]
    g.font = `700 34px ${SERIF}`
    g.textAlign = 'left'
    g.textBaseline = 'top'
    g.fillText(`${rankLabel(card.rank)}${SUIT_SYMBOL[card.suit]}`, 24, 22)
    // 牌名：放不下就縮小，英文太長就分兩行
    const name = cardName(card.key, lang)
    g.fillStyle = '#2a1a10'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const size = fit(g, name, 214, lang === 'en' ? 60 : 84, 34)
    if (size <= 34 && name.includes(' ')) {
      g.font = `900 40px ${SERIF}`
      const lines = wrap(g, name, 214)
      lines.slice(0, 2).forEach((l, i) => g.fillText(l, 128, 175 + (i - (Math.min(2, lines.length) - 1) / 2) * 46))
    } else g.fillText(name, 128, 175)
    // 底部：類型
    g.fillStyle = BORDER[def.colour]
    const kind =
      lang === 'en'
        ? def.colour === 'blue'
          ? def.range
            ? `Weapon · range ${def.range}`
            : 'Equipment'
          : def.colour === 'green'
            ? 'Green (from next turn)'
            : def.cost
              ? '+1 discard'
              : 'Play now'
        : def.colour === 'blue'
          ? def.range
            ? `武器．射程 ${def.range}`
            : '裝備'
          : def.colour === 'green'
            ? '綠牌（下回合起可用）'
            : def.cost
              ? '另外棄 1 張'
              : '立即使用'
    fit(g, kind, 214, 26, 16, 700)
    g.fillText(kind, 128, 318)
  })
}

export function cardBackTexture() {
  return make('back', 256, 360, (g) => {
    g.fillStyle = '#5a2a18'
    g.fillRect(0, 0, 256, 360)
    g.strokeStyle = '#e0b85a'
    g.lineWidth = 6
    g.strokeRect(14, 14, 228, 332)
    g.save()
    g.translate(128, 180)
    g.rotate(-0.25)
    g.fillStyle = '#e0b85a'
    g.font = `900 78px ${WEST}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('BANG!', 0, 0)
    g.restore()
  })
}

/** 浮在空中的字（砰！、射偏了！、-1） */
export function wordTexture(text: string, colour: string) {
  return make(`word-${text}-${colour}`, 512, 160, (g) => {
    fit(g, text, 470, 104, 40)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 14
    g.strokeStyle = 'rgba(20,10,5,0.9)'
    g.strokeText(text, 256, 84)
    g.fillStyle = colour
    g.fillText(text, 256, 84)
  })
}

/** 事件牌：通緝令風格 */
export function eventTexture(name: string, text: string, lang: Lang = 'zh') {
  return make(`event-${lang}-${name}`, 360, 500, (g) => {
    g.fillStyle = '#d9c08a'
    g.fillRect(0, 0, 360, 500)
    g.strokeStyle = '#5a3518'
    g.lineWidth = 10
    g.strokeRect(14, 14, 332, 472)
    g.fillStyle = '#5a3518'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `900 34px ${SERIF}`
    g.fillText(lang === 'en' ? 'EVENT' : '事 件', 180, 62)
    g.fillStyle = '#7a1e12'
    fit(g, name, 300, lang === 'en' ? 64 : 92, 30)
    g.fillText(name, 180, 160)
    g.fillStyle = '#2a1a10'
    g.font = `600 ${lang === 'en' ? 24 : 26}px ${SERIF}`
    // 自動換行
    wrap(g, text, 290)
      .slice(0, 8)
      .forEach((l, i) => g.fillText(l, 180, 250 + i * 32))
  })
}

/** 桌上裝備的名牌：圓角底色 + 字，字太長會自動縮小 */
export function tagTexture(text: string, bg: string, fg = '#1c140c') {
  return make(`tag-${text}-${bg}-${fg}`, 512, 128, (g) => {
    g.font = `900 72px ${SERIF}`
    const w = Math.min(500, g.measureText(text).width + 56)
    const size = w >= 500 ? Math.floor((72 * 444) / g.measureText(text).width) : 72
    g.font = `900 ${size}px ${SERIF}`
    const x = (512 - w) / 2
    g.fillStyle = bg
    g.strokeStyle = 'rgba(20,10,5,0.85)'
    g.lineWidth = 6
    g.beginPath()
    g.roundRect(x + 3, 14, w - 6, 100, 50)
    g.fill()
    g.stroke()
    g.fillStyle = fg
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 256, 68)
  })
}
