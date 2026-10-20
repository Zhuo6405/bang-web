import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CARD_DEFS, CHAR_BY_ID, EVENT_BY_ID, GOLD_DEFS, ROLE_GOAL, ROLE_NAME, SUIT_NAME, SUIT_SYMBOL } from '../../engine/data'
import { playName as enginePlayName } from '../../engine/engine'
import type { Action, AskView, Card, GameConfig, GoldKey, LegalAbility, LegalPlay, LogEntry, PlayAs } from '../../engine/types'
import type { GameView } from '../../engine/view'
import { CardFace, RoleBadge } from './components'
import { useLocalController, useSecondsLeft, type GameController, type Social } from './controller'
import { DocsButtons } from './Docs'
import { CharacterPick, DuelOverlay } from './PickScreen'
import { recordResult } from './history'
import { ChatPanel, VoiceControls } from './social'
import { GUN } from '../three/gunTiming'
import { useGameSounds, useSoundOn } from './useGameSounds'

// 3D 場景比較大，進牌桌時才載入
const TableScene = lazy(() => import('../three/TableScene').then((m) => ({ default: m.TableScene })))

const playName = (as: PlayAs) => enginePlayName(as)

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
  // 擲硬幣視窗放在固定位置：從選角畫面切到牌桌時不會被重置
  return (
    <>
      {v.phase === 'choose' && v.pick ? (
        <CharacterPick v={v} act={ctl.act} deadline={ctl.deadline} />
      ) : (
        <Table ctl={ctl} social={social} onExit={onExit} exitLabel={exitLabel} resultActions={resultActions} topExtra={topExtra} />
      )}
      <DuelOverlay v={v} />
    </>
  )
}

/** 正在進行的多選：角色能力、代價、棄牌、牧場 */
interface PickMode {
  ids: number[]
  min: number
  max: number
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
  const [selShop, setSelShop] = useState<number | null>(null)
  const [ability, setAbility] = useState<LegalAbility | null>(null)
  const [costFor, setCostFor] = useState<{ legal: LegalPlay; target?: number; targetCard?: number | 'hand' } | null>(null)
  const [tab, setTab] = useState<'log' | 'chat'>('log')
  const [seenChat, setSeenChat] = useState(0)
  const [sideOpen, setSideOpen] = useState(false)
  const [inspect, setInspect] = useState<number | null>(null)
  const history = useLogHistory(v.log)
  useEffect(() => {
    const on = (e: Event) => setInspect((e as CustomEvent<number>).detail)
    window.addEventListener('bang-inspect', on)
    return () => window.removeEventListener('bang-inspect', on)
  }, [])
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

  useEffect(() => {
    const base = 'BANG!'
    document.title = v.result ? base : d?.type === 'play' ? '● 輪到你了｜BANG!' : d ? '● 需要你回應｜BANG!' : base
    return () => {
      document.title = base
    }
  }, [d, v.result])

  const clear = () => {
    setSel(null)
    setSelShop(null)
    setPicked([])
    setAbility(null)
    setCostFor(null)
  }
  // 時機改變就取消選取
  const decKey = `${d?.type}-${v.turnNo}-${d?.type === 'ask' ? d.ask.kind + d.ask.prompt : ''}-${v.hand.length}-${me.table.length}`
  useEffect(clear, [decKey])
  const selCard = v.hand.find((c) => c.id === sel) ?? me.table.find((c) => c.id === sel) ?? null
  const legalById = useMemo(() => {
    const m = new Map<number, LegalPlay[]>()
    for (const l of v.legal) m.set(l.card, [...(m.get(l.card) ?? []), l])
    return m
  }, [v.legal])

