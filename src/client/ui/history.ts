import { CHAR_BY_ID } from '../../engine/data'
import type { Role } from '../../engine/types'
import type { GameView } from '../../engine/view'

// 對局紀錄：存在這台電腦的瀏覽器裡（localStorage）

export interface HistoryEntry {
  id: string
  at: number
  mode: 'local' | 'online'
  won: boolean
  myRole: Role | null
  reason: string
  players: { name: string; role: Role | null; character: string | null; won: boolean; isAI: boolean }[]
}

const KEY = 'bang-history'

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistoryEntry[]
  } catch {
    return []
  }
}

export function recordResult(v: GameView, mode: 'local' | 'online', id: string) {
  if (!v.result) return
  const list = loadHistory()
  if (list.some((h) => h.id === id)) return
  const entry: HistoryEntry = {
    id,
    at: Date.now(),
    mode,
    won: v.result.winners.includes(v.me),
    myRole: v.players[v.me].role,
    reason: v.result.reason,
    players: v.players.map((p) => ({
      name: p.name,
      role: p.role,
      character: p.character ? CHAR_BY_ID[p.character].name : null,
      won: v.result!.winners.includes(p.seat),
      isAI: p.isAI,
    })),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...list].slice(0, 30)))
  } catch {
    /* ignore */
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
