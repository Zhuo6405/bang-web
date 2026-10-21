import { DurableObject } from 'cloudflare:workers'
import { AI_NAMES, EXPANSIONS, MAX_PLAYERS, maxPlayersFor, MIN_PLAYERS } from '../engine/data'
import { AI_NAMES_EN, AI_NAMES_VI, bi } from '../engine/i18n'
import type { Action, GameConfig, GameState } from '../engine/types'
import { viewFor } from '../engine/view'
import {
  isCode,
  makeCode,
  normaliseCode,
  type ChatMsg,
  type GamePacket,
  type Member,
  type RoomInfo,
  type RoomSettings,
  type ToClient,
  type ToServer,
} from '../shared/protocol'
import { GameRunner, ONLINE_TIMEOUTS } from '../shared/runner'

// ───────────────────────── 入口：靜態網頁、開房、WebSocket ─────────────────────────

interface Env {
  ROOMS: DurableObjectNamespace<Room>
  ASSETS: Fetcher
  /** 選填：Cloudflare TURN 金鑰，讓語音在擋 P2P 的網路也能通 */
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/api/new') return Response.json({ code: makeCode() })
    if (url.pathname === '/api/ice') return iceServers(env)
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9]+)$/)
    if (m) {
      const code = normaliseCode(m[1])
      if (!isCode(code)) return new Response('bad code', { status: 400 })
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code))
      const u = new URL(req.url)
      u.searchParams.set('code', code)
      return stub.fetch(new Request(u.toString(), req))
    }
    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>

const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]

/** 語音用的 ICE 伺服器：有設定 TURN 金鑰就產生短期憑證，沒有就只用 STUN */
async function iceServers(env: Env): Promise<Response> {
  if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      })
      if (r.ok) {
        const j = (await r.json()) as { iceServers: unknown }
        return Response.json({ iceServers: j.iceServers, turn: true })
      }
    } catch {
      /* 失敗就退回只用 STUN */
    }
  }
  return Response.json({ iceServers: STUN, turn: false })
}

// ───────────────────────── 房間（Durable Object）─────────────────────────

interface Saved {
  code: string
  ownerId: string
  members: Member[]
  settings: RoomSettings
  started: boolean
  config: GameConfig | null
  state: GameState | null
  chat: ChatMsg[]
  gameId: string
}

const GRACE_MS = 15_000
const IDLE_DELETE_MS = 7 * 24 * 3600_000

/**
 * 每個邀請碼對應一個房間物件。遊戲狀態只存在這裡（權威端），
 * 每位玩家只會收到 viewFor(自己座位) 的資料。
 */
