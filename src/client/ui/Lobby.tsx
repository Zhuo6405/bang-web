import { useState } from 'react'
import { AI_NAMES, EXPANSIONS, MAX_PLAYERS, MIN_PLAYERS, ROLE_NAME } from '../../engine/data'
import type { GameConfig } from '../../engine/types'
import { DocsButtons } from './Docs'
import { normaliseCode } from '../../shared/protocol'
import { clearHistory, loadHistory } from './history'

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
    const me = myName() || '我'
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5)
    onLocal({
      names: [me, ...names.slice(0, count - 1)],
      ai: [false, ...Array(count - 1).fill(true)],
      seed: (Math.random() * 2 ** 31) | 0,
      expansions,
    })
  }

  return (
    <main className="lobby">
      <header className="lobby-title">
        <h1>BANG!</h1>
        <p>西部槍戰身份卡牌遊戲</p>
        <DocsButtons />
      </header>

      <label className={`field name-field ${nameErr ? 'has-error' : ''}`}>
        <span>你的名字</span>
        <input
          value={name}
          maxLength={12}
          placeholder="輸入暱稱"
          autoFocus={!!urlRoom}
          onChange={(e) => {
            setName(e.target.value)
            setNameErr(false)
          }}
        />
        {nameErr && <small className="err">連線遊戲需要先輸入名字。</small>}
      </label>

      {urlRoom && (
        <section className="lobby-panel is-invite" aria-label="受邀加入房間">
          <h2>你被邀請加入房間 {urlRoom}</h2>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const n = needName()
              if (n) onOnline(urlRoom, n, false)
            }}
          >
            加入房間
          </button>
        </section>
      )}

      <section className="lobby-panel" aria-label="和朋友連線">
        <h2>和朋友連線</h2>
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
                  .catch(() => setNetErr('連不到遊戲伺服器，請檢查網路後再試。'))
                  .finally(() => setBusy(false))
              }}
            >
              建立房間
            </button>
            <p className="muted">遊戲在雲端伺服器進行，任何網路都能連。</p>
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
            <input value={code} onChange={(e) => setCode(normaliseCode(e.target.value))} placeholder="邀請碼" aria-label="邀請碼" maxLength={8} />
            <button type="submit" disabled={!normaliseCode(code)}>
              加入
            </button>
          </form>
        </div>
        {netErr && <p className="err">{netErr}</p>}
      </section>

      <section className="lobby-panel" aria-label="單機對戰 AI">
        <h2>單機對戰 AI</h2>
        <div className="field">
          <span>遊戲人數（含你）</span>
          <div className="segmented" role="radiogroup" aria-label="遊戲人數">
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={n === count} className={n === count ? 'on' : ''} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <ExpansionPicker value={expansions} onChange={setExpansions} />

        <button type="button" className="primary" onClick={startLocal}>
          開始單機遊戲
        </button>
      </section>

      {history.length > 0 && (
        <section className="lobby-panel" aria-label="最近對局">
          <h2>最近對局</h2>
          <ul className="history">
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <span className={`h-result ${h.won ? 'is-win' : ''}`}>{h.won ? '勝' : '敗'}</span>
                <span className="h-meta">
                  {new Date(h.at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}．{h.mode === 'online' ? '連線' : '單機'}．
                  {h.players.length} 人．你是{h.myRole ? ROLE_NAME[h.myRole] : '—'}
                </span>
                <span className="h-reason">{h.reason}</span>
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
            清除紀錄
          </button>
        </section>
      )}

      <footer className="lobby-foot">基本版 80 張牌、16 位角色全部實裝。擴充陸續開放中。</footer>
    </main>
  )
}

export function ExpansionPicker({ value, onChange, readOnly }: { value: string[]; onChange?: (v: string[]) => void; readOnly?: boolean }) {
  return (
    <div className="field">
      <span>擴充</span>
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
                {e.name}
                {!e.ready && <small>即將推出</small>}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
