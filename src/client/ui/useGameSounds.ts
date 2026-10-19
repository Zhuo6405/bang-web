import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { GameView } from '../../engine/view'
import type { ChatMsg } from '../../shared/protocol'
import { onSoundChange, play, setSoundOn, soundOn, type Sfx } from '../sound'

const FIRE_DELAY = 450 // 跟 3D 場景的開火時間對齊

/** 依引擎的 fx 事件發出音效 */
export function useGameSounds(v: GameView, chat: ChatMsg[] | undefined, myClientId: string | undefined) {
  const seen = useRef(-1)
  const prevDecision = useRef<string>('')
  const prevResult = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    if (seen.current < 0) {
      seen.current = v.fx.length ? v.fx[v.fx.length - 1].seq : 0
      prevResult.current = !!v.result
      return
    }
    const later = (s: Sfx, ms: number) => timers.current.push(setTimeout(() => play(s), ms))
    let delay = 0
    for (const f of v.fx.filter((x) => x.seq > seen.current)) {
      switch (f.kind) {
        case 'shoot':
          later('gunshot', FIRE_DELAY + delay)
          delay += 150
          break
        case 'miss':
          later('ricochet', 60)
          break
        case 'hit':
          later('grunt', 40)
          break
        case 'heal':
          play('gulp')
          break
        case 'explode':
          play('boom')
          break
        case 'death':
          later('death', 200)
          break
        case 'check':
          play('flip')
          break
        case 'equip':
          play('clink')
          break
        case 'play':
          play(f.card?.key === 'gatling' ? 'counter' : 'card')
          break
        case 'steal':
          play('hop')
          break
        case 'turn':
          play(f.to === v.me ? 'myTurn' : 'turn')
          break
      }
    }
    if (v.fx.length) seen.current = Math.max(seen.current, v.fx[v.fx.length - 1].seq)
    // 輪到你回應
    const d = v.decision
    const key = d?.type === 'ask' ? `${d.ask.kind}-${d.ask.prompt}` : ''
    if (key && key !== prevDecision.current) play('prompt')
    prevDecision.current = key
    if (v.result && !prevResult.current) later(v.result.winners.includes(v.me) ? 'win' : 'lose', 600)
    prevResult.current = !!v.result
  }, [v])

  const chatLen = chat?.length ?? 0
  const seenChat = useRef(chatLen)
  useEffect(() => {
    if (chat && chatLen > seenChat.current) {
      const last = chat[chatLen - 1]
      if (!last.system && last.clientId !== myClientId) play('chat')
    }
    seenChat.current = chatLen
  }, [chat, chatLen, myClientId])
}

export function useSoundOn(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(onSoundChange, soundOn, soundOn)
  return [on, setSoundOn]
}
