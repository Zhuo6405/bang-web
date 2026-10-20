import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { GameView } from '../../engine/view'
import type { ChatMsg } from '../../shared/protocol'
import { onSoundChange, play, setSoundOn, soundOn, type Sfx } from '../sound'

import { GUN } from '../three/gunTiming'

const ms = (sec: number) => Math.round(sec * 1000)

/** 依引擎的 fx 事件發出音效 */
export function useGameSounds(v: GameView, chat: ChatMsg[] | undefined, myClientId: string | undefined) {
  const seen = useRef(-1)
  const prevDecision = useRef<string>('')
  const prevResult = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  /** 每個人最近一槍的開火時間（毫秒時間戳），連發時不再裝子彈 */
  const lastShot = useRef(new Map<number, number>())
  /** 每個「開槍者→目標」預定的開火時間，中彈／躲開的聲音要排在後面 */
  const pending = useRef(new Map<string, number>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    if (seen.current < 0) {
      seen.current = v.fx.length ? v.fx[v.fx.length - 1].seq : 0
      prevResult.current = !!v.result
      return
    }
    const later = (s: Sfx, delay: number) => timers.current.push(setTimeout(() => play(s), Math.max(0, delay)))
    const now = Date.now()
    /** 等子彈射出去之後才播的聲音 */
    const afterShot = (from: number | undefined, to: number | undefined) => {
      if (from == null || to == null) return 0
      const at = pending.current.get(`${from}-${to}`)
      return at && at > now ? at - now + 60 : 0
    }
    let stagger = 0
    for (const f of v.fx.filter((x) => x.seq > seen.current)) {
      switch (f.kind) {
        case 'shoot': {
          if (f.from == null) break
          const prev = lastShot.current.get(f.from) ?? 0
          let at: number
          if (prev + ms(GUN.hold) > now + stagger) {
            // 槍還在手上：直接接著開
            at = Math.max(prev + ms(GUN.repeat), now + stagger)
          } else {
            const t0 = now + stagger
            at = t0 + ms(GUN.fire)
            later('cylOpen', t0 - now + ms(GUN.open[0]))
            GUN.rounds.forEach(([, done]) => later('load', t0 - now + ms(done)))
            later('spin', t0 - now + ms(GUN.spin[0]))
            later('cylClose', t0 - now + ms(GUN.close))
            later('cock', t0 - now + ms(GUN.cock[0]))
          }
          lastShot.current.set(f.from, at)
          if (f.to != null) pending.current.set(`${f.from}-${f.to}`, at)
          later('gunshot', at - now)
          stagger += 150
          break
        }
        case 'miss':
          later('ricochet', afterShot(f.from, f.to) + 60)
          break
        case 'hit':
          later('grunt', afterShot(f.from, f.to) + 40)
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
