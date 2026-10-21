import { useState } from 'react'
import { AI_NAMES, EXPANSIONS, maxPlayersFor, MIN_PLAYERS } from '../../engine/data'
import { AI_NAMES_EN, expName, roleName } from '../../engine/i18n'
import { getLang, LangToggle, t, tx } from '../lang'
import type { GameConfig } from '../../engine/types'
import { DocsButtons } from './Docs'
import { normaliseCode } from '../../shared/protocol'
import { clearHistory, loadHistory } from './history'

export type AiLevel = 'easy' | 'normal' | 'hard'
function storedLevel(): AiLevel {
  try {
    const v = localStorage.getItem('bang-level')
    if (v === 'easy' || v === 'normal' || v === 'hard') return v
  } catch {
    /* ignore */
  }
  return 'normal'
}

/** 電腦難度 */
export function LevelPicker({ value, onChange, readOnly }: { value: AiLevel; onChange?: (v: AiLevel) => void; readOnly?: boolean }) {
  const opts: { id: AiLevel; zh: string; en: string; hintZh: string; hintEn: string }[] = [
    { id: 'easy', zh: '簡單', en: 'Easy', hintZh: '常猜錯、偶爾忘了出牌', hintEn: 'Often guesses wrong, sometimes forgets to play' },
    { id: 'normal', zh: '普通', en: 'Normal', hintZh: '會推理身分、會記仇', hintEn: 'Reasons about roles and holds grudges' },
    { id: 'hard', zh: '困難', en: 'Hard', hintZh: '推理更準、懂得補刀', hintEn: 'Sharper reasoning, finishes off the wounded' },
  ]
  const cur = opts.find((o) => o.id === value) ?? opts[1]
  return (
    <div className="field">
      <span>{t('電腦難度', 'Computer difficulty')}</span>
      <div className="segmented" role="radiogroup" aria-label={t('電腦難度', 'Computer difficulty')}>
        {opts.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={o.id === value} className={o.id === value ? 'on' : ''} disabled={readOnly} onClick={() => onChange?.(o.id)}>
            {t(o.zh, o.en)}
          </button>
        ))}
      </div>
      <small className="muted">{t(cur.hintZh, cur.hintEn)}</small>
    </div>
  )
}

function storedName() {
  try {
    return localStorage.getItem('bang-name') ?? ''
  } catch {
    return ''
  }
}

