import * as THREE from 'three'
import { CARD_DEFS, rankLabel, SUIT_SYMBOL } from '../../engine/data'
import type { Card } from '../../engine/types'

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

export function cardTexture(card: Card) {
  const def = CARD_DEFS[card.key]
  return make(`card-${card.key}-${card.suit}-${card.rank}`, 256, 360, (g) => {
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
    // 牌名
    const name = def.name
    g.fillStyle = '#2a1a10'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const size = name.length <= 2 ? 84 : name.length <= 3 ? 66 : name.length <= 4 ? 52 : 42
    g.font = `900 ${size}px ${SERIF}`
    g.fillText(name, 128, 175)
    // 底部：類型
    g.fillStyle = BORDER[def.colour]
    g.font = `700 26px ${SERIF}`
    g.fillText(def.colour === 'blue' ? (def.range ? `武器．射程 ${def.range}` : '裝備') : '立即使用', 128, 318)
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
    g.font = `900 104px ${SERIF}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 14
    g.strokeStyle = 'rgba(20,10,5,0.9)'
    g.strokeText(text, 256, 84)
    g.fillStyle = colour
    g.fillText(text, 256, 84)
  })
}
