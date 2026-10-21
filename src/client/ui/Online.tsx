import { useEffect, useState } from 'react'
import { maxPlayersFor, MIN_PLAYERS } from '../../engine/data'
import type { RoomSession } from '../net/session'
import { VoiceMesh } from '../net/voice'
import { useStore, type GameController, type Social } from './controller'
import { DocsButtons } from './Docs'
import { GameScreen } from './Game'
import { ExpansionPicker, LevelPicker } from './Lobby'
import { LangToggle, t, tx } from '../lang'
import { ChatPanel, VoiceControls } from './social'

export function inviteLink(code: string) {
  const u = new URL(location.origin + location.pathname)
  u.searchParams.set('room', code)
  return u.toString()
}

/** 連線遊戲：房間畫面與牌桌都由伺服器的資料驅動 */
export function OnlineScreen({ session, onExit }: { session: RoomSession; onExit: () => void }) {
  useStore(session)
  const [voice, setVoice] = useState<VoiceMesh | null>(null)
  useEffect(() => {
    const v = new VoiceMesh(session)
    setVoice(v)
    return () => v.dispose()
  }, [session])
  const room = session.room
  const roster = (room?.members ?? []).filter((m) => m.inVoice && m.connected).map((m) => m.clientId)
  const rosterKey = roster.join(',')
  useEffect(() => {
    voice?.sync(roster)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, rosterKey])

  const leave = () => {
    session.leave()
    onExit()
  }

  if (session.status === 'closed') return <Centered text={session.error ? tx(session.error) : t('連線已結束', 'The connection has ended', 'Kết nối đã kết thúc')} action={onExit} actionLabel={t('回到大廳', 'Back to lobby', 'Về sảnh')} />
  if (!room) return <Centered text={t(`正在連線到房間 ${session.code}…`, `Connecting to room ${session.code}…`, `Đang kết nối tới phòng ${session.code}…`)} action={leave} actionLabel={t('取消', 'Cancel', 'Hủy')} />

  const banner = session.status === 'reconnecting' && <div className="banner">{t('連線中斷，正在重新連線…', 'Connection lost, reconnecting…', 'Mất kết nối, đang kết nối lại…')}</div>
  const social: Social = { me: session.me, room, chat: session.chat, say: session.say, voice }
  const g = session.game
  if (g && room.started) {
    const ctl: GameController = {
      view: g.view,
      act: session.act,
      error: session.lastError,
      clearError: session.clearError,
      waitingOn: g.waitingOn,
      deadline: g.deadline,
      aiControlled: g.aiControlled,
    }
    return (
      <>
        {banner}
        <GameScreen
          ctl={ctl}
          social={social}
          onExit={leave}
          exitLabel={t('離開房間', 'Leave room', 'Rời phòng')}
          historyId={`online-${g.gameId}`}
          topExtra={<span className="room-code">{t('房號', 'Room', 'Phòng')} {room.code}</span>}
          resultActions={
            session.isOwner ? (
              <>
                <button type="button" className="primary" onClick={session.backToRoom}>
                  {t('回到房間再來一局', 'Back to the room for another game', 'Về phòng để chơi ván khác')}
                </button>
                <button type="button" onClick={leave}>
                  {t('離開房間', 'Leave room', 'Rời phòng')}
                </button>
              </>
            ) : (
              <>
                <span className="muted">{t('等房主開新的一局…', 'Waiting for the host to start a new game…', 'Đang chờ chủ phòng bắt đầu ván mới…')}</span>
                <button type="button" onClick={leave}>
                  {t('離開房間', 'Leave room', 'Rời phòng')}
                </button>
              </>
            )
          }
        />
      </>
    )
  }
  return (
    <>
      {banner}
      <RoomView session={session} voice={voice} onLeave={leave} />
    </>
  )
}

