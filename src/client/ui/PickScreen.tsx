import { useEffect, useMemo, useRef, useState } from 'react'
import { CHAR_BY_ID, EXPANSIONS, ROLE_GOAL } from '../../engine/data'
import type { Action, CoinDuel } from '../../engine/types'
import type { GameView } from '../../engine/view'
import { play } from '../sound'
import { RoleBadge } from './components'
import { useSecondsLeft } from './controller'

const SET_NAME: Record<string, string> = { base: '基本版', ...Object.fromEntries(EXPANSIONS.map((e) => [e.id, e.name])) }
const SET_ORDER = ['base', ...EXPANSIONS.map((e) => e.id)]

/** 開局選角：所有可選角色攤開，看得到別人選了誰；撞角就擲硬幣 */
export function CharacterPick({ v, act, deadline }: { v: GameView; act: (a: Action) => void; deadline: number | null }) {
  const pk = v.pick!
  const me = v.players[v.me]
  const left = useSecondsLeft(deadline)
  const sheriff = v.players.find((p) => p.role === 'sheriff')
  const canPick = v.decision?.type === 'choose_character'
  const options = useMemo(() => new Set(v.decision?.type === 'choose_character' ? v.decision.options : []), [v.decision])
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => setSel(null), [pk.round])
  const sent = pk.picks[v.me]
  const bonus = me.role === 'sheriff' ? 1 : 0

  const groups = useMemo(() => {
    const by = new Map<string, string[]>()
    for (const id of pk.pool) {
      const set = CHAR_BY_ID[id].set
      by.set(set, [...(by.get(set) ?? []), id])
    }
    return SET_ORDER.filter((s) => by.has(s)).map((s) => ({ set: s, ids: by.get(s)! }))
  }, [pk.pool])

  const pickersOf = (id: string) => v.players.filter((p) => !p.character && pk.picks[p.seat] === id)
  const confirm = () => {
    if (!sel) return
    play('click')
    act({ type: 'choose_character', character: sel })
  }

  return (
    <main className="pick pick-free">
      <h1>挑選你的角色</h1>
      <p className="pick-sub">
        你的身份是 <RoleBadge role={me.role!} />：{ROLE_GOAL[me.role!]}
        {sheriff && sheriff.seat !== v.me && `　警長是 ${sheriff.name}。`}
        {bonus > 0 && '　你是警長，生命 +1。'}
        {left != null && <span className="countdown">剩 {left} 秒</span>}
      </p>
      <p className="pick-rule">
        第 {pk.round} 輪．發光的角色代表有人選了。兩人選到同一個角色就擲硬幣，人頭的拿到；三人以上每人擲 3 枚，人頭最多的拿到。沒拿到的人從剩下的角色再選。
      </p>

      <ul className="pick-status" aria-label="大家的選擇">
        {v.players.map((p) => {
          const c = p.character ?? pk.picks[p.seat]
          return (
            <li key={p.seat} className={p.character ? 'is-done' : pk.picks[p.seat] ? 'is-sent' : ''}>
              <b>{p.seat === v.me ? '你' : p.name}</b>
              <span>{p.character ? `定案：${CHAR_BY_ID[p.character].name}` : c ? `選了 ${CHAR_BY_ID[c].name}` : '挑選中…'}</span>
            </li>
          )
        })}
      </ul>

      {groups.map((g) => (
        <section key={g.set} className="pick-group">
          <h2>{SET_NAME[g.set] ?? g.set}</h2>
          <div className="pick-grid">
            {g.ids.map((id) => {
              const c = CHAR_BY_ID[id]
              const owner = pk.locked[id]
              const pickers = pickersOf(id)
              const mine = sent === id || me.character === id
              const others = pickers.filter((p) => p.seat !== v.me)
              const can = canPick && options.has(id)
              const cls = [
                'pc',
                owner != null ? 'is-locked' : '',
                others.length ? 'is-picked' : '',
                mine ? 'is-mine' : '',
                sel === id ? 'is-sel' : '',
                pickers.length > 1 ? 'is-clash' : '',
              ].join(' ')
              return (
                <button
                  key={id}
                  type="button"
                  className={cls}
                  disabled={!can && !mine}
                  aria-pressed={sel === id}
                  onClick={() => can && setSel(id)}
                  onDoubleClick={() => {
                    if (can) {
                      play('click')
                      act({ type: 'choose_character', character: id })
                    }
                  }}
                >
                  <span className="pc-head">
                    <span className="pc-name">{c.name}</span>
                    <span className="pc-hp" aria-label={`生命 ${c.hp + bonus}`}>
                      {Array.from({ length: c.hp + bonus }, (_, i) => (
                        <span key={i} className={i >= c.hp ? 'bullet on extra' : 'bullet on'} />
                      ))}
                      <small>{c.hp}{bonus ? '+1' : ''}</small>
                    </span>
                  </span>
                  <span className="pc-text">{c.text}</span>
                  {(owner != null || pickers.length > 0) && (
                    <span className="pc-tags">
                      {owner != null && <span className="pc-tag lock">{owner === v.me ? '你的角色' : `${v.players[owner].name} 已定案`}</span>}
                      {pickers.map((p) => (
                        <span key={p.seat} className={`pc-tag ${p.seat === v.me ? 'me' : ''}`}>
                          {p.seat === v.me ? '你選了' : `${p.name} 選了`}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <div className="pick-bar">
        {canPick ? (
          sel ? (
            <>
              <span>
                <b>{CHAR_BY_ID[sel].name}</b>
                {pickersOf(sel).length > 0 && `（已經有 ${pickersOf(sel).length} 人選了，會擲硬幣）`}
              </span>
              <button type="button" className="primary" onClick={confirm}>
                選定這個角色
              </button>
            </>
          ) : (
            <span>點一個角色看清楚，再按「選定」；也可以直接點兩下。</span>
          )
        ) : me.character ? (
          <span>
            你拿到了 <b>{CHAR_BY_ID[me.character].name}</b>，等其他人選完…
          </span>
        ) : sent ? (
          <span>
            已送出 <b>{CHAR_BY_ID[sent].name}</b>，等其他人選完…
          </span>
        ) : (
          <span>等待中…</span>
        )}
      </div>
    </main>
  )
}

const FLIP = 1.1 // 一輪硬幣翻轉的秒數
const GAP = 0.5

/** 撞角時的擲硬幣動畫：選角畫面和牌桌都會顯示一次 */
export function DuelOverlay({ v }: { v: GameView }) {
  const pk = v.pick
  const key = pk && pk.duels.length ? `${pk.round}` : null
  const [shown, setShown] = useState<string | null>(null)
  const seen = useRef(new Set<string>())
  useEffect(() => {
    if (key && !seen.current.has(key)) {
      seen.current.add(key)
      setShown(key)
    }
  }, [key])
  const duels = shown && pk && shown === key ? pk.duels : null
  const total = duels ? Math.max(...duels.map((d) => d.rounds.length)) * (FLIP + GAP) : 0
  useEffect(() => {
    if (!duels) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const rounds = Math.max(...duels.map((d) => d.rounds.length))
    for (let r = 0; r < rounds; r++) {
      timers.push(setTimeout(() => play('coin'), r * (FLIP + GAP) * 1000))
      timers.push(setTimeout(() => play('coinLand'), (r * (FLIP + GAP) + FLIP) * 1000))
    }
    timers.push(setTimeout(() => setShown(null), (total + 4) * 1000))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])
  if (!duels) return null
  return (
    <div className="duel-backdrop" role="dialog" aria-label="擲硬幣決定角色" onClick={() => setShown(null)}>
      <div className="duel" onClick={(e) => e.stopPropagation()}>
        <h2>撞角了！擲硬幣</h2>
        {duels.map((d) => (
          <Duel key={d.char} d={d} v={v} />
        ))}
        <button type="button" className="primary" onClick={() => setShown(null)}>
          繼續
        </button>
      </div>
    </div>
  )
}

function Duel({ d, v }: { d: CoinDuel; v: GameView }) {
  const name = CHAR_BY_ID[d.char].name
  const end = d.rounds.length * (FLIP + GAP)
  return (
    <section className="duel-one">
      <h3>【{name}】{d.seats.map((s) => v.players[s].name).join(' vs ')}</h3>
      {d.rounds.map((round, r) => {
        const heads = round.map((f) => f.coins.filter(Boolean).length)
        const best = Math.max(...heads)
        const top = round.filter((_, i) => heads[i] === best)
        const single = round[0].coins.length === 1
        const note = single
          ? top.length === 1
            ? `${v.players[top[0].seat].name} 擲出人頭`
            : best
              ? '都是人頭，重擲'
              : '都是反面，重擲'
          : top.length === 1
            ? `${v.players[top[0].seat].name} 人頭最多（${best} 個）`
            : `${top.map((f) => v.players[f.seat].name).join('、')} 平手，再擲`
        const delay = r * (FLIP + GAP)
        return (
          <div key={r} className="duel-round" style={{ animationDelay: `${delay}s` }}>
            {round.map((f) => (
              <div key={f.seat} className="duel-row">
                <span className="duel-who">{f.seat === v.me ? '你' : v.players[f.seat].name}</span>
                <span className="coins">
                  {f.coins.map((h, i) => (
                    <span
                      key={i}
                      className="coin"
                      style={{ animationDelay: `${delay + i * 0.08}s`, ['--end' as string]: h ? '1800deg' : '1980deg' }}
                      aria-label={h ? '人頭' : '反面'}
                    >
                      <span className="coin-face heads">人頭</span>
                      <span className="coin-face tails">反面</span>
                    </span>
                  ))}
                </span>
              </div>
            ))}
            <p className="duel-note" style={{ animationDelay: `${delay + FLIP}s` }}>
              {note}
            </p>
          </div>
        )
      })}
      <p className="duel-win" style={{ animationDelay: `${end}s` }}>
        {d.winner === v.me ? '你' : v.players[d.winner].name} 拿到【{name}】
      </p>
    </section>
  )
}
