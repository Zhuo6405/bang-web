import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CARD_DEFS, GOLD_DEFS, SUIT_SYMBOL } from '../../engine/data'
import { cardDesc, cardName, charName, charText, eventName, eventText, goldDesc, goldName, roleGoal, roleName, suitName } from '../../engine/i18n'
import { getLang, LangToggle, t, tx } from '../lang'
import { playName as enginePlayName } from '../../engine/engine'
import type { Action, AskView, Card, CardKey, GameConfig, GoldKey, LegalAbility, LegalPlay, LogEntry, PlayAs } from '../../engine/types'
import type { GameView } from '../../engine/view'
import { CardFace, RoleBadge } from './components'
import { useLocalController, useSecondsLeft, type GameController, type Social } from './controller'
import { DocsButtons } from './Docs'
import { CharacterPick, DuelOverlay } from './PickScreen'
import { recordResult } from './history'
import { ChatPanel, VoiceControls } from './social'
import { GUN } from '../three/gunTiming'
import { useGameSounds, useSoundOn } from './useGameSounds'

// 依目前語言的名稱
const L = () => getLang()
const cN = (k: CardKey) => cardName(k, L())
const cD = (k: CardKey) => cardDesc(k, L())
const gN = (k: GoldKey) => goldName(k, L())
const gD = (k: GoldKey) => goldDesc(k, L())
const chN = (id: string) => charName(id, L())
const chT = (id: string) => charText(id, L())

// 3D 場景比較大，進牌桌時才載入
const TableScene = lazy(() => import('../three/TableScene').then((m) => ({ default: m.TableScene })))

const playName = (as: PlayAs) => enginePlayName(as, L())

export function LocalGame({ config, onExit }: { config: GameConfig; onExit: () => void }) {
  const ctl = useLocalController(config)
  return (
    <GameScreen
      ctl={ctl}
      onExit={onExit}
      historyId={`local-${config.seed}`}
      resultActions={
        <button type="button" className="primary" onClick={onExit}>
          {t('回到大廳', 'Back to lobby', 'Về sảnh')}
        </button>
      }
    />
  )
}