function RoomView({ session, voice, onLeave }: { session: RoomSession; voice: VoiceMesh | null; onLeave: () => void }) {
  const room = session.room!
  const isOwner = session.isOwner
  const [copied, setCopied] = useState(false)
  const s = room.settings
  const humans = room.members.length
  const ai = Math.max(0, s.count - humans)
  const owner = room.members.find((m) => m.clientId === room.ownerId)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(room.code))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      prompt(t('複製這個連結傳給朋友：', 'Copy this link and send it to your friends:', 'Sao chép đường dẫn này và gửi cho bạn bè:'), inviteLink(room.code))
    }
  }

  return (
    <div className="room">
      <header className="topbar">
        <span className="brand">BANG!</span>
        <span className="turn">{t('房間', 'Room', 'Phòng')}</span>
        <VoiceControls voice={voice} speakers={room.members.filter((m) => m.inVoice).length} />
        <DocsButtons />
        <LangToggle />
        <button type="button" className="ghost" onClick={onLeave}>
          {t('離開房間', 'Leave room', 'Rời phòng')}
        </button>
      </header>

      <div className="room-body">
        <section className="room-main">
          <div className="invite">
            <span className="invite-label">{t('邀請碼', 'Invite code', 'Mã mời')}</span>
            <span className="invite-code" aria-label={`${t('邀請碼', 'Invite code', 'Mã mời')} ${room.code.split('').join(' ')}`}>
              {room.code}
            </span>
            <button type="button" className="primary" onClick={() => void copy()}>
              {copied ? t('已複製連結', 'Link copied', 'Đã sao chép đường dẫn') : t('複製邀請連結', 'Copy invite link', 'Sao chép đường dẫn mời')}
            </button>
            <p className="muted">{t('朋友打開連結、輸入名字就能加入，任何網路都可以。', 'Friends open the link and enter a name to join, from any network.', 'Bạn bè mở đường dẫn và nhập tên là vào được, mạng nào cũng được.')}</p>
          </div>

          <h2>
            {t('玩家', 'Players', 'Người chơi')} ({humans} / {s.count})
          </h2>
          <ul className="members">
            {room.members.map((m) => (
              <li key={m.clientId} className={m.connected ? '' : 'is-off'}>
                <span className="m-name">
                  {m.name}
                  {m.clientId === session.me && <span className="seat-you">{t('你', 'You', 'Bạn')}</span>}
                </span>
                {m.clientId === room.ownerId && <span className="tag">{t('房主', 'Host', 'Chủ phòng')}</span>}
                {m.inVoice && <span className="tag tag-voice">{t('語音中', 'On voice', 'Đang nói')}</span>}
                {!m.connected && <span className="tag">{t('斷線', 'Offline', 'Mất kết nối')}</span>}
              </li>
            ))}
            {Array.from({ length: ai }, (_, i) => (
              <li key={`ai${i}`} className="is-ai">
                <span className="m-name">{t('電腦補位', 'Computer player', 'Người chơi máy')}</span>
              </li>
            ))}
          </ul>

          <h2>{t('設定', 'Settings', 'Cài đặt')}</h2>
          {isOwner ? (
            <div className="room-settings">
              <div className="field">
                <span>{t('遊戲人數（人不夠會由電腦補位）', 'Players (computers fill empty seats)', 'Số người chơi (thiếu người thì máy chơi thay)')}</span>
                <div className="segmented" role="radiogroup" aria-label={t('遊戲人數', 'Number of players', 'Số người chơi')}>
                  {Array.from({ length: maxPlayersFor(s.expansions) - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={n === s.count} className={n === s.count ? 'on' : ''} disabled={n < humans} onClick={() => session.updateSettings({ count: n })}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <ExpansionPicker value={s.expansions} onChange={(v) => session.updateSettings({ expansions: v })} />
              <LevelPicker value={s.aiLevel ?? 'normal'} onChange={(v) => session.updateSettings({ aiLevel: v })} />
              <button type="button" className="primary start" onClick={session.start}>
                {t('開始遊戲', 'Start game', 'Bắt đầu')}
                {ai > 0 ? t(`（${ai} 位電腦補位）`, ` (${ai} computer player${ai > 1 ? 's' : ''})`, ` (${ai} người chơi máy)`) : ''}
              </button>
            </div>
          ) : (
            <p className="room-readonly">
              {t(`${s.count} 人局`, `${s.count} players`, `${s.count} người chơi`)}
              {s.expansions.length ? t(`．擴充 ${s.expansions.length} 個`, ` · ${s.expansions.length} expansion${s.expansions.length > 1 ? 's' : ''}`, ` · ${s.expansions.length} bản mở rộng`) : t('．基本版', ' · base game', ' · bản cơ bản')}
              {t(`．電腦${{ easy: '簡單', normal: '普通', hard: '困難' }[s.aiLevel ?? 'normal']}`, ` · ${{ easy: 'easy', normal: 'normal', hard: 'hard' }[s.aiLevel ?? 'normal']} computers`, ` · máy ${{ easy: 'dễ', normal: 'thường', hard: 'khó' }[s.aiLevel ?? 'normal']}`)}
              <br />
              <span className="muted">{t(`等房主${owner ? `（${owner.name}）` : ''}開始遊戲…`, `Waiting for the host${owner ? ` (${owner.name})` : ''} to start…`, `Đang chờ chủ phòng${owner ? ` (${owner.name})` : ''} bắt đầu…`)}</span>
            </p>
          )}
        </section>

        <aside className="room-chat">
          <h2>{t('聊天', 'Chat', 'Trò chuyện')}</h2>
          <ChatPanel chat={session.chat} me={session.me} say={session.say} />
        </aside>
      </div>
    </div>
  )
}

export function Centered({ text, action, actionLabel }: { text: string; action?: () => void; actionLabel?: string }) {
  return (
    <main className="centered">
      <p>{text}</p>
      {action && (
        <button type="button" onClick={action}>
          {actionLabel}
        </button>
      )}
    </main>
  )
}
