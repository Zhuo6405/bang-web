import { useEffect, useRef, useState } from 'react'
import type { ChatMsg } from '../../shared/protocol'
import type { VoiceMesh } from '../net/voice'
import { useStore } from './controller'
import { t, tx } from '../lang'

export function ChatPanel({ chat, me, say }: { chat: ChatMsg[]; me: string; say: (t: string) => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.length])
  const send = () => {
    const msg = text.trim()
    if (!msg) return
    say(msg)
    setText('')
  }
  return (
    <div className="chat">
      <ol className="chat-list" ref={ref} aria-label={t('聊天', 'Chat')} aria-live="polite">
        {chat.length === 0 && <li className="chat-empty">{t('還沒有人說話。打聲招呼吧。', 'Nobody has said anything yet. Say hello.')}</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.system ? 'is-system' : m.clientId === me ? 'is-me' : ''}>
            {!m.system && <b>{tx(m.name)}</b>}
            <span>{m.system ? tx(m.text) : m.text}</span>
          </li>
        ))}
      </ol>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder={t('輸入訊息，Enter 送出', 'Type a message, Enter to send')} aria-label={t('聊天訊息', 'Chat message')} />
        <button type="submit" disabled={!text.trim()}>
          {t('送出', 'Send')}
        </button>
      </form>
    </div>
  )
}

export function VoiceControls({ voice, speakers }: { voice: VoiceMesh | null; speakers: number }) {
  useStore(voice ?? NOOP)
  if (!voice) return null
  if (!voice.on) {
    return (
      <span className="voice">
        <button type="button" onClick={() => void voice.enable()} title={t('開啟麥克風加入語音', 'Turn on your microphone to join voice')}>
          {t('加入語音', 'Join voice')}
          {speakers > 0 ? t(`（${speakers} 人在線）`, ` (${speakers} on)`) : ''}
        </button>
        {voice.error && <span className="voice-err">{voice.error}</span>}
      </span>
    )
  }
  return (
    <span className="voice is-on">
      <span className="voice-dot" aria-hidden />
      <span className="voice-n">{t(`語音 ${voice.connectedCount + 1} 人`, `Voice: ${voice.connectedCount + 1}`)}</span>
      <button type="button" onClick={() => voice.setMuted(!voice.muted)} aria-pressed={voice.muted}>
        {voice.muted ? t('取消靜音', 'Unmute') : t('靜音', 'Mute')}
      </button>
      <button type="button" className="ghost" onClick={() => voice.disable()}>
        {t('離開語音', 'Leave voice')}
      </button>
    </span>
  )
}

const NOOP = { subscribe: () => () => {}, version: 0 }