  const ask = d?.type === 'ask' ? d.ask : null
  let pick: PickMode | null = null
  if (ability) pick = { ids: ability.cardIds ?? v.hand.map((c) => c.id), min: ability.cards, max: ability.cards }
  else if (costFor) {
    const l = costFor.legal
    const ids = v.hand.filter((c) => c.id !== l.card && (!l.costKind || c.key === 'bang' || (c.key === 'missed' && me.character === 'calamity'))).map((c) => c.id)
    pick = { ids, min: l.cost!, max: l.cost! }
  } else if (ask && ask.zone === 'hand' && (ask.kind === 'discard' || ask.kind === 'ranch' || ask.kind === 'bandidos')) pick = { ids: ask.cards, min: ask.min, max: ask.max }
  const quickPick = !pick && ask && ask.zone === 'hand' && ask.max === 1
  // 手機：點一下選牌，再點一下（或連點兩下）打出
  const touch = useMemo(() => {
    try {
      return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 760
    } catch {
      return false
    }
  }, [])
  const [sheet, setSheet] = useState<number | null>(null)
  useEffect(() => setSheet(null), [decKey])
  /** 打出一張牌：不用選目標就直接打出，要選目標就開啟下方的選單 */
  const playOrOpen = (id: number) => {
    const ls = legalById.get(id) ?? []
    setSel(id)
    if (ls.length === 1 && !ls[0].targets && !ls[0].cost) {
      ctl.act({ type: 'play', card: id, as: ls[0].as })
      clear()
      return
    }
    setSheet(id)
  }

  const clickCard = (c: Card) => {
    if (pick) {
      if (!pick.ids.includes(c.id)) return
      const max = pick.max
      setPicked((ps) => (ps.includes(c.id) ? ps.filter((x) => x !== c.id) : max === 1 ? [c.id] : ps.length < max ? [...ps, c.id] : ps))
      return
    }
    if (quickPick && ask) {
      if (ask.cards.includes(c.id)) ctl.act({ type: 'answer', cards: [c.id] })
      return
    }
    if (d?.type === 'play' && touch && sel === c.id) return playOrOpen(c.id)
    setSel(sel === c.id ? null : c.id)
  }
  const dblCard = (c: Card) => {
    if (d?.type !== 'play' || pick || ask) return
    playOrOpen(c.id)
  }
  const usable = (c: Card) => {
    if (pick) return pick.ids.includes(c.id)
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
        <button type="button" className="ghost" onClick={() => setInspect(v.me)}>
          角色能力
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
            <EventBanner v={v} />
            <MyStatus v={v} />
            <p className="stage-piles">
              牌堆 {v.deckCount}．{v.dir === -1 ? '逆時針．' : ''}拖曳可{viewMode === 'first' ? '轉頭' : '旋轉視角'}
            </p>
          </div>
          {me.alive && me.table.some((c) => c.key === 'jail') && (
            <div className="jail-bars" aria-label="你被關在監獄裡">
              <span>你被關進監獄了！回合開始時抽判定：紅心才能越獄</span>
            </div>
          )}
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

      {inspect != null && <PlayersPanel v={v} focus={inspect} onClose={() => setInspect(null)} />}
      <section className={`bench ${d ? 'is-my-move' : ''}`} aria-label="你的手牌與行動">
        <Prompt
          v={v}
          ctl={ctl}
          selCard={selCard}
          setSel={setSel}
          selShop={selShop}
          setSelShop={setSelShop}
          legal={selCard ? (legalById.get(selCard.id) ?? []) : []}
          picked={picked}
          setPicked={setPicked}
          ability={ability}
          setAbility={setAbility}
          costFor={costFor}
          setCostFor={setCostFor}
          clear={clear}
          touch={touch}
          openCard={playOrOpen}
        />
        <div className="hand" role="group" aria-label="手牌">
          {v.hand.length === 0 && <span className="muted">沒有手牌</span>}
          {v.hand.map((c) => (
            <CardFace
              key={c.id}
              card={c}
              selected={sel === c.id || picked.includes(c.id)}
              usable={usable(c)}
              forced={v.must === c.id}
              onClick={() => clickCard(c)}
              onDoubleClick={() => dblCard(c)}
            />
          ))}
        </div>
      </section>

      {sheet != null && d?.type === 'play' && (
        <PlaySheet
          v={v}
          card={v.hand.find((c) => c.id === sheet) ?? me.table.find((c) => c.id === sheet) ?? null}
          legal={legalById.get(sheet) ?? []}
          onPlay={(a) => {
            ctl.act(a)
            clear()
            setSheet(null)
          }}
          onCost={(l, target, targetCard) => {
            setCostFor({ legal: l, target, targetCard })
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {ctl.error && (
        <div className="toast" role="alert" onClick={ctl.clearError}>
          {ctl.error}
        </div>
      )}
      {v.result && <Result v={v} actions={resultActions} history={history} />}
    </div>
  )
}

/** 自己中彈時畫面邊緣閃紅 */
function useHurtFlash(v: GameView) {
  const [on, setOn] = useState(false)
  const seen = useRef(-1)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const shotAt = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    const last = v.fx.length ? v.fx[v.fx.length - 1].seq : 0
    if (seen.current < 0) {
      seen.current = last
      return
    }
    const fresh = v.fx.filter((f) => f.seq > seen.current)
    seen.current = last
    // 有人對你開槍：記下子彈射出的時間，中彈閃紅要等到那時候
    for (const f of fresh) if (f.kind === 'shoot' && f.to === v.me) shotAt.current = Math.max(shotAt.current, Date.now() + GUN.fire * 1000)
    const hit = fresh.some((f) => (f.kind === 'hit' || f.kind === 'explode') && f.to === v.me)
    if (!hit) return
    const wait = Math.max(0, shotAt.current - Date.now())
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setOn(true)
      timer.current = setTimeout(() => setOn(false), 600)
    }, wait)
  }, [v.fx, v.me])
  return on
}

