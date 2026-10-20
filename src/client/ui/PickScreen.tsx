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

/** 擲硬幣的時間軸（秒）：一個人擲完再換下一個，每輪結束停一下，最後公布誰拿到 */
const COIN = 1.4 // 一枚硬幣翻轉落地
const PER = 1.7 // 下一個人開始擲的間隔
const COIN_GAP = 0.25 // 同一人多枚硬幣的間隔
const NOTE = 0.3 // 這一輪擲完後多久顯示結果
const HOLD = 1.8 // 顯示結果後停多久才進下一輪
const WIN_HOLD = 1.5 // 公布後停留

interface Step {
  /** 每個人開始擲的時間 */
  flips: { seat: number; coins: boolean[]; at: number }[]
  note: number
}
interface Timeline {
  rounds: Step[]
  win: number
  end: number
}

function timeline(d: CoinDuel, start: number): Timeline {
  let t = start
  const rounds: Step[] = []
  for (const round of d.rounds) {
    const flips = round.map((f) => {
      const at = t
      t += PER + (f.coins.length - 1) * COIN_GAP
      return { ...f, at }
    })
    const note = t - PER + COIN + NOTE
    rounds.push({ flips, note })
    t = note + HOLD
  }
  return { rounds, win: t - HOLD + 0.6, end: t - HOLD + 0.6 + WIN_HOLD }
}

/** 撞角時的擲硬幣動畫：選角畫面和牌桌都會顯示一次，看完按「繼續」才關 */
export function DuelOverlay({ v }: { v: GameView }) {
  const pk = v.pick
  // 中途重新整理進來的話，之前的擲硬幣就不再重播
  const seen = useRef(v.phase === 'choose' ? 0 : Number.POSITIVE_INFINITY)
  const [duels, setDuels] = useState<CoinDuel[] | null>(null)
  const [done, setDone] = useState(false)
  const latest = pk?.duels.length ? Math.max(...pk.duels.map((d) => d.round)) : 0
  useEffect(() => {
    if (duels || !pk || latest <= seen.current) return
    const fresh = pk.duels.filter((d) => d.round > seen.current)
    seen.current = latest
    setDone(false)
    setDuels(fresh)
  }, [latest, duels, pk])
  const close = () => setDuels(null)
  const shown = duels
  // 多組撞角依序播放
  const lines = useMemo(() => {
    if (!duels) return []
    let t = 0.6
    return duels.map((d) => {
      const tl = timeline(d, t)
      t = tl.end + 0.8
      return tl
    })
  }, [duels])
  const total = lines.length ? lines[lines.length - 1].end : 0
  useEffect(() => {
    if (!duels) return
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const tl of lines)
      for (const r of tl.rounds)
        for (const f of r.flips)
          f.coins.forEach((_, i) => {
            const at = f.at + i * COIN_GAP
            timers.push(setTimeout(() => play('coin'), at * 1000))
            timers.push(setTimeout(() => play('coinLand'), (at + COIN) * 1000))
          })
    timers.push(setTimeout(() => setDone(true), total * 1000))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])
  if (!duels) return null
  return (
    <div className="duel-backdrop" role="dialog" aria-label="擲硬幣決定角色">
      <div className="duel">
        <h2>撞角了！擲硬幣決定</h2>
        {duels.map((d, i) => (
          <Duel key={`${d.round}-${d.char}`} d={d} v={v} tl={lines[i]} />
        ))}
        <button type="button" className={done ? 'primary' : 'ghost'} onClick={close}>
          {done ? '知道了，繼續' : '跳過動畫'}
        </button>
      </div>
    </div>
  )
}

function Duel({ d, v, tl }: { d: CoinDuel; v: GameView; tl: Timeline }) {
  const name = CHAR_BY_ID[d.char].name
  const who = (s: number) => (s === v.me ? '你' : v.players[s].name)
  return (
    <section className="duel-one" style={{ animationDelay: `${tl.rounds[0].flips[0].at - 0.5}s` }}>
      <h3>
        【{name}】{d.seats.map(who).join(' vs ')}
      </h3>
      {d.rounds.map((round, r) => {
        const step = tl.rounds[r]
        const heads = round.map((f) => f.coins.filter(Boolean).length)
        const best = Math.max(...heads)
        const top = round.filter((_, i) => heads[i] === best)
        const single = round[0].coins.length === 1
        const note = single
          ? top.length === 1
            ? `${who(top[0].seat)} 擲出人頭！`
            : best
              ? '兩個都是人頭，重擲'
              : '兩個都是反面，重擲'
          : top.length === 1
            ? `${who(top[0].seat)} 人頭最多（${best} 個）！`
            : `${top.map((f) => who(f.seat)).join('、')} 平手（${best} 個人頭），再擲`
        return (
          <div key={r} className="duel-round" style={{ animationDelay: `${step.flips[0].at - 0.3}s` }}>
            {d.rounds.length > 1 && <p className="duel-no">第 {r + 1} 次</p>}
            {step.flips.map((f, j) => {
              const h = heads[j]
              const last = r === d.rounds.length - 1
              const res = last ? (f.seat === d.winner ? 'is-win' : 'is-lose') : ''
              return (
                <div key={f.seat} className={`duel-row ${res}`} style={{ ['--res-at' as string]: `${tl.win}s` }}>
                  <span className="duel-who">{who(f.seat)}</span>
                  <span className="coins">
                    {f.coins.map((c, i) => (
                      <span
                        key={i}
                        className="coin"
                        style={{ animationDelay: `${f.at + i * COIN_GAP}s`, ['--end' as string]: c ? '2160deg' : '2340deg' }}
                        aria-label={c ? '人頭' : '反面'}
                      >
                        <span className="coin-face heads">人頭</span>
                        <span className="coin-face tails">反面</span>
                      </span>
                    ))}
                  </span>
                  <span className="duel-count" style={{ animationDelay: `${f.at + (f.coins.length - 1) * COIN_GAP + COIN}s` }}>
                    {f.coins.length > 1 ? `${h} 個人頭` : h ? '人頭' : '反面'}
                  </span>
                  {last && <span className="duel-res">{f.seat === d.winner ? '拿到了！' : '沒選到'}</span>}
                </div>
              )
            })}
            <p className="duel-note" style={{ animationDelay: `${step.note}s` }}>
              {note}
            </p>
          </div>
        )
      })}
      <div className="duel-win" style={{ animationDelay: `${tl.win}s` }}>
        <span>
          <b>{who(d.winner)}</b> 拿到【{name}】
        </span>
        {d.seats.filter((s) => s !== d.winner).length > 0 && (
          <small>
            {d.seats
              .filter((s) => s !== d.winner)
              .map(who)
              .join('、')}
            沒選到，要從剩下的角色重選
          </small>
        )}
      </div>
    </section>
  )
}