export class Room extends DurableObject<Env> {
  private d: Saved | null = null
  private sockets = new Map<WebSocket, string | null>()
  private runner: GameRunner | null = null
  private grace = new Map<string, ReturnType<typeof setTimeout>>()
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => {
      this.d = (await ctx.storage.get<Saved>('room')) ?? null
      if (this.d) for (const m of this.d.members) m.connected = false
    })
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const code = url.searchParams.get('code') ?? ''
    const create = url.searchParams.get('create') === '1'
    const pair = new WebSocketPair()
    const [client, ws] = Object.values(pair)
    ws.accept()
    if (!this.d && create) {
      this.d = {
        code,
        ownerId: '',
        members: [],
        settings: { count: 5, expansions: [] },
        started: false,
        config: null,
        state: null,
        chat: [],
        gameId: '',
      }
    }
    if (!this.d) {
      this.send(ws, { t: 'rejected', reason: bi('找不到這個房間，請確認邀請碼。', 'Room not found. Check the invite code.', 'Không tìm thấy phòng. Hãy kiểm tra mã mời.') })
      ws.close(4004, 'no room')
      return new Response(null, { status: 101, webSocket: client })
    }
    this.sockets.set(ws, null)
    void this.ctx.storage.deleteAlarm()
    ws.addEventListener('message', (e) => {
      try {
        this.onMessage(ws, JSON.parse(String(e.data)) as ToServer)
      } catch (err) {
        console.error('bad message', err)
      }
    })
    ws.addEventListener('close', () => this.onClose(ws))
    ws.addEventListener('error', () => this.onClose(ws))
    return new Response(null, { status: 101, webSocket: client })
  }

  /** 房間閒置太久就清掉 */
  async alarm() {
    if (this.sockets.size === 0) {
      this.runner?.dispose()
      this.runner = null
      this.d = null
      await this.ctx.storage.deleteAll()
    }
  }

  // ───────── 傳送 ─────────

  private send(ws: WebSocket, msg: ToClient) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* 已關閉 */
    }
  }

  private socketsOf(clientId: string) {
    return [...this.sockets].filter(([, id]) => id === clientId).map(([ws]) => ws)
  }

  private broadcastRoom() {
    for (const [ws, id] of this.sockets) if (id) this.send(ws, { t: 'room', room: this.roomInfo(), you: id })
    this.persist()
  }

  private roomInfo(): RoomInfo {
    const d = this.d!
    return { code: d.code, ownerId: d.ownerId, members: d.members.map((m) => ({ ...m })), settings: { ...d.settings }, started: d.started }
  }

  private packetFor(seat: number): GamePacket | null {
    const r = this.runner
    if (!r || !this.d) return null
    return {
      view: viewFor(r.state, seat),
      waitingOn: r.waitingOn(),
      deadline: r.deadline,
      aiControlled: this.d.members.filter((m) => m.seat != null && !r.isHuman(m.seat)).map((m) => m.seat!),
      gameId: this.d.gameId,
    }
  }

  private pushGame() {
    if (!this.d) return
    if (this.runner) this.d.state = this.runner.state
    for (const m of this.d.members) {
      const game = this.d.started && m.seat != null ? this.packetFor(m.seat) : null
      for (const ws of this.socketsOf(m.clientId)) this.send(ws, { t: 'game', game })
    }
    this.persist()
  }

  private persist(now = false) {
    stopTimer(this.saveTimer)
    const save = () => {
      if (this.d) void this.ctx.storage.put('room', { ...this.d, chat: this.d.chat.slice(-100) })
    }
    if (now) save()
    else this.saveTimer = setTimeout(save, 800)
  }

  // ───────── 連線 ─────────

  private memberOf(ws: WebSocket) {
    const id = this.sockets.get(ws)
    return id ? (this.d?.members.find((m) => m.clientId === id) ?? null) : null
  }

  private onMessage(ws: WebSocket, msg: ToServer) {
    if (!this.d || !msg || typeof msg !== 'object') return
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' })
    if (msg.t === 'hello') return this.onHello(ws, String(msg.clientId ?? '').slice(0, 40), String(msg.name ?? '').trim().slice(0, 12) || 'Player')
    const m = this.memberOf(ws)
    if (!m) return
    const d = this.d
    const isOwner = m.clientId === d.ownerId
    switch (msg.t) {
      case 'settings':
        if (isOwner && !d.started) this.updateSettings(msg.patch ?? {})
        break
      case 'start':
        if (isOwner && !d.started) this.start(msg.lang === 'en' || msg.lang === 'vi' ? msg.lang : 'zh')
        break
      case 'backToRoom':
        if (isOwner && d.started && (!this.runner || this.runner.state.result)) this.backToRoom()
        break
      case 'action': {
        if (!this.runner || m.seat == null) return
        const err = this.runner.submit(m.seat, msg.action as Action)
        if (err) this.send(ws, { t: 'error', msg: err })
        break
      }
      case 'chat': {
        const text = String(msg.text ?? '').trim().slice(0, 300)
        if (text) this.pushChat({ id: crypto.randomUUID(), clientId: m.clientId, name: m.name, text, ts: Date.now() })
        break
      }
      case 'voice':
        m.inVoice = !!msg.on
        this.broadcastRoom()
        break
      case 'rtc':
        for (const to of this.socketsOf(String(msg.to))) this.send(to, { t: 'rtc', from: m.clientId, data: msg.data })
        break
    }
  }

  private onHello(ws: WebSocket, clientId: string, name: string) {
    const d = this.d!
    if (!clientId) return
    let m = d.members.find((x) => x.clientId === clientId)
    if (m) {
      const wasOff = !m.connected
      m.connected = true
      stopTimer(this.grace.get(clientId))
      if (wasOff && d.started) this.system(bi(`${m.name} 重新連線。`, `${m.name} is back.`, `${m.name} đã quay lại.`))
    } else {
      if (d.started) {
        this.send(ws, { t: 'rejected', reason: bi('這局已經開始了，等下一局再加入。', 'This game has already started. Join the next one.', 'Ván này đã bắt đầu. Hãy vào ván sau.') })
        return ws.close(4003, 'started')
      }
      if (d.members.length >= MAX_PLAYERS) {
        this.send(ws, { t: 'rejected', reason: bi(`房間已滿（最多 ${MAX_PLAYERS} 人）。`, `The room is full (at most ${MAX_PLAYERS} players).`, `Phòng đã đầy (tối đa ${MAX_PLAYERS} người).`) })
        return ws.close(4003, 'full')
      }
      let nm = name
      for (let i = 2; d.members.some((x) => x.name === nm); i++) nm = `${name}${i}`
      m = { clientId, name: nm, connected: true, seat: null, inVoice: false }
      d.members.push(m)
      if (!d.ownerId || !d.members.some((x) => x.clientId === d.ownerId)) d.ownerId = clientId
      if (d.settings.count < d.members.length) d.settings = { ...d.settings, count: Math.min(MAX_PLAYERS, d.members.length) }
      this.system(bi(`${nm} 加入房間。`, `${nm} joined the room.`, `${nm} đã vào phòng.`))
    }
    this.sockets.set(ws, clientId)
    this.send(ws, { t: 'chat', msgs: d.chat.slice(-100), replace: true })
    this.ensureRunner()
    if (this.runner && m.seat != null) this.runner.setHuman(m.seat, true)
    this.broadcastRoom()
    this.pushGame()
  }

  private onClose(ws: WebSocket) {
    if (!this.sockets.has(ws)) return
    const id = this.sockets.get(ws)
    this.sockets.delete(ws)
    const d = this.d
    if (!d || !id) return
    const m = d.members.find((x) => x.clientId === id)
    if (!m || this.socketsOf(id).length) return // 同一人還有別的分頁連著
    m.connected = false
    m.inVoice = false
    if (!d.started) {
      d.members = d.members.filter((x) => x !== m)
      if (d.ownerId === id) d.ownerId = d.members[0]?.clientId ?? ''
      this.system(bi(`${m.name} 離開房間。`, `${m.name} left the room.`, `${m.name} đã rời phòng.`))
    } else if (m.seat != null) {
      const seat = m.seat
      this.system(bi(`${m.name} 斷線了，${GRACE_MS / 1000} 秒內沒回來會由 AI 代打。`, `${m.name} disconnected; the computer takes over if they are not back within ${GRACE_MS / 1000} seconds.`, `${m.name} mất kết nối; máy sẽ chơi thay nếu không quay lại trong ${GRACE_MS / 1000} giây.`))
      this.grace.set(
        id,
        setTimeout(() => {
          if (!m.connected && this.runner) {
            this.runner.setHuman(seat, false)
            this.system(bi(`${m.name} 由 AI 代打中。`, `The computer is playing for ${m.name}.`, `Máy đang chơi thay ${m.name}.`))
          }
        }, GRACE_MS),
      )
    }
    // 沒有人在線：暫停遊戲，等有人回來再繼續
    if (!d.members.some((x) => x.connected)) {
      if (this.runner) d.state = this.runner.state
      this.runner?.dispose()
      this.runner = null
      for (const t of this.grace.values()) stopTimer(t)
      this.persist(true)
      void this.ctx.storage.setAlarm(Date.now() + IDLE_DELETE_MS)
      return
    }
    this.broadcastRoom()
  }

  // ───────── 房間設定與聊天 ─────────

  private updateSettings(p: Partial<RoomSettings>) {
    const d = this.d!
    const next = { ...d.settings, ...p }
    const ok = new Set(EXPANSIONS.filter((e) => e.ready).map((e) => e.id))
    next.expansions = Array.isArray(next.expansions) ? next.expansions.filter((x) => ok.has(x)) : []
    // 道奇城才能 8 人；人已經太多就自動加上道奇城
    if (d.members.length > maxPlayersFor(next.expansions)) next.expansions = [...next.expansions, 'dodge_city']
    next.aiLevel = next.aiLevel === 'easy' || next.aiLevel === 'hard' ? next.aiLevel : 'normal'
    next.count = Math.max(MIN_PLAYERS, Math.min(maxPlayersFor(next.expansions), Math.max(Number(next.count) || MIN_PLAYERS, d.members.length)))
    d.settings = next
    this.broadcastRoom()
  }

  private system(text: string) {
    this.pushChat({ id: crypto.randomUUID(), clientId: null, name: bi('系統', 'System', 'Hệ thống'), text, ts: Date.now(), system: true })
  }

  private pushChat(msg: ChatMsg) {
    const d = this.d!
    d.chat.push(msg)
    if (d.chat.length > 300) d.chat = d.chat.slice(-200)
    for (const [ws, id] of this.sockets) if (id) this.send(ws, { t: 'chat', msgs: [msg] })
    this.persist()
  }

  // ───────── 遊戲 ─────────

  private start(lang: 'zh' | 'en' | 'vi' = 'zh') {
    const d = this.d!
    const humans = d.members.filter((m) => m.connected)
    const n = Math.max(d.settings.count, humans.length)
    d.members = humans
    // 座位隨機：真人和電腦打散坐
    const order = Array.from({ length: n }, (_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    humans.forEach((m, i) => (m.seat = order[i]))
    const used = new Set(humans.map((m) => m.name))
    const aiNames = (lang === 'en' ? AI_NAMES_EN : lang === 'vi' ? AI_NAMES_VI : AI_NAMES).filter((x) => !used.has(x)).sort(() => Math.random() - 0.5)
    const seatNames: string[] = Array(n).fill('')
    const ai: boolean[] = Array(n).fill(true)
    humans.forEach((m) => {
      seatNames[m.seat!] = m.name
      ai[m.seat!] = false
    })
    let k = 0
    for (let i = 0; i < n; i++) if (!seatNames[i]) seatNames[i] = aiNames[k++] ?? (lang === 'zh' ? `電腦${k}` : `Bot ${k}`)
    const config: GameConfig = {
      names: seatNames,
      ai,
      seed: (Math.random() * 2 ** 31) | 0,
      expansions: d.settings.expansions,
      aiLevel: d.settings.aiLevel ?? 'normal',
    }
    d.config = config
    d.state = null
    d.started = true
    d.gameId = crypto.randomUUID()
    this.runner?.dispose()
    this.runner = null
    this.ensureRunner()
    this.system(bi(`遊戲開始！${n} 人局，${n - humans.length} 位電腦補位。`, `Game on! ${n} players, ${n - humans.length} of them computers.`, `Bắt đầu! ${n} người chơi, trong đó ${n - humans.length} máy.`))
    this.broadcastRoom()
    this.pushGame()
  }

  /** 遊戲進行中但記憶體裡沒有執行器時（伺服器重啟、大家都離開過），從存檔接回來 */
  private ensureRunner() {
    const d = this.d!
    if (this.runner || !d.started || !d.config) return
    const seats = d.members.filter((m) => m.seat != null).map((m) => m.seat!)
    this.runner = new GameRunner(d.config, seats, { aiDelay: 750, timeouts: ONLINE_TIMEOUTS }, d.state ?? undefined)
    this.runner.subscribe(() => this.pushGame())
    // 還沒回來的人先給一段時間
    for (const m of d.members) {
      if (m.connected || m.seat == null) continue
      const seat = m.seat
      stopTimer(this.grace.get(m.clientId))
      this.grace.set(
        m.clientId,
        setTimeout(() => {
          if (!m.connected) this.runner?.setHuman(seat, false)
        }, GRACE_MS * 2),
      )
    }
  }

  private backToRoom() {
    const d = this.d!
    this.runner?.dispose()
    this.runner = null
    d.started = false
    d.config = null
    d.state = null
    for (const t of this.grace.values()) stopTimer(t)
    d.members = d.members.filter((m) => m.connected)
    d.members.forEach((m) => (m.seat = null))
    if (!d.members.some((m) => m.clientId === d.ownerId)) d.ownerId = d.members[0]?.clientId ?? ''
    this.broadcastRoom()
    this.pushGame()
  }
}

/** 兼容瀏覽器、Node 與 Workers 的計時器型別 */
function stopTimer(t: ReturnType<typeof setTimeout> | undefined) {
  if (t !== undefined) clearTimeout(t)
}