export function Lobby({
  onLocal,
  onOnline,
}: {
  onLocal: (cfg: GameConfig) => void
  onOnline: (code: string, name: string, create: boolean) => void
}) {
  const urlRoom = normaliseCode(new URLSearchParams(location.search).get('room') ?? '')
  const [name, setName] = useState(storedName)
  const [code, setCode] = useState(urlRoom)
  const [count, setCount] = useState(5)
  const [expansions, setExpansions] = useState<string[]>([])
  const [level, setLevel] = useState<AiLevel>(storedLevel)
  const [nameErr, setNameErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const [netErr, setNetErr] = useState<string | null>(null)
  const [history, setHistory] = useState(loadHistory)

  const myName = () => {
    const n = name.trim()
    try {
      if (n) localStorage.setItem('bang-name', n)
    } catch {
      /* ignore */
    }
    return n
  }

  const needName = () => {
    const n = myName()
    if (!n) setNameErr(true)
    return n
  }

  const startLocal = () => {
    const me = myName() || t('我', 'Me')
    const names = [...(getLang() === 'en' ? AI_NAMES_EN : AI_NAMES)].filter((x) => x !== me).sort(() => Math.random() - 0.5)
    // 座位隨機：你不一定坐第一個
    const seat = Math.floor(Math.random() * count)
    const seated = names.slice(0, count - 1)
    seated.splice(seat, 0, me)
    onLocal({
      names: seated,
      ai: seated.map((_, i) => i !== seat),
      seed: (Math.random() * 2 ** 31) | 0,
      expansions,
      aiLevel: level,
    })
  }

  return (
    <main className="lobby">
      <header className="lobby-title">
        <h1>BANG!</h1>
        <p>{t('西部槍戰身份卡牌遊戲', 'The Wild West card game of hidden roles')}</p>
        <DocsButtons />
        <LangToggle />
      </header>

      <label className={`field name-field ${nameErr ? 'has-error' : ''}`}>
        <span>{t('你的名字', 'Your name')}</span>
        <input
          value={name}
          maxLength={12}
          placeholder={t('輸入暱稱', 'Enter a nickname')}
          autoFocus={!!urlRoom}
          onChange={(e) => {
            setName(e.target.value)
            setNameErr(false)
          }}
        />
        {nameErr && <small className="err">{t('連線遊戲需要先輸入名字。', 'Enter a name to play online.')}</small>}
      </label>

      {urlRoom && (
        <section className="lobby-panel is-invite" aria-label={t('受邀加入房間', 'Room invitation')}>
          <h2>{t(`你被邀請加入房間 ${urlRoom}`, `You have been invited to room ${urlRoom}`)}</h2>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const n = needName()
              if (n) onOnline(urlRoom, n, false)
            }}
          >
            {t('加入房間', 'Join room')}
          </button>
        </section>
      )}

      <section className="lobby-panel" aria-label={t('和朋友連線', 'Play with friends')}>
        <h2>{t('和朋友連線', 'Play with friends')}</h2>
        <div className="online-row">
          <div>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                const n = needName()
                if (!n) return
                setBusy(true)
                setNetErr(null)
                fetch('/api/new')
                  .then((r) => r.json() as Promise<{ code: string }>)
                  .then(({ code }) => onOnline(code, n, true))
                  .catch(() => setNetErr(t('連不到遊戲伺服器，請檢查網路後再試。', 'Cannot reach the game server. Check your connection and try again.')))
                  .finally(() => setBusy(false))
              }}
            >
              {t('建立房間', 'Create room')}
            </button>
            <p className="muted">{t('遊戲在雲端伺服器進行，任何網路都能連。', 'Games run on a cloud server, so any network works.')}</p>
          </div>
          <form
            className="join"
            onSubmit={(e) => {
              e.preventDefault()
              const n = needName()
              const c = normaliseCode(code)
              if (n && c) onOnline(c, n, false)
            }}
          >
            <input value={code} onChange={(e) => setCode(normaliseCode(e.target.value))} placeholder={t('邀請碼', 'Invite code')} aria-label={t('邀請碼', 'Invite code')} maxLength={8} />
            <button type="submit" disabled={!normaliseCode(code)}>
              {t('加入', 'Join')}
            </button>
          </form>
        </div>
        {netErr && <p className="err">{netErr}</p>}
      </section>

      <section className="lobby-panel" aria-label={t('單機對戰 AI', 'Play against the computer')}>
        <h2>{t('單機對戰 AI', 'Play against the computer')}</h2>
        <div className="field">
          <span>{t('遊戲人數（含你）', 'Players (including you)')}</span>
          <div className="segmented" role="radiogroup" aria-label={t('遊戲人數', 'Number of players')}>
            {Array.from({ length: maxPlayersFor(expansions) - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={n === count} className={n === count ? 'on' : ''} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <ExpansionPicker
          value={expansions}
          onChange={(x) => {
            setExpansions(x)
            if (count > maxPlayersFor(x)) setCount(maxPlayersFor(x))
          }}
        />

        <LevelPicker
          value={level}
          onChange={(x) => {
            setLevel(x)
            try {
              localStorage.setItem('bang-level', x)
            } catch {
              /* ignore */
            }
          }}
        />

        <button type="button" className="primary" onClick={startLocal}>
          {t('開始單機遊戲', 'Start game')}
        </button>
      </section>

      {history.length > 0 && (
        <section className="lobby-panel" aria-label={t('最近對局', 'Recent games')}>
          <h2>{t('最近對局', 'Recent games')}</h2>
          <ul className="history">
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <span className={`h-result ${h.won ? 'is-win' : ''}`}>{h.won ? t('勝', 'Won') : t('敗', 'Lost')}</span>
                <span className="h-meta">
                  {new Date(h.at).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'zh-TW', { month: getLang() === 'en' ? 'short' : 'numeric', day: 'numeric' })}．{h.mode === 'online' ? t('連線', 'Online') : t('單機', 'Solo')}．
                  {t(`${h.players.length} 人`, `${h.players.length} players`)}．{t('你是', 'You were ')}
                  {h.myRole ? roleName(h.myRole, getLang()) : '—'}
                </span>
                <span className="h-reason">{tx(h.reason)}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              clearHistory()
              setHistory([])
            }}
          >
            {t('清除紀錄', 'Clear history')}
          </button>
        </section>
      )}

      <footer className="lobby-foot">
        {t('基本版與道奇城、正午、一把卡牌、淘金熱、幽谷、西部秀已實裝；全副武裝製作中。', 'Includes the base game, Dodge City, High Noon, A Fistful of Cards, Gold Rush, The Valley of Shadows and Wild West Show. Armed & Dangerous is in progress.')}
      </footer>
    </main>
  )
}

export function ExpansionPicker({ value, onChange, readOnly }: { value: string[]; onChange?: (v: string[]) => void; readOnly?: boolean }) {
  return (
    <div className="field">
      <span>{t('擴充', 'Expansions')}</span>
      <div className="expansions">
        {EXPANSIONS.map((e) => {
          const on = value.includes(e.id)
          return (
            <label key={e.id} className={`check exp ${e.ready ? '' : 'is-disabled'}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={!e.ready || readOnly}
                onChange={(ev) => onChange?.(ev.target.checked ? [...value, e.id] : value.filter((x) => x !== e.id))}
              />
              <span>
                {expName(e.id, getLang())}
                {!e.ready && <small>{t('即將推出', 'Coming soon')}</small>}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
