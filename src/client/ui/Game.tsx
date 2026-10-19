import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CARD_DEFS, CHAR_BY_ID, ROLE_GOAL, ROLE_NAME } from '../../engine/data'
import type { Action, AskView, Card, GameConfig, LegalPlay } from '../../engine/types'
import type { GameView } from '../../engine/view'
import { CardFace, RoleBadge } from './components'
import { useLocalController, useSecondsLeft, type GameController, type Social } from './controller'
import { DocsButtons } from './Docs'
import { recordResult } from './history'
import { ChatPanel, VoiceControls } from './social'
import { useGameSounds, useSoundOn } from './useGameSounds'

// 3D 場景比較大，進牌桌時才載入
const TableScene = lazy(() => import('../three/TableScene').then((m) => ({ default: m.TableScene })))

export function LocalGame({ config, onExit }: { config: GameConfig; onExit: () => void }) {
  const ctl = useLocalController(config)
  return (
    <GameScreen
      ctl={ctl}
      onExit={onExit}
      historyId={`local-${config.seed}`}
      resultActions={
        <button type="button" className="primary" onClick={onExit}>
          回到大廳
        </button>
      }
    />
  )
}

export function GameScreen({
  ctl,
  social,
  onExit,
  exitLabel = '離開',
  resultActions,
  historyId,
  topExtra,
}: {
  ctl: GameController
  social?: Social
  onExit: () => void
  exitLabel?: string
  resultActions: ReactNode
  historyId: string
  topExtra?: ReactNode
}) {
  const v = ctl.view
  useEffect(() => {
    if (v.result) recordResult(v, social ? 'online' : 'local', historyId)
  }, [v, social, historyId])
  if (v.phase === 'choose' && v.decision?.type === 'choose_character') {
    return <CharacterPick v={v} act={ctl.act} deadline={ctl.deadline} />
  }
  if (v.phase === 'choose') {
    return (
      <main className="pick">
        <p className="pick-wait">等待其他玩家挑選角色…</p>
      </main>
    )
  }
  return <Table ctl={ctl} social={social} onExit={onExit} exitLabel={exitLabel} resultActions={resultActions} topExtra={topExtra} />
}

function CharacterPick({ v, act, deadline }: { v: GameView; act: (a: Action) => void; deadline: number | null }) {
  const left = useSecondsLeft(deadline)
  const me = v.players[v.me]
  const sheriff = v.players.find((p) => p.role === 'sheriff')
  return (
    <main className="pick">
      <h1>挑選你的角色</h1>
      <p className="pick-sub">
        你的身份是 <RoleBadge role={me.role!} />：{ROLE_GOAL[me.role!]}
        {sheriff && sheriff.seat !== v.me && `　警長是 ${sheriff.name}。`}
        {left != null && <span className="countdown">剩 {left} 秒</span>}
      </p>
      <div className="pick-row">
        {v.myCharOptions.map((id) => {
          const c = CHAR_BY_ID[id]
          return (
            <button key={id} type="button" className="char-card" onClick={() => act({ type: 'choose_character', character: id })}>
              <span className="char-name">{c.name}</span>
              <span className="char-meta">
                生命 {c.hp}
                {me.role === 'sheriff' ? '（警長 +1）' : ''}
              </span>
              <span className="char-sec">能力</span>
              <span className="char-text">{c.text}</span>
              <span className="char-go">選擇{c.name}</span>
            </button>
          )
        })}
      </div>
    </main>
  )
}