function EventBanner({ v }: { v: GameView }) {
  if (!v.event && !v.eventsLeft) return null
  const ev = v.event ? EVENT_BY_ID[v.event] : null
  return (
    <div className="event-banner">
      <span className="event-tag">事件</span>
      {ev ? (
        <>
          <b>{ev.name}</b>
          <span>{ev.text}</span>
        </>
      ) : (
        <span>警長第二回合開始翻開第一張事件牌。</span>
      )}
      <small>剩 {v.eventsLeft} 張</small>
    </div>
  )
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
        {v.suit && (
          <span className="cuffs">
            手銬：只能出{SUIT_SYMBOL[v.suit]}
            {SUIT_NAME[v.suit]}
          </span>
        )}
        {me.table.length > 0 && <Gear cards={me.table} fresh={v.fresh} />}
        {v.goldOn && <GoldInfo n={me.nuggets} items={me.gold} />}
      </div>
    </div>
  )
}

function Gear({ cards, fresh }: { cards: Card[]; fresh: number[] }) {
  return (
    <span className="plate-gear">
      {cards.map((c) => (
        <span key={c.id} className={`gear g-${CARD_DEFS[c.key].colour} ${fresh.includes(c.id) ? 'is-fresh' : ''}`} title={CARD_DEFS[c.key].desc + (fresh.includes(c.id) ? '（下一回合起可用）' : '')}>
          {CARD_DEFS[c.key].name}
        </span>
      ))}
    </span>
  )
}