export function GameScreen({
  ctl,
  social,
  onExit,
  exitLabel,
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
  exitLabel?: string
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
  const myChar = me.character
  const d = v.decision

  useEffect(() => {
    const base = 'BANG!'
    document.title = v.result ? base : d?.type === 'play' ? t('● 輪到你了｜BANG!', '● Your turn | BANG!', '● Đến lượt bạn | BANG!') : d ? t('● 需要你回應｜BANG!', '● Your move | BANG!', '● Bạn cần trả lời | BANG!') : base
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
          {t(`第 ${v.turnNo} 回合`, `Turn ${v.turnNo}`, `Lượt ${v.turnNo}`)}
          <b className={v.active === v.me ? 'turn-me' : ''}>{v.active === v.me ? t('你的回合', 'Your turn', 'Lượt của bạn') : t(`${v.players[v.active].name} 的回合`, `${v.players[v.active].name}’s turn`, `Lượt của ${v.players[v.active].name}`)}</b>
        </span>
        {social && <VoiceControls voice={social.voice} speakers={social.room.members.filter((m) => m.inVoice).length} />}
        {topExtra}
        <button type="button" className="ghost sound-btn" onClick={() => setSoundOn(!soundOn)} aria-pressed={soundOn}>
          {soundOn ? t('音效 開', 'Sound on', 'Âm thanh bật') : t('音效 關', 'Sound off', 'Âm thanh tắt')}
        </button>
        <button type="button" className="ghost" onClick={() => setInspect(v.me)}>
          {t('角色能力', 'Abilities', 'Năng lực')}
        </button>
        <DocsButtons />
        <LangToggle />
        <button type="button" className="ghost side-toggle" onClick={() => setSideOpen((o) => !o)} aria-expanded={sideOpen}>
          {sideOpen ? t('收起', 'Hide', 'Thu gọn') : t('紀錄與聊天', 'Log & chat', 'Nhật ký & trò chuyện')}
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        <button type="button" className="ghost" onClick={onExit}>
          {exitLabel ?? t('離開', 'Leave', 'Rời đi')}
        </button>
      </header>

      <div className="layout">
        <section className={`stage ${hurt ? 'is-hurt' : ''}`} aria-label={t('牌桌（可拖曳轉動視角）', 'Table (drag to look around)', 'Bàn chơi (kéo để nhìn quanh)')}>
          <Suspense fallback={<div className="stage-loading">{t('酒館佈置中…', 'Setting up the saloon…', 'Đang bày biện quán rượu…')}</div>}>
            <TableScene v={v} waitingOn={ctl.waitingOn} aiControlled={ctl.aiControlled} mode={viewMode} selected={sel} />
          </Suspense>
          <div className="stage-hud">
            <EventBanner v={v} />
            <MyStatus v={v} />
            <p className="stage-piles">
              {t(`牌堆 ${v.deckCount}．`, `Deck ${v.deckCount} · `, `Chồng bài ${v.deckCount} · `)}
              {v.dir === -1 ? t('逆時針．', 'anticlockwise · ', 'ngược chiều kim đồng hồ · ') : ''}
              {viewMode === 'first' ? t('拖曳可轉頭', 'drag to turn your head', 'kéo để quay đầu') : t('拖曳可旋轉視角', 'drag to rotate', 'kéo để xoay')}
            </p>
          </div>
          {me.alive && me.table.some((c) => c.key === 'jail') && (
            <div className="jail-bars" aria-label={t('你被關在監獄裡', 'You are in Jail', 'Bạn đang ở trong Jail')}>
              <span>{t('你被關進監獄了！回合開始時抽判定：紅心才能越獄', 'You are in Jail! At the start of your turn draw!: only a Heart lets you out', 'Bạn đang ở trong Jail! Đầu lượt rút phán định: chỉ ra Cơ mới được thả')}</span>
            </div>
          )}
          <div className="stage-view">
            <button type="button" onClick={toggleView} aria-pressed={viewMode === 'overview'}>
              {viewMode === 'first' ? t('切換到俯瞰視角', 'Overhead view', 'Nhìn từ trên cao') : t('切換到第一人稱', 'First-person view', 'Góc nhìn thứ nhất')}
            </button>
          </div>
        </section>

        <aside className={`side ${sideOpen ? 'is-open' : ''}`}>
          <div className="me-card">
            <div className="me-row">
              {me.role && <RoleBadge role={me.role} />}
              <b>{myChar ? chN(myChar) : '—'}</b>
            </div>
            {me.role && (
              <p className="me-mission">
                {t('勝利條件：', 'Goal: ', 'Mục tiêu: ')}
                {roleGoal(me.role, L())}
              </p>
            )}
            {myChar && (
              <p className="me-mission">
                {t('角色能力：', 'Ability: ', 'Năng lực: ')}
                {chT(myChar)}
              </p>
            )}
          </div>
          <Roster v={v} />
          {social && (
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
                {t('遊戲紀錄', 'Log', 'Nhật ký')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
                {t('聊天', 'Chat', 'Trò chuyện')}
                {unread > 0 && <span className="badge">{unread}</span>}
              </button>
            </div>
          )}
          {social && tab === 'chat' ? <ChatPanel chat={social.chat} me={social.me} say={social.say} /> : <Log v={v} />}
        </aside>
      </div>

      {inspect != null && <PlayersPanel v={v} focus={inspect} onClose={() => setInspect(null)} />}
      <section className={`bench ${d ? 'is-my-move' : ''}`} aria-label={t('你的手牌與行動', 'Your hand and actions', 'Bài trên tay và hành động của bạn')}>
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
        <div className="hand" role="group" aria-label={t('手牌', 'Hand', 'Bài trên tay')}>
          {v.hand.length === 0 && <span className="muted">{t('沒有手牌', 'No cards in hand', 'Không có bài trên tay')}</span>}
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
          {tx(ctl.error)}
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
  return (
    <div className="event-banner">
      <span className="event-tag">{t('事件', 'Event', 'Sự kiện')}</span>
      {v.event ? (
        <>
          <b>{eventName(v.event, L())}</b>
          <span>{eventText(v.event, L())}</span>
        </>
      ) : (
        <span>{t('警長第二回合開始翻開第一張事件牌。', 'The first event is revealed at the start of the Sheriff’s second turn.', 'Sự kiện đầu tiên được lật vào đầu lượt thứ hai của Cảnh sát trưởng.')}</span>
      )}
      <small>{t(`剩 ${v.eventsLeft} 張`, `${v.eventsLeft} left`, `còn ${v.eventsLeft} lá`)}</small>
    </div>
  )
}

function MyStatus({ v }: { v: GameView }) {
  const me = v.players[v.me]
  return (
    <div className="mystatus">
      <div className="plate-hp" aria-label={t(`你的生命 ${me.hp} / ${me.maxHp}`, `Your life ${me.hp} / ${me.maxHp}`, `Máu của bạn ${me.hp} / ${me.maxHp}`)}>
        <span className="hp-label">{t('生命', 'Life', 'Máu')}</span>
        {Array.from({ length: me.maxHp }, (_, i) => (
          <span key={i} className={i < me.hp ? 'bullet on' : 'bullet'} />
        ))}
      </div>
      <div className="mystatus-row">
        {t(`射程 ${v.myRange}`, `Range ${v.myRange}`, `Tầm ${v.myRange}`)}
        {v.suit && (
          <span className="cuffs">
            {t('手銬：只能出', 'Handcuffs: only ', 'Handcuffs: chỉ được đánh ')}
            {SUIT_SYMBOL[v.suit]}
            {suitName(v.suit, L())}
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
        <span key={c.id} className={`gear g-${CARD_DEFS[c.key].colour} ${fresh.includes(c.id) ? 'is-fresh' : ''}`} title={cD(c.key) + (fresh.includes(c.id) ? t('（下一回合起可用）', ' (usable from next turn)', ' (dùng được từ lượt sau)') : '')}>
          {cN(c.key)}
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
      <div className="sheet players-panel" role="dialog" aria-label={t('角色能力與裝備', 'Abilities and equipment', 'Năng lực và trang bị')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>{t('角色能力與裝備', 'Abilities and equipment', 'Năng lực và trang bị')}</b>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t('關閉', 'Close', 'Đóng')}>
            ✕
          </button>
        </div>
        <ul>
          {v.players.map((p) => {
            const c = p.character
            const jailed = p.alive && p.table.some((x) => x.key === 'jail')
            return (
              <li key={p.seat} ref={p.seat === focus ? ref : undefined} className={`pp ${p.seat === focus ? 'is-focus' : ''} ${p.alive ? '' : 'is-out'}`}>
                <div className="pp-head">
                  <b>{p.name}</b>
                  {p.seat === v.me && <span className="seat-you">{t('你', 'You', 'Bạn')}</span>}
                  {p.role && <RoleBadge role={p.role} />}
                  {jailed && <span className="mark m-lock">{t('監獄中', 'In Jail', 'Đang ở Jail')}</span>}
                  {!p.alive && <span className="mark m-dead">{p.ghost ? t('幽靈', 'Ghost', 'Hồn ma') : t('死亡', 'Dead', 'Đã chết')}</span>}
                </div>
                <div className="pp-char">
                  <b>{c ? chN(c) : '—'}</b>
                  <span className="pp-hp" aria-label={t(`生命 ${p.hp}/${p.maxHp}`, `Life ${p.hp}/${p.maxHp}`, `Máu ${p.hp}/${p.maxHp}`)}>
                    {Array.from({ length: p.maxHp }, (_, i) => (
                      <span key={i} className={i < p.hp ? 'bullet on' : 'bullet'} />
                    ))}
                    <small>
                      {Math.max(0, p.hp)}/{p.maxHp}
                      {p.role === 'sheriff' && c ? t(`（${p.maxHp - 1}+1 警長）`, ` (${p.maxHp - 1}+1 Sheriff)`, ` (${p.maxHp - 1}+1 Cảnh sát trưởng)`) : ''}
                    </small>
                  </span>
                </div>
                {c && <p className="pp-text">{chT(c)}</p>}
                {p.table.length + p.gold.length > 0 ? (
                  <ul className="pp-gear">
                    {p.table.map((x) => (
                      <li key={x.id}>
                        <span className={`gear g-${CARD_DEFS[x.key].colour}`}>{cN(x.key)}</span>
                        {cD(x.key)}
                      </li>
                    ))}
                    {p.gold.map((x) => (
                      <li key={x.uid}>
                        <span className="gear g-gold">{gN(x.key)}</span>
                        {gD(x.key)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pp-none">{t('沒有裝備', 'No equipment', 'Không có trang bị')}</p>
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
      <h3>{t('牌桌上的人', 'At the table', 'Quanh bàn')}</h3>
      <ul>
        {v.players.map((p) => (
          <li key={p.seat} className={`${p.alive ? '' : 'is-out'} ${p.seat === v.active ? 'is-active' : ''}`}>
            <span className="r-name">
              {p.name}
              {p.seat === v.me && <span className="seat-you">{t('你', 'You', 'Bạn')}</span>}
            </span>
            <span className="r-char">{p.character ? chN(p.character) : ''}</span>
            {p.character && <span className="r-ability">{chT(p.character)}</span>}
            {p.role && <RoleBadge role={p.role} />}
            <span className="r-hp">
              {p.ghost ? t('幽靈', 'Ghost', 'Hồn ma') : p.alive ? `♥ ${p.hp}/${p.maxHp}` : t('已死亡', 'Dead', 'Đã chết')}
              {p.alive && p.seat !== v.me && v.players[v.me].alive && <span className={`plate-dist ${p.dist <= v.myRange ? 'in-range' : ''}`}>{t(`距 ${p.dist}`, `dist ${p.dist}`, `cách ${p.dist}`)}</span>}
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
  if (v.result) return t('遊戲結束', 'Game over', 'Kết thúc')
  const who = waitingOn.filter((p) => p !== v.me)
  if (who.length === 0) return t('結算中…', 'Resolving…', 'Đang xử lý…')
  const name = v.players[who[0]].name
  if (who[0] === v.active) return t(`等待 ${name} 出牌…`, `Waiting for ${name} to play…`, `Đang chờ ${name} đánh bài…`)
  return t(`等待 ${name} 回應…`, `Waiting for ${name} to respond…`, `Đang chờ ${name} trả lời…`)
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
          <span className="your-turn">{t('代價', 'Cost', 'Chi phí')}</span>
          {t(
            `使用【${playName(l.as)}】要另外棄 ${l.cost} 張${l.costKind ? '「砰！」' : '手牌'}：點選下方的牌。`,
            `To play ${playName(l.as)} you must also discard ${l.cost} ${l.costKind ? 'BANG!' : `card${(l.cost ?? 1) > 1 ? 's' : ''}`}: tap them below.`, `Để đánh ${playName(l.as)} bạn phải bỏ thêm ${l.cost} ${l.costKind ? 'BANG!' : 'lá'}: chạm vào các lá bên dưới.`,
          )}
        </p>
        <div className="choices">
          <button
            type="button"
            className="primary"
            disabled={picked.length !== l.cost}
            onClick={() => act({ type: 'play', card: l.card, as: l.as, target: costFor.target, targetCard: costFor.targetCard, extra: picked })}
          >
            {t(`確定（已選 ${picked.length} 張）`, `Confirm (${picked.length} selected)`, `Xác nhận (đã chọn ${picked.length})`)}
          </button>
          <button type="button" onClick={() => setCostFor(null)}>
            {t('取消', 'Cancel', 'Hủy')}
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
          <span className="your-turn">{t('能力', 'Ability', 'Năng lực')}</span>
          {tx(ability.label)}
          {ability.cards > 0 ? t(`：點選下方 ${ability.cards} 張手牌。`, `: tap ${ability.cards} card${ability.cards > 1 ? 's' : ''} below.`, `: chạm ${ability.cards} lá bên dưới.`) : ''}
        </p>
        <div className="choices">
          {ability.targets ? (
            <span className="choice-group">
              <span className="choice-label">{t('目標', 'Target', 'Mục tiêu')}</span>
              {ability.targets.map((q) => (
                <button key={q} type="button" className="primary" disabled={!ready} onClick={() => act({ type: 'ability', ability: ability.id, cards: picked, target: q })}>
                  {v.players[q].name}
                </button>
              ))}
            </span>
          ) : (
            <button type="button" className="primary" disabled={!ready} onClick={() => act({ type: 'ability', ability: ability.id, cards: picked })}>
              {t('確定', 'Confirm', 'Xác nhận')}
            </button>
          )}
          <button type="button" onClick={() => setAbility(null)}>
            {t('取消', 'Cancel', 'Hủy')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`prompt ${mine ? 'is-mine' : ''}`}>
      <p className="prompt-text">
        {mine && <span className="your-turn">{d!.type === 'ask' ? tx(d!.ask.title) : t('輪到你了', 'Your turn', 'Lượt của bạn')}</span>}
        {!mine
          ? describeOthers(v, ctl.waitingOn)
          : d!.type === 'ask'
            ? tx(d!.ask.prompt)
            : v.must != null
              ? t('西部法則：先打出亮出的那張牌（金框）。', 'Law of the West: play the card you showed first (gold frame).', 'Law of the West: đánh lá đã lật trước (khung vàng).')
              : t('你的出牌階段：點一張手牌使用，打完按「結束回合」。', 'Your play phase: tap a card to use it, then press “End turn”.', 'Giai đoạn đánh bài của bạn: chạm một lá để dùng, xong thì bấm “Kết thúc lượt”.')}
        {left != null && <span className={`countdown ${left <= 5 ? 'is-urgent' : ''}`}>{t(`剩 ${left} 秒`, `${left}s left`, `còn ${left} giây`)}</span>}
      </p>

      {d?.type === 'ask' && <AskPanel v={v} ask={d.ask} picked={picked} setPicked={setPicked} act={act} />}
      {d?.type === 'play' && selCard && touch && (
        <div className="selected">
          <p className="sel-desc">
            <b>{t(`【${cN(selCard.key)}】`, `${cN(selCard.key)}: `, `${cN(selCard.key)}: `)}</b>
            {cD(selCard.key)}
          </p>
          <div className="choices">
            {legal.length ? (
              <button type="button" className="primary" onClick={() => openCard(selCard.id)}>
                {t('打出這張牌（或再點一下牌）', 'Play this card (or tap it again)', 'Đánh lá này (hoặc chạm lại lá bài)')}
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
            <b>{t(`【${cN(selCard.key)}】`, `${cN(selCard.key)}: `, `${cN(selCard.key)}: `)}</b>
            {cD(selCard.key)}
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
              <span className="choice-label">{t('場上的綠牌', 'Green cards in play', 'Lá xanh lá trên bàn')}</span>
              {tableCards.map((c) => (
                <button key={c.id} type="button" className={`gear-btn ${selCard?.id === c.id ? 'on' : ''}`} onClick={() => { setSelShop(null); setSel(selCard?.id === c.id ? null : c.id) }}>
                  {cN(c.key)}
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
              {tx(ab.label)}
            </button>
          ))}
          {d?.type === 'play' && (
            <button type="button" className="end-turn" onClick={() => act({ type: 'end_turn' })}>
              {t('結束回合', 'End turn', 'Kết thúc lượt')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function whyNot(v: GameView, c: Card) {
  if (v.suit && c.suit !== v.suit) return t(`手銬：這回合只能出${suitName(v.suit, 'zh')}。`, `Handcuffs: only ${suitName(v.suit, 'en')} this turn.`, `Handcuffs: lượt này chỉ được đánh chất ${suitName(v.suit, 'vi')}.`)
  if (v.must != null && v.must !== c.id) return t('西部法則：要先打出亮出的那張牌。', 'Law of the West: play the card you showed first.', 'Law of the West: phải đánh lá đã lật trước.')
  switch (c.key) {
    case 'missed':
    case 'dodge':
      return t('這張要在被開槍時才能用。', 'This one is played when you are shot.', 'Lá này chỉ đánh khi bạn bị bắn.')
    case 'bang':
      return v.event === 'sermon' ? t('佈道：自己回合不能打「砰！」。', 'The Sermon: no BANG! on your own turn.', 'The Sermon: không được đánh BANG! trong lượt của mình.') : v.bangsUsed > 0 ? t('這回合已經開過槍了。', 'You have already fired this turn.', 'Lượt này bạn đã bắn rồi.') : t('射程內沒有目標。', 'Nobody is in range.', 'Không có ai trong tầm.')
    case 'beer':
      return v.event === 'reverend' ? t('牧師：不能喝啤酒。', 'The Reverend: no Beer.', 'The Reverend: không được uống Beer.') : v.players.filter((p) => p.alive).length <= 2 ? t('只剩兩人時啤酒無效。', 'Beer has no effect with two players left.', 'Beer không có tác dụng khi chỉ còn hai người.') : t('你的生命是滿的。', 'Your life is full.', 'Máu của bạn đã đầy.')
    case 'panic':
      return t('距離 1 以內沒有可以搶的人。', 'Nobody to rob at distance 1.', 'Không có ai ở khoảng cách 1 để lấy bài.')
    default:
      if (v.event === 'judge' && CARD_DEFS[c.key].colour !== 'brown') return t('法官：不能把牌放到場上。', 'The Judge: no cards may be put into play.', 'The Judge: không được đặt bài lên bàn.')
      if (CARD_DEFS[c.key].cost && v.hand.length < 2) return t('這張牌要另外棄 1 張手牌，你手牌不夠。', 'This card needs another card to discard, and you do not have one.', 'Lá này cần bỏ thêm một lá khác, mà bạn không có.')
      return CARD_DEFS[c.key].colour !== 'brown' ? (v.fresh.includes(c.id) ? t('綠牌放上場的回合不能用。', 'A green card cannot be used the turn it comes into play.', 'Lá xanh lá không dùng được trong lượt vừa đặt lên bàn.') : t('你已經有同樣的牌了。', 'You already have that card in play.', 'Bạn đã có lá này trên bàn rồi.')) : t('這張牌現在不能用。', 'This card cannot be played now.', 'Lá này hiện không đánh được.')
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
    const gname = item ? gN(item.key) : ''
    label =
      legal.as === 'golddrop'
        ? t(`付 ${legal.price} 金塊棄掉【${gname}】`, `Pay ${legal.price} nuggets to discard ${gname}`, `Trả ${legal.price} vàng để bỏ ${gname}`)
        : t(
            `${legal.price ? `花 ${legal.price} 金塊` : '免費'}${item && item.key !== legal.as ? `用【${gname}】當作【${name}】` : `買【${gname}】`}`,
            `${item && item.key !== legal.as ? `Use ${gname} as ${name}` : `Buy ${gname}`} (${legal.price ? `${legal.price} nugget${legal.price > 1 ? 's' : ''}` : 'free'})`, `${item && item.key !== legal.as ? `Dùng ${gname} làm ${name}` : `Mua ${gname}`} (${legal.price ? `${legal.price} vàng` : 'miễn phí'})`,
          )
  } else {
    const card = (legal.source === 'table' ? me.table : v.hand).find((c) => c.id === legal.card)!
    const colour = CARD_DEFS[card.key].colour
    label =
      legal.source === 'table'
        ? t(`使用場上的【${name}】`, `Use ${name} in play`, `Dùng ${name} trên bàn`)
        : card.key !== legal.as
          ? t(`把【${cN(card.key)}】當作【${name}】`, `Play ${cN(card.key)} as ${name}`, `Đánh ${cN(card.key)} làm ${name}`)
          : colour !== 'brown'
            ? t(`${colour === 'green' ? '放到場上' : '裝備'}【${name}】`, `${colour === 'green' ? 'Put into play' : 'Equip'}: ${name}`, `${colour === 'green' ? 'Đặt lên bàn' : 'Trang bị'}: ${name}`)
            : t(`使用【${name}】`, `Play ${name}`, `Đánh ${name}`)
  }
  const go = (t?: number, tc?: number | 'hand', t2?: number) => (legal.cost ? onCost(t, tc) : onPlay({ type: 'play', card: legal.card, as: legal.as, target: t, targetCard: tc, target2: t2 }))
  // 連開：選完第一個目標，再選他旁邊的第二個
  if (legal.second && first != null) {
    const opts = legal.second[first] ?? []
    return (
      <span className="choice-group">
        <span className="choice-label">{t(`【連開】第二個目標（${v.players[first].name} 旁邊的人）`, `Fanning: second target (next to ${v.players[first].name})`, `Fanning: mục tiêu thứ hai (cạnh ${v.players[first].name})`)}</span>
        {opts.map((q) => (
          <button key={q} type="button" className="primary" onClick={() => go(first, undefined, q)}>
            {v.players[q].name}
          </button>
        ))}
        {!opts.length && (
          <button type="button" className="primary" onClick={() => go(first)}>
            {t(`只打 ${v.players[first].name}`, `Only ${v.players[first].name}`, `Chỉ ${v.players[first].name}`)}
          </button>
        )}
        <button type="button" onClick={() => setFirst(null)}>
          {t('換人', 'Change target', 'Đổi mục tiêu')}
        </button>
      </span>
    )
  }
  if (!legal.targets) {
    return (
      <button type="button" className="primary" onClick={() => go()}>
        {label}
        {legal.cost ? <small>{t(`另外棄 ${legal.cost} 張`, `+${legal.cost} discard`, `bỏ thêm ${legal.cost}`)}</small> : null}
      </button>
    )
  }
  if (legal.pickCard && target != null) {
    const tg = v.players[target]
    return (
      <span className="choice-group">
        <span className="choice-label">
          {t(`${label}：選 ${tg.name} 的哪一張`, `${label}: which of ${tg.name}’s cards?`, `${label}: lá nào của ${tg.name}?`)}
        </span>
        {!legal.tableOnly && tg.handCount > 0 && (
          <button type="button" className="primary" onClick={() => go(target, 'hand')}>
            {t(`隨機一張手牌（${tg.handCount} 張）`, `A random card from hand (${tg.handCount})`, `Một lá ngẫu nhiên trên tay (${tg.handCount})`)}
          </button>
        )}
        {tg.table.map((c) => (
          <button key={c.id} type="button" className="primary" onClick={() => go(target, c.id)}>
            {t(`場上的【${cN(c.key)}】`, `${cN(c.key)} in play`, `${cN(c.key)} trên bàn`)}
          </button>
        ))}
        <button type="button" onClick={() => setTarget(null)}>
          {t('換人', 'Change target', 'Đổi mục tiêu')}
        </button>
      </span>
    )
  }
  return (
    <span className="choice-group">
      <span className="choice-label">
        {label}
        {legal.cost ? t(`（另外棄 ${legal.cost} 張）`, ` (+${legal.cost} discard)`, ` (bỏ thêm ${legal.cost})`) : ''}
        {t('，目標', ': target', ': mục tiêu')}
      </span>
      {legal.targets.map((q) => {
        const p = v.players[q]
        return (
          <button key={q} type="button" className="primary" onClick={() => (legal.pickCard ? setTarget(q) : legal.second ? setFirst(q) : go(q))}>
            {q === v.me ? t('自己', 'Yourself', 'Chính bạn') : p.name}
            <small>{!p.alive ? t('已死亡', 'Dead', 'Đã chết') : q === v.me ? `♥${p.hp}` : t(`距離 ${p.dist}．♥${p.hp}`, `dist ${p.dist} · ♥${p.hp}`, `cách ${p.dist} · ♥${p.hp}`)}</small>
          </button>
        )
      })}
    </span>
  )
}

const TARGET_LABEL: Partial<Record<AskView['kind'], (name: string, n: number) => string>> = {
  jesse: (name, n) => t(`從 ${name} 手上拿（${n} 張）`, `Take from ${name} (${n})`, `Lấy từ ${name} (${n})`),
  vera: (name) => t(`複製 ${name}`, `Copy ${name}`, `Sao chép ${name}`),
  evelyn: (name) => t(`對 ${name} 開槍`, `Shoot ${name}`, `Bắn ${name}`),
  blood: (name) => t(`給 ${name} 1 點生命`, `Give ${name} 1 life`, `Cho ${name} 1 máu`),
}

/** 需要回答的詢問 */
function AskPanel({ v, ask, picked, setPicked, act }: { v: GameView; ask: AskView; picked: number[]; setPicked: (p: number[]) => void; act: (a: Action) => void }) {
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < ask.max ? [...picked, id] : picked)
  const buttons = (
    <>
      {ask.targets.map((q) => (
        <button key={q} type="button" className="primary" onClick={() => act({ type: 'answer', target: q })}>
          {(TARGET_LABEL[ask.kind] ?? ((n: string) => n))(v.players[q].name, v.players[q].handCount)}
          {ask.kind === 'vera' && v.players[q].character && <small>{chN(v.players[q].character!)}</small>}
        </button>
      ))}
      {ask.table.map((c) => (
        <button key={c.id} type="button" className="primary" onClick={() => act({ type: 'answer', cards: [c.id] })}>
          {t(`用場上的【${cN(c.key)}】`, `Use ${cN(c.key)} in play`, `Dùng ${cN(c.key)} trên bàn`)}
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
          {tx(o.label)}
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
            {ask.min === ask.max ? t(`拿這 ${ask.min} 張`, `Take these ${ask.min}`, `Lấy ${ask.min} lá này`) : t(`拿走選取的 ${picked.length} 張`, `Take the ${picked.length} selected`, `Lấy ${picked.length} lá đã chọn`)}
          </button>
        ) : (
          ask.options.map((o) => (
            <button key={o.id} type="button" className={o.primary ? 'primary' : ''} onClick={() => act({ type: 'answer', opt: o.id })}>
              {tx(o.label)}
            </button>
          ))
        )}
      </div>
    )
  }
  if (ask.kind === 'discard') {
    return (
      <div className="choices">
        <span className="choice-label">{t(`點選下方手牌（${ask.min} 張）`, `Tap ${ask.min} card${ask.min > 1 ? 's' : ''} below`, `Chạm ${ask.min} lá bên dưới`)}</span>
        <button type="button" className="primary" disabled={picked.length !== ask.min} onClick={() => act({ type: 'answer', opt: 'ok', cards: picked })}>
          {t(`棄掉（已選 ${picked.length} 張）`, `Discard (${picked.length} selected)`, `Bỏ (đã chọn ${picked.length})`)}
        </button>
      </div>
    )
  }
  if (ask.kind === 'ranch' || ask.kind === 'bandidos') {
    return (
      <div className="choices">
        <span className="choice-label">
          {ask.kind === 'ranch' ? t('點選下方要換掉的手牌', 'Tap the cards to swap', 'Chạm vào các lá muốn đổi') : t(`點選下方 ${ask.min} 張要棄的手牌`, `Tap ${ask.min} card${ask.min > 1 ? 's' : ''} to discard`, `Chạm ${ask.min} lá để bỏ`)}
          {t(`（已選 ${picked.length} 張）`, ` (${picked.length} selected)`, ` (đã chọn ${picked.length})`)}
        </span>
        {buttons}
      </div>
    )
  }
  return (
    <div className="choices">
      {ask.cards.some((id) => v.hand.some((c) => c.id === id)) && <span className="choice-label">{t('點亮的手牌可以直接打出', 'Highlighted cards can be played directly', 'Lá được tô sáng có thể đánh ngay')}</span>}
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
    <ol className="log" ref={ref} aria-label={t('遊戲紀錄', 'Game log', 'Nhật ký ván')} aria-live="polite">
      {v.log.map((l) => (
        <li
          key={l.seq}
          className={logClass(l)}
        >
          {tx(l.text)}
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
        {t('看結算', 'Show results', 'Xem kết quả')}
      </button>
    )
  if (mode === 'log')
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label={t('整局紀錄', 'Full game log', 'Nhật ký cả ván')}>
        <div className="result result-log">
          <div className="result-log-head">
            <h2>{t('整局紀錄', 'Full game log', 'Nhật ký cả ván')}</h2>
            <button type="button" className="primary" onClick={() => setMode('summary')}>
              {t('回到結算', 'Back to results', 'Về kết quả')}
            </button>
          </div>
          <ol className="log full-log">
            {history.map((l) => (
              <li key={l.seq} className={logClass(l)}>
                {tx(l.text)}
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t('遊戲結果', 'Results', 'Kết quả')}>
      <div className="result">
        <h2>{won ? t('你贏了', 'You won', 'Bạn thắng') : t('你輸了', 'You lost', 'Bạn thua')}</h2>
        <p>{tx(r.reason)}</p>
        <table>
          <tbody>
            {v.players.map((p) => (
              <tr key={p.seat} className={r.winners.includes(p.seat) ? 'is-win' : ''}>
                <td>{p.name}</td>
                <td>{p.role ? roleName(p.role, L()) : ''}</td>
                <td>{p.character ? chN(p.character) : ''}</td>
                <td>{r.winners.includes(p.seat) ? t('勝利', 'Won', 'Thắng') : p.alive ? '' : t('死亡', 'Dead', 'Đã chết')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="result-actions">
          <button type="button" onClick={() => setMode('log')}>
            {t('查看整局紀錄', 'Full game log', 'Nhật ký cả ván')}
          </button>
          <button type="button" onClick={() => setMode('hidden')}>
            {t('看牌桌', 'View table', 'Xem bàn chơi')}
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
      <span className="nugget" title={t('金塊', 'Gold nuggets', 'Vàng')}>
        {n}
      </span>
      {items.map((x) => (
        <span key={x.uid} className="gear g-gold" title={gD(x.key)}>
          {gN(x.key)}
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
        {t('商店', 'Shop', 'Cửa hàng')}
        <small>{t(`你有 ${v.myNuggets} 金塊．裝備牌堆 ${v.goldDeck} 張`, `You have ${v.myNuggets} nugget${v.myNuggets === 1 ? '' : 's'} · ${v.goldDeck} in the equipment deck`, `Bạn có ${v.myNuggets} vàng · ${v.goldDeck} lá trong chồng trang bị`)}</small>
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
            title={gD(x.key)}
            onClick={() => setSelShop(selShop === x.uid ? null : x.uid)}
          >
            <b>{gN(x.key)}</b>
            <span className="price">{x.free ? t('免費', 'Free', 'Miễn phí') : t(`${def.cost} 金`, `${def.cost} gold`, `${def.cost} vàng`)}</span>
            <small>{gD(x.key)}</small>
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
          <summary>{t('付金塊棄掉別人的裝備', 'Pay nuggets to discard someone’s equipment', 'Trả vàng để bỏ trang bị của người khác')}</summary>
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
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t(`打出【${cN(card.key)}】`, `Play ${cN(card.key)}`, `Đánh ${cN(card.key)}`)} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <CardFace card={card} small />
          <p>
            <b>{t(`【${cN(card.key)}】`, `${cN(card.key)}: `, `${cN(card.key)}: `)}</b>
            {cD(card.key)}
          </p>
        </div>
        <div className="choices sheet-choices">
          {legal.map((l) => (
            <PlayOptions key={`${l.as}-${l.source}`} legal={l} v={v} onPlay={onPlay} onCost={(t, tc) => onCost(l, t, tc)} />
          ))}
          {!legal.length && <span className="muted">{whyNot(v, card)}</span>}
        </div>
        <button type="button" className="sheet-close" onClick={onClose}>
          {t('取消', 'Cancel', 'Hủy')}
        </button>
      </div>
    </div>
  )
}