function Table({
  ctl,
  social,
  onExit,
  exitLabel,
  resultActions,
  topExtra,
}: {
  ctl: GameController
  social?: Social
  onExit: () => void
  exitLabel: string
  resultActions: ReactNode
  topExtra?: ReactNode
}) {
  const v = ctl.view
  const [sel, setSel] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [sidMode, setSidMode] = useState(false)
  const [tab, setTab] = useState<'log' | 'chat'>('log')
  const [seenChat, setSeenChat] = useState(0)
  const [sideOpen, setSideOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'first' | 'overview'>(() => {
    try {
      return localStorage.getItem('bang-view') === 'overview' ? 'overview' : 'first'
    } catch {
      return 'first'
    }
  })
  const toggleView = () =>
    setViewMode((m) => {
      const next = m === 'first' ? 'overview' : 'first'
      try {
        localStorage.setItem('bang-view', next)
      } catch {
        /* ignore */
      }
      return next
    })
  useGameSounds(v, social?.chat, social?.me)
  const [soundOn, setSoundOn] = useSoundOn()
  const hurt = useHurtFlash(v)
  const me = v.players[v.me]
  const myChar = me.character ? CHAR_BY_ID[me.character] : null
  const d = v.decision
  const myMove = !!d

  useEffect(() => {
    const base = 'BANG!'
    document.title = v.result ? base : d?.type === 'play' ? '● 輪到你了｜BANG!' : d ? '● 需要你回應｜BANG!' : base
    return () => {
      document.title = base
    }
  }, [d, v.result])

  // 時機改變就取消選取
  const decKey = `${d?.type}-${v.turnNo}-${d?.type === 'ask' ? d.ask.kind + d.ask.prompt : ''}-${v.hand.length}`
  useEffect(() => {
    setSel(null)
    setPicked([])
    setSidMode(false)
  }, [decKey])
  const selCard = v.hand.find((c) => c.id === sel) ?? null
  const legalById = useMemo(() => {
    const m = new Map<number, LegalPlay[]>()
    for (const l of v.legal) m.set(l.card, [...(m.get(l.card) ?? []), l])
    return m
  }, [v.legal])

  const ask = d?.type === 'ask' ? d.ask : null
  const multiPick = sidMode ? { ids: v.hand.map((c) => c.id), max: 2 } : ask && ask.zone === 'hand' && ask.max > 1 && ask.kind === 'discard' ? { ids: ask.cards, max: ask.max } : null
  const quickPick = !sidMode && ask && ask.zone === 'hand' && ask.max === 1 && ask.kind !== 'discard'

  const clickCard = (c: Card) => {
    if (multiPick) {
      if (!multiPick.ids.includes(c.id)) return
      setPicked((ps) => (ps.includes(c.id) ? ps.filter((x) => x !== c.id) : ps.length < multiPick.max ? [...ps, c.id] : ps))
      return
    }
    if (quickPick && ask) {
      if (ask.cards.includes(c.id)) ctl.act({ type: 'answer', cards: [c.id] })
      return
    }
    setSel(sel === c.id ? null : c.id)
  }
  const usable = (c: Card) => {
    if (multiPick) return multiPick.ids.includes(c.id)
    if (ask) return ask.zone === 'hand' && ask.cards.includes(c.id)
    return legalById.has(c.id)
  }

  const chatLen = social?.chat.length ?? 0
  useEffect(() => {
    if (tab === 'chat') setSeenChat(chatLen)
  }, [tab, chatLen])
  const unread = Math.max(0, chatLen - seenChat)

  return (
    <div className="game">
      <header className="topbar">
        <span className="brand">BANG!</span>
        <span className="turn">
          第 {v.turnNo} 回合
          <b className={v.active === v.me ? 'turn-me' : ''}>{v.active === v.me ? '你的回合' : `${v.players[v.active].name} 的回合`}</b>
        </span>
        {social && <VoiceControls voice={social.voice} speakers={social.room.members.filter((m) => m.inVoice).length} />}
        {topExtra}
        <button type="button" className="ghost sound-btn" onClick={() => setSoundOn(!soundOn)} aria-pressed={soundOn}>
          {soundOn ? '音效 開' : '音效 關'}
        </button>
        <DocsButtons />
        <button type="button" className="ghost side-toggle" onClick={() => setSideOpen((o) => !o)} aria-expanded={sideOpen}>
          {sideOpen ? '收起' : '紀錄與聊天'}
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        <button type="button" className="ghost" onClick={onExit}>
          {exitLabel}
        </button>
      </header>

      <div className="layout">
        <section className={`stage ${hurt ? 'is-hurt' : ''}`} aria-label="牌桌（可拖曳轉動視角）">
          <Suspense fallback={<div className="stage-loading">酒館佈置中…</div>}>
            <TableScene v={v} waitingOn={ctl.waitingOn} aiControlled={ctl.aiControlled} mode={viewMode} selected={sel} />
          </Suspense>
          <div className="stage-hud">
            <MyStatus v={v} />
            <p className="stage-piles">
              牌堆 {v.deckCount}．拖曳可{viewMode === 'first' ? '轉頭' : '旋轉視角'}
            </p>
          </div>
          <div className="stage-view">
            <button type="button" onClick={toggleView} aria-pressed={viewMode === 'overview'}>
              {viewMode === 'first' ? '切換到俯瞰視角' : '切換到第一人稱'}
            </button>
          </div>
        </section>

        <aside className={`side ${sideOpen ? 'is-open' : ''}`}>
          <div className="me-card">
            <div className="me-row">
              {me.role && <RoleBadge role={me.role} />}
              <b>{myChar?.name ?? '—'}</b>
            </div>
            {me.role && <p className="me-mission">勝利條件：{ROLE_GOAL[me.role]}</p>}
            {myChar && <p className="me-mission">角色能力：{myChar.text}</p>}
          </div>
          <Roster v={v} />
          {social && (
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
                遊戲紀錄
              </button>
              <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
                聊天{unread > 0 && <span className="badge">{unread}</span>}
              </button>
            </div>
          )}
          {social && tab === 'chat' ? <ChatPanel chat={social.chat} me={social.me} say={social.say} /> : <Log v={v} />}
        </aside>
      </div>

      <section className={`bench ${myMove ? 'is-my-move' : ''}`} aria-label="你的手牌與行動">
        <Prompt
          v={v}
          ctl={ctl}
          selCard={selCard}
          legal={selCard ? (legalById.get(selCard.id) ?? []) : []}
          picked={picked}
          setPicked={setPicked}
          sidMode={sidMode}
          setSidMode={setSidMode}
          clear={() => {
            setSel(null)
            setPicked([])
            setSidMode(false)
          }}
        />
        <div className="hand" role="group" aria-label="手牌">
          {v.hand.length === 0 && <span className="muted">沒有手牌</span>}
          {v.hand.map((c) => (
            <CardFace key={c.id} card={c} selected={sel === c.id || picked.includes(c.id)} usable={usable(c)} onClick={() => clickCard(c)} />
          ))}
        </div>
      </section>

      {ctl.error && (
        <div className="toast" role="alert" onClick={ctl.clearError}>
          {ctl.error}
        </div>
      )}
      {v.result && <Result v={v} actions={resultActions} />}
    </div>
  )
}

/** 自己中彈時畫面邊緣閃紅 */
function useHurtFlash(v: GameView) {
  const [on, setOn] = useState(false)
  const seen = useRef(-1)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    const last = v.fx.length ? v.fx[v.fx.length - 1].seq : 0
    if (seen.current < 0) {
      seen.current = last
      return
    }
    const hit = v.fx.some((f) => f.seq > seen.current && (f.kind === 'hit' || f.kind === 'explode') && f.to === v.me)
    seen.current = last
    if (!hit) return
    setOn(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOn(false), 600)
  }, [v.fx, v.me])
  return on
}