/** 所有人的角色能力、生命與裝備（點名牌或按「角色能力」打開） */
function PlayersPanel({ v, focus, onClose }: { v: GameView; focus: number; onClose: () => void }) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [focus])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet players-panel" role="dialog" aria-label="角色能力與裝備" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>角色能力與裝備</b>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        <ul>
          {v.players.map((p) => {
            const c = p.character ? CHAR_BY_ID[p.character] : null
            const jailed = p.alive && p.table.some((x) => x.key === 'jail')
            return (
              <li key={p.seat} ref={p.seat === focus ? ref : undefined} className={`pp ${p.seat === focus ? 'is-focus' : ''} ${p.alive ? '' : 'is-out'}`}>
                <div className="pp-head">
                  <b>{p.name}</b>
                  {p.seat === v.me && <span className="seat-you">你</span>}
                  {p.role && <RoleBadge role={p.role} />}
                  {jailed && <span className="mark m-lock">監獄中</span>}
                  {!p.alive && <span className="mark m-dead">{p.ghost ? '幽靈' : '死亡'}</span>}
                </div>
                <div className="pp-char">
                  <b>{c?.name ?? '—'}</b>
                  <span className="pp-hp" aria-label={`生命 ${p.hp}/${p.maxHp}`}>
                    {Array.from({ length: p.maxHp }, (_, i) => (
                      <span key={i} className={i < p.hp ? 'bullet on' : 'bullet'} />
                    ))}
                    <small>
                      {Math.max(0, p.hp)}/{p.maxHp}
                      {p.role === 'sheriff' && c ? `（${c.hp}+1 警長）` : ''}
                    </small>
                  </span>
                </div>
                {c && <p className="pp-text">{c.text}</p>}
                {p.table.length + p.gold.length > 0 ? (
                  <ul className="pp-gear">
                    {p.table.map((x) => (
                      <li key={x.id}>
                        <span className={`gear g-${CARD_DEFS[x.key].colour}`}>{CARD_DEFS[x.key].name}</span>
                        {CARD_DEFS[x.key].desc}
                      </li>
                    ))}
                    {p.gold.map((x) => (
                      <li key={x.uid}>
                        <span className="gear g-gold">{GOLD_DEFS[x.key].name}</span>
                        {GOLD_DEFS[x.key].desc}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pp-none">沒有裝備</p>
                )}
              </li>
            )
          })}
        </ul>
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
            {p.character && <span className="r-ability">{CHAR_BY_ID[p.character].text}</span>}
            {p.role && <RoleBadge role={p.role} />}
            <span className="r-hp">
              {p.ghost ? '幽靈' : p.alive ? `♥ ${p.hp}/${p.maxHp}` : '已死亡'}
              {p.alive && p.seat !== v.me && v.players[v.me].alive && <span className={`plate-dist ${p.dist <= v.myRange ? 'in-range' : ''}`}>距 {p.dist}</span>}
            </span>
            {(p.table.length > 0 || v.goldOn) && (
              <span className="r-gear">
                <Gear cards={p.table} fresh={v.fresh} />
                {v.goldOn && <GoldInfo n={p.nuggets} items={p.gold} />}
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
  setSel,
  selShop,
  setSelShop,
  legal,
  picked,
  setPicked,
  ability,
  setAbility,
  costFor,
  setCostFor,
  clear,
  touch,
  openCard,
}: {
  v: GameView
  ctl: GameController
  selCard: Card | null
  setSel: (id: number | null) => void
  selShop: number | null
  setSelShop: (id: number | null) => void
  legal: LegalPlay[]
  picked: number[]
  setPicked: (p: number[]) => void
  ability: LegalAbility | null
  setAbility: (a: LegalAbility | null) => void
  costFor: { legal: LegalPlay; target?: number; targetCard?: number | 'hand' } | null
  setCostFor: (c: { legal: LegalPlay; target?: number; targetCard?: number | 'hand' } | null) => void
  clear: () => void
  touch: boolean
  openCard: (id: number) => void
}) {
  const d = v.decision
  const left = useSecondsLeft(d ? ctl.deadline : null)
  const act = (a: Action) => {
    ctl.act(a)
    clear()
  }
  const mine = !!d
  const tablePlays = v.legal.filter((l) => l.source === 'table')
  const tableCards = [...new Set(tablePlays.map((l) => l.card))].map((id) => v.players[v.me].table.find((c) => c.id === id)!)

  // 選手牌當代價
  if (costFor) {
    const l = costFor.legal
    return (
      <div className="prompt is-mine">
        <p className="prompt-text">
          <span className="your-turn">代價</span>
          使用【{playName(l.as)}】要另外棄 {l.cost} 張{l.costKind ? '「砰！」' : '手牌'}：點選下方的牌。
        </p>
        <div className="choices">
          <button
            type="button"
            className="primary"
            disabled={picked.length !== l.cost}
            onClick={() => act({ type: 'play', card: l.card, as: l.as, target: costFor.target, targetCard: costFor.targetCard, extra: picked })}
          >
            確定（已選 {picked.length} 張）
          </button>
          <button type="button" onClick={() => setCostFor(null)}>
            取消
          </button>
        </div>
      </div>
    )
  }

  // 角色能力
  if (ability) {
    const ready = picked.length === ability.cards
    return (
      <div className="prompt is-mine">
        <p className="prompt-text">
          <span className="your-turn">能力</span>
          {ability.label}
          {ability.cards > 0 ? `：點選下方 ${ability.cards} 張手牌。` : ''}
        </p>
        <div className="choices">
          {ability.targets ? (
            <span className="choice-group">
              <span className="choice-label">目標</span>
              {ability.targets.map((q) => (
                <button key={q} type="button" className="primary" disabled={!ready} onClick={() => act({ type: 'ability', ability: ability.id, cards: picked, target: q })}>
                  {v.players[q].name}
                </button>
              ))}
            </span>
          ) : (
            <button type="button" className="primary" disabled={!ready} onClick={() => act({ type: 'ability', ability: ability.id, cards: picked })}>
              確定
            </button>
          )}
          <button type="button" onClick={() => setAbility(null)}>
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`prompt ${mine ? 'is-mine' : ''}`}>
      <p className="prompt-text">
        {mine && <span className="your-turn">{d!.type === 'ask' ? d!.ask.title : '輪到你了'}</span>}
        {!mine
          ? describeOthers(v, ctl.waitingOn)
          : d!.type === 'ask'
            ? d!.ask.prompt
            : v.must != null
              ? '西部法則：先打出亮出的那張牌（金框）。'
              : '你的出牌階段：點一張手牌使用，打完按「結束回合」。'}
        {left != null && <span className={`countdown ${left <= 5 ? 'is-urgent' : ''}`}>剩 {left} 秒</span>}
      </p>

      {d?.type === 'ask' && <AskPanel v={v} ask={d.ask} picked={picked} setPicked={setPicked} act={act} />}
      {d?.type === 'play' && selCard && touch && (
        <div className="selected">
          <p className="sel-desc">
            <b>【{CARD_DEFS[selCard.key].name}】</b>
            {CARD_DEFS[selCard.key].desc}
          </p>
          <div className="choices">
            {legal.length ? (
              <button type="button" className="primary" onClick={() => openCard(selCard.id)}>
                打出這張牌（或再點一下牌）
              </button>
            ) : (
              <span className="muted">{whyNot(v, selCard)}</span>
            )}
          </div>
        </div>
      )}
      {d?.type === 'play' && selCard && !touch && (
        <div className="selected">
          <p className="sel-desc">
            <b>【{CARD_DEFS[selCard.key].name}】</b>
            {CARD_DEFS[selCard.key].desc}
          </p>
          <div className="choices">
            {legal.map((l) => (
              <PlayOptions key={`${l.as}-${l.source}`} legal={l} v={v} onPlay={act} onCost={(target, targetCard) => setCostFor({ legal: l, target, targetCard })} />
            ))}
            {!legal.length && <span className="muted">{whyNot(v, selCard)}</span>}
          </div>
        </div>
      )}
      {d?.type === 'play' && v.goldOn && <ShopPanel v={v} selShop={selShop} setSelShop={(id) => { setSel(null); setSelShop(id) }} act={act} onCost={() => {}} />}
      {mine && (
        <div className="choices">
          {d?.type === 'play' && tableCards.length > 0 && (
            <span className="choice-group">
              <span className="choice-label">場上的綠牌</span>
              {tableCards.map((c) => (
                <button key={c.id} type="button" className={`gear-btn ${selCard?.id === c.id ? 'on' : ''}`} onClick={() => { setSelShop(null); setSel(selCard?.id === c.id ? null : c.id) }}>
                  {CARD_DEFS[c.key].name}
                </button>
              ))}
            </span>
          )}
          {v.abilities.map((ab) => (
            <button
              key={ab.id}
              type="button"
              className="skill-btn"
              onClick={() => (ab.cards === 0 && !ab.targets ? act({ type: 'ability', ability: ab.id }) : setAbility(ab))}
            >
              {ab.label}
            </button>
          ))}
          {d?.type === 'play' && (
            <button type="button" className="end-turn" onClick={() => act({ type: 'end_turn' })}>
              結束回合
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function whyNot(v: GameView, c: Card) {
  if (v.suit && c.suit !== v.suit) return `手銬：這回合只能出${SUIT_NAME[v.suit]}。`
  if (v.must != null && v.must !== c.id) return '西部法則：要先打出亮出的那張牌。'
  switch (c.key) {
    case 'missed':
    case 'dodge':
      return '這張要在被開槍時才能用。'
    case 'bang':
      return v.event === 'sermon' ? '佈道：自己回合不能打「砰！」。' : v.bangsUsed > 0 ? '這回合已經開過槍了。' : '射程內沒有目標。'
    case 'beer':
      return v.event === 'reverend' ? '牧師：不能喝啤酒。' : v.players.filter((p) => p.alive).length <= 2 ? '只剩兩人時啤酒無效。' : '你的生命是滿的。'
    case 'panic':
      return '距離 1 以內沒有可以搶的人。'
    default:
      if (v.event === 'judge' && CARD_DEFS[c.key].colour !== 'brown') return '法官：不能把牌放到場上。'
      if (CARD_DEFS[c.key].cost && v.hand.length < 2) return '這張牌要另外棄 1 張手牌，你手牌不夠。'
      return CARD_DEFS[c.key].colour !== 'brown' ? (v.fresh.includes(c.id) ? '綠牌放上場的回合不能用。' : '你已經有同樣的牌了。') : '這張牌現在不能用。'
  }
}

function PlayOptions({
  legal,
  v,
  onPlay,
  onCost,
}: {
  legal: LegalPlay
  v: GameView
  onPlay: (a: Action) => void
  onCost: (target?: number, targetCard?: number | 'hand') => void
}) {
  const [target, setTarget] = useState<number | null>(null)
  const [first, setFirst] = useState<number | null>(null)
  const me = v.players[v.me]
  const name = playName(legal.as)
  let label: string
  if (legal.source === 'shop') {
    const item = [...v.shop, ...(v.myFree ? [v.myFree] : []), ...v.players.flatMap((p) => p.gold)].find((x) => x.uid === legal.card)
    const gname = item ? GOLD_DEFS[item.key].name : ''
    label =
      legal.as === 'golddrop'
        ? `付 ${legal.price} 金塊棄掉【${gname}】`
        : `${legal.price ? `花 ${legal.price} 金塊` : '免費'}${item && item.key !== legal.as ? `用【${gname}】當作【${name}】` : `買【${gname}】`}`
  } else {
    const card = (legal.source === 'table' ? me.table : v.hand).find((c) => c.id === legal.card)!
    const colour = CARD_DEFS[card.key].colour
    label =
      legal.source === 'table'
        ? `使用場上的【${name}】`
        : card.key !== legal.as
          ? `把【${CARD_DEFS[card.key].name}】當作【${name}】`
          : colour !== 'brown'
            ? `${colour === 'green' ? '放到場上' : '裝備'}【${name}】`
            : `使用【${name}】`
  }
  const go = (t?: number, tc?: number | 'hand', t2?: number) => (legal.cost ? onCost(t, tc) : onPlay({ type: 'play', card: legal.card, as: legal.as, target: t, targetCard: tc, target2: t2 }))
  // 連開：選完第一個目標，再選他旁邊的第二個
  if (legal.second && first != null) {
    const opts = legal.second[first] ?? []
    return (
      <span className="choice-group">
        <span className="choice-label">【連開】第二個目標（{v.players[first].name} 旁邊的人）</span>
        {opts.map((q) => (
          <button key={q} type="button" className="primary" onClick={() => go(first, undefined, q)}>
            {v.players[q].name}
          </button>
        ))}
        {!opts.length && (
          <button type="button" className="primary" onClick={() => go(first)}>
            只打 {v.players[first].name}
          </button>
        )}
        <button type="button" onClick={() => setFirst(null)}>
          換人
        </button>
      </span>
    )
  }
  if (!legal.targets) {
    return (
      <button type="button" className="primary" onClick={() => go()}>
        {label}
        {legal.cost ? <small>另外棄 {legal.cost} 張</small> : null}
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
        {!legal.tableOnly && t.handCount > 0 && (
          <button type="button" className="primary" onClick={() => go(target, 'hand')}>
            隨機一張手牌（{t.handCount} 張）
          </button>
        )}
        {t.table.map((c) => (
          <button key={c.id} type="button" className="primary" onClick={() => go(target, c.id)}>
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
      <span className="choice-label">
        {label}
        {legal.cost ? `（另外棄 ${legal.cost} 張）` : ''}，目標
      </span>
      {legal.targets.map((q) => {
        const p = v.players[q]
        return (
          <button key={q} type="button" className="primary" onClick={() => (legal.pickCard ? setTarget(q) : legal.second ? setFirst(q) : go(q))}>
            {q === v.me ? '自己' : p.name}
            <small>{!p.alive ? '已死亡' : q === v.me ? `♥${p.hp}` : `距離 ${p.dist}．♥${p.hp}`}</small>
          </button>
        )
      })}
    </span>
  )
}

const TARGET_LABEL: Partial<Record<AskView['kind'], (name: string, n: number) => string>> = {
  jesse: (name, n) => `從 ${name} 手上拿（${n} 張）`,
  vera: (name) => `複製 ${name}`,
  evelyn: (name) => `對 ${name} 開槍`,
  blood: (name) => `給 ${name} 1 點生命`,
}

/** 需要回答的詢問 */
function AskPanel({ v, ask, picked, setPicked, act }: { v: GameView; ask: AskView; picked: number[]; setPicked: (p: number[]) => void; act: (a: Action) => void }) {
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < ask.max ? [...picked, id] : picked)
  const buttons = (
    <>
      {ask.targets.map((q) => (
        <button key={q} type="button" className="primary" onClick={() => act({ type: 'answer', target: q })}>
          {(TARGET_LABEL[ask.kind] ?? ((n: string) => n))(v.players[q].name, v.players[q].handCount)}
          {ask.kind === 'vera' && v.players[q].character && <small>{CHAR_BY_ID[v.players[q].character!].name}</small>}
        </button>
      ))}
      {ask.table.map((c) => (
        <button key={c.id} type="button" className="primary" onClick={() => act({ type: 'answer', cards: [c.id] })}>
          用場上的【{CARD_DEFS[c.key].name}】
        </button>
      ))}
      {ask.options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={o.primary ? 'primary' : ''}
          disabled={ask.kind === 'bandidos' && o.id === 'ok' && picked.length !== ask.min}
          onClick={() => act({ type: 'answer', opt: o.id, cards: ask.kind === 'ranch' || ask.kind === 'bandidos' ? picked : undefined })}
        >
          {o.label}
        </button>
      ))}
    </>
  )
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
    const multi = ask.max > 1
    return (
      <div className="choices reveal">
        {ask.shown.map((c) => (
          <CardFace key={c.id} card={c} usable selected={picked.includes(c.id)} onClick={() => (multi ? toggle(c.id) : act({ type: 'answer', cards: [c.id] }))} />
        ))}
        {multi ? (
          <button type="button" className="primary" disabled={picked.length < ask.min || picked.length > ask.max} onClick={() => act({ type: 'answer', opt: 'ok', cards: picked })}>
            {ask.min === ask.max ? `拿這 ${ask.min} 張` : `拿走選取的 ${picked.length} 張`}
          </button>
        ) : (
          ask.options.map((o) => (
            <button key={o.id} type="button" className={o.primary ? 'primary' : ''} onClick={() => act({ type: 'answer', opt: o.id })}>
              {o.label}
            </button>
          ))
        )}
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
  if (ask.kind === 'ranch' || ask.kind === 'bandidos') {
    return (
      <div className="choices">
        <span className="choice-label">
          {ask.kind === 'ranch' ? '點選下方要換掉的手牌' : `點選下方 ${ask.min} 張要棄的手牌`}（已選 {picked.length} 張）
        </span>
        {buttons}
      </div>
    )
  }
  return (
    <div className="choices">
      {ask.cards.some((id) => v.hand.some((c) => c.id === id)) && <span className="choice-label">點亮的手牌可以直接打出</span>}
      {buttons}
    </div>
  )
}

const logClass = (l: LogEntry) =>
  [
    l.text.startsWith('──') ? 'is-turn' : '',
    l.text.startsWith('遊戲結束') ? 'is-end' : '',
    l.text.startsWith('💀') ? 'is-death' : '',
    l.text.startsWith('📜') ? 'is-event' : '',
  ]
    .filter(Boolean)
    .join(' ')

function Log({ v }: { v: GameView }) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [v.log.length])
  return (
    <ol className="log" ref={ref} aria-label="遊戲紀錄" aria-live="polite">
      {v.log.map((l) => (
        <li
          key={l.seq}
          className={logClass(l)}
        >
          {l.text}
        </li>
      ))}
    </ol>
  )
}

/** 整局的紀錄：引擎只保留最近幾百行，這裡把看過的都累積起來 */
function useLogHistory(log: LogEntry[]) {
  const all = useRef(new Map<number, LogEntry>())
  for (const l of log) all.current.set(l.seq, l)
  return [...all.current.values()].sort((a, b) => a.seq - b.seq)
}

function Result({ v, actions, history }: { v: GameView; actions: ReactNode; history: LogEntry[] }) {
  const r = v.result!
  const won = r.winners.includes(v.me)
  const [mode, setMode] = useState<'summary' | 'log' | 'hidden'>('summary')
  if (mode === 'hidden')
    return (
      <button type="button" className="primary result-reopen" onClick={() => setMode('summary')}>
        看結算
      </button>
    )
  if (mode === 'log')
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label="整局紀錄">
        <div className="result result-log">
          <div className="result-log-head">
            <h2>整局紀錄</h2>
            <button type="button" className="primary" onClick={() => setMode('summary')}>
              回到結算
            </button>
          </div>
          <ol className="log full-log">
            {history.map((l) => (
              <li key={l.seq} className={logClass(l)}>
                {l.text}
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
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
        <div className="result-actions">
          <button type="button" onClick={() => setMode('log')}>
            查看整局紀錄
          </button>
          <button type="button" onClick={() => setMode('hidden')}>
            看牌桌
          </button>
          {actions}
        </div>
      </div>
    </div>
  )
}

export function GoldInfo({ n, items }: { n: number; items: { uid: number; key: GoldKey }[] }) {
  return (
    <span className="gold-info">
      <span className="nugget" title="金塊">
        {n}
      </span>
      {items.map((x) => (
        <span key={x.uid} className="gear g-gold" title={GOLD_DEFS[x.key].desc}>
          {GOLD_DEFS[x.key].name}
        </span>
      ))}
    </span>
  )
}

/** 淘金熱商店：三張翻開的裝備、喬許抽到的免費裝備、棄掉別人的裝備 */
function ShopPanel({ v, selShop, setSelShop, act }: { v: GameView; selShop: number | null; setSelShop: (id: number | null) => void; act: (a: Action) => void; onCost: () => void }) {
  const items = [...v.shop.map((x) => ({ ...x, free: false })), ...(v.myFree ? [{ ...v.myFree, free: true }] : [])]
  const plays = v.legal.filter((l) => l.source === 'shop')
  const drops = plays.filter((l) => l.as === 'golddrop')
  const chosen = selShop != null ? plays.filter((l) => l.card === selShop && l.as !== 'golddrop') : []
  return (
    <div className="shop">
      <span className="shop-title">
        商店<small>你有 {v.myNuggets} 金塊．裝備牌堆 {v.goldDeck} 張</small>
      </span>
      {items.map((x) => {
        const def = GOLD_DEFS[x.key]
        const can = plays.some((l) => l.card === x.uid && l.as !== 'golddrop')
        return (
          <button
            key={x.uid}
            type="button"
            className={`shop-item k-${def.kind} ${selShop === x.uid ? 'on' : ''}`}
            disabled={!can}
            title={def.desc}
            onClick={() => setSelShop(selShop === x.uid ? null : x.uid)}
          >
            <b>{def.name}</b>
            <span className="price">{x.free ? '免費' : `${def.cost} 金`}</span>
            <small>{def.desc}</small>
          </button>
        )
      })}
      {chosen.length > 0 && (
        <div className="choices">
          {chosen.map((l) => (
            <PlayOptions key={l.as} legal={l} v={v} onPlay={act} onCost={() => {}} />
          ))}
        </div>
      )}
      {drops.length > 0 && (
        <details className="shop-drops">
          <summary>付金塊棄掉別人的裝備</summary>
          <div className="choices">
            {drops.map((l) => (
              <PlayOptions key={l.card} legal={l} v={v} onPlay={act} onCost={() => {}} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

/** 從下方滑出的出牌選單（手機連點兩下、電腦雙擊時開啟） */
function PlaySheet({
  v,
  card,
  legal,
  onPlay,
  onCost,
  onClose,
}: {
  v: GameView
  card: Card | null
  legal: LegalPlay[]
  onPlay: (a: Action) => void
  onCost: (l: LegalPlay, target?: number, targetCard?: number | 'hand') => void
  onClose: () => void
}) {
  if (!card) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`打出【${CARD_DEFS[card.key].name}】`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <CardFace card={card} small />
          <p>
            <b>【{CARD_DEFS[card.key].name}】</b>
            {CARD_DEFS[card.key].desc}
          </p>
        </div>
        <div className="choices sheet-choices">
          {legal.map((l) => (
            <PlayOptions key={`${l.as}-${l.source}`} legal={l} v={v} onPlay={onPlay} onCost={(t, tc) => onCost(l, t, tc)} />
          ))}
          {!legal.length && <span className="muted">{whyNot(v, card)}</span>}
        </div>
        <button type="button" className="sheet-close" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  )
}