function MyStatus({ v }: { v: GameView }) {
  const me = v.players[v.me]
  return (
    <div className="mystatus">
      <div className="plate-hp" aria-label={`你的生命 ${me.hp} / ${me.maxHp}`}>
        <span className="hp-label">生命</span>
        {Array.from({ length: me.maxHp }, (_, i) => (
          <span key={i} className={i < me.hp ? 'bullet on' : 'bullet'} />
        ))}
      </div>
      <div className="mystatus-row">
        射程 {v.myRange}
        {me.table.length > 0 && (
          <span className="plate-gear">
            {me.table.map((c) => (
              <span key={c.id} className={`gear g-${CARD_DEFS[c.key].colour}`} title={CARD_DEFS[c.key].desc}>
                {CARD_DEFS[c.key].name}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

/** 側欄：所有人的生命、距離、裝備 */
function Roster({ v }: { v: GameView }) {
  return (
    <div className="roster">
      <h3>牌桌上的人</h3>
      <ul>
        {v.players.map((p) => (
          <li key={p.seat} className={`${p.alive ? '' : 'is-out'} ${p.seat === v.active ? 'is-active' : ''}`}>
            <span className="r-name">
              {p.name}
              {p.seat === v.me && <span className="seat-you">你</span>}
            </span>
            <span className="r-char">{p.character ? CHAR_BY_ID[p.character].name : ''}</span>
            {p.role && <RoleBadge role={p.role} />}
            <span className="r-hp">
              {p.alive ? `♥ ${p.hp}/${p.maxHp}` : '已死亡'}
              {p.alive && p.seat !== v.me && v.players[v.me].alive && <span className={`plate-dist ${p.dist <= v.myRange ? 'in-range' : ''}`}>距 {p.dist}</span>}
            </span>
            {p.table.length > 0 && (
              <span className="r-gear">
                {p.table.map((c) => (
                  <span key={c.id} className={`gear g-${CARD_DEFS[c.key].colour}`} title={CARD_DEFS[c.key].desc}>
                    {CARD_DEFS[c.key].name}
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function describeOthers(v: GameView, waitingOn: number[]): string {
  if (v.result) return '遊戲結束'
  const who = waitingOn.filter((p) => p !== v.me)
  if (who.length === 0) return '結算中…'
  const name = v.players[who[0]].name
  if (who[0] === v.active) return `等待 ${name} 出牌…`
  return `等待 ${name} 回應…`
}

function Prompt({
  v,
  ctl,
  selCard,
  legal,
  picked,
  setPicked,
  sidMode,
  setSidMode,
  clear,
}: {
  v: GameView
  ctl: GameController
  selCard: Card | null
  legal: LegalPlay[]
  picked: number[]
  setPicked: (p: number[]) => void
  sidMode: boolean
  setSidMode: (on: boolean) => void
  clear: () => void
}) {
  const d = v.decision
  const left = useSecondsLeft(d ? ctl.deadline : null)
  const act = (a: Action) => {
    ctl.act(a)
    clear()
  }
  const me = v.players[v.me]
  const mine = !!d
  const isSid = me.character === 'sid' && me.alive && me.hp < me.maxHp && v.hand.length >= 2
  const sidAllowed = isSid && (d?.type === 'play' || (d?.type === 'ask' && d.ask.kind === 'dying'))

  return (
    <div className={`prompt ${mine ? 'is-mine' : ''}`}>
      <p className="prompt-text">
        {mine && <span className="your-turn">{d!.type === 'ask' ? d!.ask.title : '輪到你了'}</span>}
        {sidMode
          ? '席德．凱強：選 2 張手牌棄掉，回復 1 點生命。'
          : !mine
            ? describeOthers(v, ctl.waitingOn)
            : d!.type === 'ask'
              ? d!.ask.prompt
              : '你的出牌階段：點一張手牌使用，打完按「結束回合」。'}
        {left != null && <span className={`countdown ${left <= 5 ? 'is-urgent' : ''}`}>剩 {left} 秒</span>}
      </p>

      {sidMode ? (
        <div className="choices">
          <button type="button" className="primary" disabled={picked.length !== 2} onClick={() => act({ type: 'ability', ability: 'sid', cards: picked })}>
            棄掉這 2 張（已選 {picked.length} 張）
          </button>
          <button type="button" onClick={() => setSidMode(false)}>
            取消
          </button>
        </div>
      ) : (
        <>
          {d?.type === 'ask' && <AskPanel v={v} ask={d.ask} picked={picked} setPicked={setPicked} act={act} />}
          {d?.type === 'play' && selCard && (
            <div className="selected">
              <p className="sel-desc">
                <b>【{CARD_DEFS[selCard.key].name}】</b>
                {CARD_DEFS[selCard.key].desc}
              </p>
              <div className="choices">
                {legal.map((l) => (
                  <PlayOptions key={l.as} legal={l} v={v} onPlay={act} />
                ))}
                {!legal.length && <span className="muted">{whyNot(v, selCard)}</span>}
              </div>
            </div>
          )}
          {(d?.type === 'play' || sidAllowed) && (
            <div className="choices">
              {d?.type === 'play' && (
                <button type="button" className="end-turn" onClick={() => act({ type: 'end_turn' })}>
                  結束回合
                </button>
              )}
              {sidAllowed && (
                <button type="button" className="skill-btn" onClick={() => setSidMode(true)}>
                  席德：棄 2 張回 1 血
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function whyNot(v: GameView, c: Card) {
  switch (c.key) {
    case 'missed':
      return '「射偏了！」要在被開槍時才能用。'
    case 'bang':
      return v.bangsUsed > 0 ? '這回合已經開過槍了。' : '射程內沒有目標。'
    case 'beer':
      return v.players.filter((p) => p.alive).length <= 2 ? '只剩兩人時啤酒無效。' : '你的生命是滿的。'
    case 'panic':
      return '距離 1 以內沒有可以搶的人。'
    default:
      return CARD_DEFS[c.key].colour === 'blue' ? '你已經裝備了同樣的牌。' : '這張牌現在不能用。'
  }
}

function PlayOptions({ legal, v, onPlay }: { legal: LegalPlay; v: GameView; onPlay: (a: Action) => void }) {
  const [target, setTarget] = useState<number | null>(null)
  const card = v.hand.find((c) => c.id === legal.card)!
  const name = CARD_DEFS[legal.as].name
  const label = card.key !== legal.as ? `把【${CARD_DEFS[card.key].name}】當作【${name}】` : CARD_DEFS[card.key].colour === 'blue' ? `裝備【${name}】` : `使用【${name}】`
  if (!legal.targets) {
    return (
      <button type="button" className="primary" onClick={() => onPlay({ type: 'play', card: legal.card, as: legal.as })}>
        {label}
      </button>
    )
  }
  if (legal.pickCard && target != null) {
    const t = v.players[target]
    return (
      <span className="choice-group">
        <span className="choice-label">
          {label}：選 {t.name} 的哪一張
        </span>
        {t.handCount > 0 && (
          <button type="button" className="primary" onClick={() => onPlay({ type: 'play', card: legal.card, as: legal.as, target, targetCard: 'hand' })}>
            隨機一張手牌（{t.handCount} 張）
          </button>
        )}
        {t.table.map((c) => (
          <button key={c.id} type="button" className="primary" onClick={() => onPlay({ type: 'play', card: legal.card, as: legal.as, target, targetCard: c.id })}>
            場上的【{CARD_DEFS[c.key].name}】
          </button>
        ))}
        <button type="button" onClick={() => setTarget(null)}>
          換人
        </button>
      </span>
    )
  }
  return (
    <span className="choice-group">
      <span className="choice-label">{label}，目標</span>
      {legal.targets.map((q) => {
        const p = v.players[q]
        return (
          <button
            key={q}
            type="button"
            className="primary"
            onClick={() => (legal.pickCard ? setTarget(q) : onPlay({ type: 'play', card: legal.card, as: legal.as, target: q }))}
          >
            {p.name}
            <small>距離 {p.dist}．♥{p.hp}</small>
          </button>
        )
      })}
    </span>
  )
}

/** 需要回答的詢問 */
function AskPanel({ v, ask, picked, setPicked, act }: { v: GameView; ask: AskView; picked: number[]; setPicked: (p: number[]) => void; act: (a: Action) => void }) {
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < ask.max ? [...picked, id] : picked)
  if (ask.zone === 'store') {
    const cards = v.store.filter((c) => ask.cards.includes(c.id))
    return (
      <div className="choices reveal">
        {cards.map((c) => (
          <CardFace key={c.id} card={c} usable onClick={() => act({ type: 'answer', cards: [c.id] })} />
        ))}
      </div>
    )
  }
  if (ask.zone === 'reveal') {
    return (
      <div className="choices reveal">
        {ask.shown.map((c) => (
          <CardFace key={c.id} card={c} usable selected={picked.includes(c.id)} onClick={() => toggle(c.id)} />
        ))}
        <button type="button" className="primary" disabled={picked.length !== ask.min} onClick={() => act({ type: 'answer', opt: 'ok', cards: picked })}>
          拿這 {ask.min} 張
        </button>
      </div>
    )
  }
  if (ask.kind === 'discard') {
    return (
      <div className="choices">
        <span className="choice-label">點選下方手牌（{ask.min} 張）</span>
        <button type="button" className="primary" disabled={picked.length !== ask.min} onClick={() => act({ type: 'answer', opt: 'ok', cards: picked })}>
          棄掉（已選 {picked.length} 張）
        </button>
      </div>
    )
  }
  return (
    <div className="choices">
      {ask.cards.length > 0 && ask.zone === 'hand' && <span className="choice-label">點亮的手牌可以直接打出</span>}
      {ask.targets.map((q) => (
        <button key={q} type="button" className="primary" onClick={() => act({ type: 'answer', target: q })}>
          從 {v.players[q].name} 手上拿（{v.players[q].handCount} 張）
        </button>
      ))}
      {ask.options
        .filter((o) => o.id !== 'sid')
        .map((o) => (
          <button key={o.id} type="button" className={o.primary ? 'primary' : ''} onClick={() => act({ type: 'answer', opt: o.id })}>
            {o.label}
          </button>
        ))}
    </div>
  )
}

function Log({ v }: { v: GameView }) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [v.log.length])
  return (
    <ol className="log" ref={ref} aria-label="遊戲紀錄" aria-live="polite">
      {v.log.map((l) => (
        <li key={l.seq} className={[l.text.startsWith('──') ? 'is-turn' : '', l.text.startsWith('遊戲結束') ? 'is-end' : '', l.text.startsWith('💀') ? 'is-death' : ''].filter(Boolean).join(' ')}>
          {l.text}
        </li>
      ))}
    </ol>
  )
}

function Result({ v, actions }: { v: GameView; actions: ReactNode }) {
  const r = v.result!
  const won = r.winners.includes(v.me)
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="遊戲結果">
      <div className="result">
        <h2>{won ? '你贏了' : '你輸了'}</h2>
        <p>{r.reason}</p>
        <table>
          <tbody>
            {v.players.map((p) => (
              <tr key={p.seat} className={r.winners.includes(p.seat) ? 'is-win' : ''}>
                <td>{p.name}</td>
                <td>{p.role ? ROLE_NAME[p.role] : ''}</td>
                <td>{p.character ? CHAR_BY_ID[p.character].name : ''}</td>
                <td>{r.winners.includes(p.seat) ? '勝利' : p.alive ? '' : '死亡'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="result-actions">{actions}</div>
      </div>
    </div>
  )
}
