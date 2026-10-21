import type React from 'react'
import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeElements } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { GUN, smooth } from './gunTiming'
import { clampedPosition, keepVisible } from './plateClamp'
import { CARD_DEFS } from '../../engine/data'
import { cardDesc, cardName, charName, eventName, eventText, goldDesc, goldName, roleName } from '../../engine/i18n'
import { getLang, t as tr } from '../lang'
import type { Card, Fx, GoldKey } from '../../engine/types'
import type { GameView, PublicPlayer } from '../../engine/view'
import { cardBackTexture, cardTexture, clearTextures, eventTexture, tagTexture, wordTexture } from './textures'

// 3D 酒館牌桌：圍坐的牛仔、桌上的裝備、拔槍射擊

const TABLE_R = 3.4
const SEAT_R = 4.35
const TABLE_Y = 0.92
const COATS = ['#6b4a2e', '#3f4a5a', '#7a3b2a', '#4d5233', '#5b4a6b', '#2e4a48', '#8a6a3a', '#3b3f45']
const BANDANAS = ['#a3262a', '#1f4e8a', '#c9a227', '#2f6b3a', '#7b2a6b', '#d0662a', '#e8e0d0', '#222']
const HATS = ['#3a2516', '#1e1a18', '#5a3d22', '#2a2a2a', '#6b4a2e', '#1f1a14', '#4a3018', '#2b2116']

const FIRE_AT = GUN.fire // 舉槍後多久開火（中間要先裝子彈）

function seatAngle(seat: number, me: number, n: number) {
  return (((seat - me + n) % n) / n) * Math.PI * 2
}
const polar = (theta: number, r: number, y: number) => new THREE.Vector3(r * Math.sin(theta), y, r * Math.cos(theta))

export type ViewMode = 'first' | 'overview'

/** 名牌固定放進這個容器：避免 drei 在事件連線後換容器、把名牌內容弄丟 */
const PlateHost = createContext<RefObject<HTMLDivElement | null> | null>(null)

// ───────── 特效排程：把引擎的 fx 轉成動畫事件 ─────────

interface Aim {
  t0: number
  /** 這次舉槍要開的每一槍 */
  shots: { target: number; at: number }[]
  until: number
}
interface Pop {
  id: number
  seat: number
  text: string
  colour: string
  t0: number
}
interface Flash {
  id: number
  seat: number
  kind: 'hit' | 'explode' | 'heal'
  t0: number
}
interface Director {
  aims: Map<number, Aim>
  shots: { id: number; from: number; to: number; t0: number }[]
  flashes: Flash[]
  pops: Pop[]
  dodge: Map<number, number>
  version: number
}
const DirCtx = createContext<Director | null>(null)
const useDirector = () => useContext(DirCtx)!

function useFxDirector(v: GameView, clockNow: () => number) {
  const dir = useRef<Director>({ aims: new Map(), shots: [], flashes: [], pops: [], dodge: new Map(), version: 0 })
  const seen = useRef<number>(-1)
  const [, bump] = useState(0)
  useEffect(() => {
    const d = dir.current
    const fresh = v.fx.filter((f) => f.seq > seen.current)
    // 第一次載入不重播舊特效
    if (seen.current < 0) {
      seen.current = v.fx.length ? v.fx[v.fx.length - 1].seq : 0
      return
    }
    if (!fresh.length) return
    seen.current = fresh[fresh.length - 1].seq
    let delay = 0
    for (const f of fresh) {
      const t = clockNow() + delay
      apply(d, f, t)
      if (f.kind === 'shoot') delay += 0.15
    }
    d.version++
    bump((x) => x + 1)
  }, [v.fx, clockNow])
  return dir.current
}

let uid = 1
/** 中彈／躲開的反應要等子彈真的射出去之後 */
function afterShot(d: Director, f: Fx, t: number) {
  if (f.from == null || f.to == null) return 0
  const s = d.aims.get(f.from)?.shots.find((x) => x.target === f.to && x.at > t)
  return s ? s.at - t + 0.06 : 0
}
function apply(d: Director, f: Fx, t: number) {
  const pop = (seat: number, text: string, colour: string, dt = 0) => d.pops.push({ id: uid++, seat, text, colour, t0: t + dt })
  switch (f.kind) {
    case 'shoot': {
      if (f.from == null || f.to == null) return
      // 同一個人還拿著槍（格林機槍連發）：不用再裝子彈，接著開下一槍
      const cur = d.aims.get(f.from)
      let at: number
      if (cur && t < cur.until) {
        at = Math.max(cur.shots[cur.shots.length - 1].at + GUN.repeat, t)
        cur.shots.push({ target: f.to, at })
        cur.until = at + GUN.hold
      } else {
        at = t + FIRE_AT
        d.aims.set(f.from, { t0: t, shots: [{ target: f.to, at }], until: at + GUN.hold })
      }
      d.shots.push({ id: uid++, from: f.from, to: f.to, t0: at })
      pop(f.from, tr('砰！', 'BANG!', 'BANG!'), '#ffcf5a', at - t)
      return
    }
    case 'miss': {
      if (f.to == null) return
      const dt = afterShot(d, f, t)
      pop(f.to, tr('射偏了！', 'Missed!', 'Missed!'), '#cfe8ff', dt)
      d.dodge.set(f.to, t + dt)
      return
    }
    case 'hit': {
      if (f.to == null) return
      const dt = afterShot(d, f, t)
      pop(f.to, `-${f.amount ?? 1}`, '#ff5a4a', dt)
      d.flashes.push({ id: uid++, seat: f.to, kind: 'hit', t0: t + dt })
      return
    }
    case 'heal':
      if (f.to == null) return
      pop(f.to, `+${f.amount ?? 1}`, '#7fe08a')
      d.flashes.push({ id: uid++, seat: f.to, kind: 'heal', t0: t })
      return
    case 'explode':
      if (f.to == null) return
      pop(f.to, tr('轟！', 'BOOM!', 'BÙM!'), '#ff8a2a')
      d.flashes.push({ id: uid++, seat: f.to, kind: 'explode', t0: t })
      return
    case 'death':
      if (f.to != null) pop(f.to, tr('倒下', 'Down', 'Gục'), '#d8d0c0')
      return
    case 'check':
      if (f.to != null && f.card) pop(f.to, f.ok ? tr('判定成功', 'Draw! passed', 'Phán định: đạt') : tr('判定失敗', 'Draw! failed', 'Phán định: trượt'), f.ok ? '#9fe0a0' : '#e0a09f')
      return
  }
}

// ───────── 場景 ─────────

export interface SceneProps {
  v: GameView
  waitingOn: number[]
  aiControlled: number[]
  mode: ViewMode
  /** 第一人稱時，手上被選取的牌（會抬高） */
  selected?: number | null
}

/**
 * 手機瀏覽器在記憶體吃緊時會收回 WebGL：只在「目前畫面上這張畫布」真的被收回時重建一次。
 * 牌桌重建（例如字型載入完）時，舊畫布會被刻意釋放，那不算，否則會一直重建造成閃爍。
 */
let liveCanvas: HTMLCanvasElement | null = null
let rebuilds: number[] = []
function watchContext(canvas: HTMLCanvasElement, rebuild: () => void) {
  liveCanvas = canvas
  const isLive = () => canvas === liveCanvas && canvas.isConnected
  const go = () => {
    if (!isLive()) return
    // 保險：一分鐘內最多重建 3 次
    const now = Date.now()
    rebuilds = rebuilds.filter((x) => now - x < 60_000)
    if (rebuilds.length >= 3) return
    rebuilds.push(now)
    liveCanvas = null
    document.removeEventListener('visibilitychange', onVisible)
    setTimeout(rebuild, 300)
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    if (!isLive()) return
    e.preventDefault()
    go()
  })
  function onVisible() {
    if (!isLive()) return document.removeEventListener('visibilitychange', onVisible)
    if (document.visibilityState !== 'visible') return
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (gl?.isContextLost()) go()
  }
  document.addEventListener('visibilitychange', onVisible)
}

export function TableScene(props: SceneProps) {
  const [fontsReady, setFontsReady] = useState(0)
  // 手機瀏覽器在記憶體吃緊時會收回 WebGL，收回後重新建立牌桌，不會留下一片空白
  const [revive, setRevive] = useState(0)
  useEffect(() => {
    void document.fonts?.ready.then(() => {
      clearTextures()
      setFontsReady((x) => x + 1)
    })
  }, [])
  const host = useRef<HTMLDivElement>(null)
  return (
    <div ref={host} className="scene-host">
      <PlateHost.Provider value={host}>
        <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 6.4, 8.2], fov: 44 }} gl={{ antialias: true }} key={`${fontsReady}-${revive}`} onCreated={({ gl }) => watchContext(gl.domElement, () => setRevive((x) => x + 1))}>
          <Inner {...props} />
        </Canvas>
      </PlateHost.Provider>
    </div>
  )
}

function Inner({ v, waitingOn, aiControlled, mode, selected }: SceneProps) {
  const { clock } = useThree()
  const now = useMemo(() => () => clock.getElapsedTime(), [clock])
  const dir = useFxDirector(v, now)
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  return (
    <DirCtx.Provider value={dir}>
      <color attach="background" args={['#1f140c']} />
      <fog attach="fog" args={['#1f140c', 18, 34]} />
      <ambientLight intensity={0.7} color="#ffe2b8" />
      <hemisphereLight args={['#ffd9a8', '#2a1a10', 0.9]} />
      <directionalLight position={[0, 6, 9]} intensity={0.85} color="#ffe0b4" />
      {mode === 'overview' ? <CameraRig /> : <FirstPersonRig />}
      <Lamp />
      <Saloon />
      <Table />
      <Centre v={v} />
      {v.players.map((p) => (
        <Seat
          key={p.seat}
          p={p}
          v={v}
          theta={seatAngle(p.seat, v.me, v.players.length)}
          acting={waitingOn.includes(p.seat)}
          aiControlled={aiControlled.includes(p.seat)}
          reduced={reduced}
          mode={mode}
        />
      ))}
      {mode === 'first' && <MyHand v={v} selected={selected ?? null} />}
      <Shots v={v} first={mode === 'first'} />
      <Pops v={v} />
      {mode === 'overview' && (
        <OrbitControls
          target={[0, TABLE_Y, 0.2]}
          enablePan={false}
          minDistance={7}
          maxDistance={22}
          minPolarAngle={0.35}
          maxPolarAngle={1.2}
          minAzimuthAngle={-0.9}
          maxAzimuthAngle={0.9}
          enableDamping
        />
      )}
    </DirCtx.Provider>
  )
}

/** 直式螢幕（手機）時把鏡頭拉遠，整張桌子才看得到 */
function CameraRig() {
  const { camera, size } = useThree()
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const k = aspect >= 1.2 ? 1 : 1 + (1.2 - aspect) * 1.25
    camera.position.set(0, 6.4 * k, 8.2 * k)
    camera.lookAt(0, TABLE_Y, 0.2)
  }, [camera, size.width, size.height])
  return null
}

const EYE = new THREE.Vector3(0, 2.35, SEAT_R + 0.3)

/** 第一人稱：坐在自己的位子上，拖曳可以轉頭看其他人 */
function FirstPersonRig() {
  const { camera, size, gl } = useThree()
  const look = useRef({ yaw: 0, pitch: -0.36 })
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const portrait = size.width < size.height
    cam.fov = portrait ? 86 : 70
    cam.updateProjectionMatrix()
    cam.position.copy(EYE)
    if (portrait) cam.position.z += 0.6
    return () => {
      cam.fov = 44
      cam.updateProjectionMatrix()
    }
  }, [camera, size.width, size.height])
  useEffect(() => {
    const el = gl.domElement
    let drag: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const L = look.current
      L.yaw = Math.max(-1.15, Math.min(1.15, L.yaw - (e.clientX - drag.x) * 0.004))
      L.pitch = Math.max(-0.9, Math.min(0.15, L.pitch - (e.clientY - drag.y) * 0.004))
      drag = { x: e.clientX, y: e.clientY }
    }
    const up = () => (drag = null)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [gl])
  useFrame(() => {
    const { yaw, pitch } = look.current
    const d = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    camera.lookAt(camera.position.clone().add(d))
  })
  return null
}

function Lamp() {
  return (
    <group position={[0, 5.4, 0]}>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 3.2]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      {/* 煤油燈 */}
      <mesh castShadow>
        <cylinderGeometry args={[0.5, 0.95, 0.35, 32, 1, true]} />
        <meshStandardMaterial color="#5a3a1c" metalness={0.5} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.1, 0]}>
        <sphereGeometry args={[0.2, 24, 16]} />
        <meshStandardMaterial color="#fff0c0" emissive="#ffc870" emissiveIntensity={3} />
      </mesh>
      <spotLight
        position={[0, -0.1, 0]}
        target-position={[0, -5.4, 0]}
        angle={0.95}
        penumbra={0.7}
        intensity={140}
        decay={1.6}
        color="#ffd496"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <pointLight position={[0, -0.4, 0]} intensity={18} distance={16} decay={1.2} color="#ffc47a" />
    </group>
  )
}

/** 木地板與酒館的牆 */
function Saloon() {
  const planks = useMemo(() => Array.from({ length: 26 }, (_, i) => i), [])
  return (
    <group>
      {planks.map((i) => (
        <mesh key={i} position={[-13 + i + 0.5, 0, 0]} rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[0.98, 30]} />
          <meshStandardMaterial color={i % 3 === 0 ? '#4a301c' : i % 3 === 1 ? '#553722' : '#3f2817'} roughness={0.9} />
        </mesh>
      ))}
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={polar((k * Math.PI) / 2, 13, 4)} rotation-y={(k * Math.PI) / 2 + Math.PI}>
          <planeGeometry args={[26, 8]} />
          <meshStandardMaterial color="#3a2414" roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

function Table() {
  return (
    <group>
      <mesh position={[0, TABLE_Y - 0.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.16, 72]} />
        <meshStandardMaterial color="#5a3518" roughness={0.5} metalness={0.05} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.002, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[TABLE_R - 0.3, 72]} />
        <meshStandardMaterial color="#2f4a2a" roughness={0.95} />
      </mesh>
      <mesh position={[0, TABLE_Y / 2, 0]} castShadow>
        <cylinderGeometry args={[0.35, 0.6, TABLE_Y - 0.1, 24]} />
        <meshStandardMaterial color="#3a2210" roughness={0.6} />
      </mesh>
      {/* 桌上的酒瓶 */}
      <mesh position={[1.1, TABLE_Y + 0.3, 0.6]} castShadow>
        <cylinderGeometry args={[0.09, 0.11, 0.55, 16]} />
        <meshStandardMaterial color="#2f5a2a" roughness={0.2} metalness={0.1} transparent opacity={0.85} />
      </mesh>
      <mesh position={[1.1, TABLE_Y + 0.66, 0.6]}>
        <cylinderGeometry args={[0.03, 0.04, 0.18, 10]} />
        <meshStandardMaterial color="#2f5a2a" roughness={0.2} />
      </mesh>
    </group>
  )
}

function CardMesh({ card, w = 0.42, ...rest }: { card: Card | null; w?: number } & ThreeElements['mesh']) {
  const tex = card ? cardTexture(card, getLang()) : cardBackTexture()
  return (
    <mesh {...rest} receiveShadow>
      <planeGeometry args={[w, w * 1.4]} />
      <meshStandardMaterial map={tex} roughness={0.8} />
    </mesh>
  )
}

/** 桌子中央：牌堆、棄牌堆、雜貨店翻開的牌 */
function Centre({ v }: { v: GameView }) {
  const back = cardBackTexture()
  const h = Math.max(0.01, Math.min(v.deckCount, 60) * 0.006)
  return (
    <group>
      <group position={[-0.45, TABLE_Y + h / 2 + 0.005, -0.3]}>
        <mesh castShadow>
          <boxGeometry args={[0.5, h, 0.7]} />
          <meshStandardMaterial color="#efe3c4" />
        </mesh>
        <mesh position={[0, h / 2 + 0.002, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.5, 0.7]} />
          <meshStandardMaterial map={back} />
        </mesh>
      </group>
      {v.discardTop && <CardMesh card={v.discardTop} w={0.5} position={[0.45, TABLE_Y + 0.02, -0.3]} rotation={[-Math.PI / 2, 0, 0.08]} />}
      {v.event && (
        <mesh position={[0, TABLE_Y + 0.025, -1.25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[0.9, 1.25]} />
          <meshStandardMaterial map={eventTexture(eventName(v.event, getLang()), eventText(v.event, getLang()), getLang())} roughness={0.85} />
        </mesh>
      )}
      {v.store.map((c, i) => (
        <CardMesh key={c.id} card={c} w={0.45} position={[(i - (v.store.length - 1) / 2) * 0.52, TABLE_Y + 0.03, 0.6]} rotation={[-Math.PI / 2, 0, 0]} />
      ))}
    </group>
  )
}

// ───────── 座位上的牛仔 ─────────

function Limb({ from, to, r, color, opacity }: { from: THREE.Vector3; to: THREE.Vector3; r: number; color: string; opacity: number }) {
  const { pos, quat, len } = useMemo(() => {
    const d = to.clone().sub(from)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())
    return { pos: from.clone().add(to).multiplyScalar(0.5), quat: q, len: d.length() }
  }, [from, to])
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <capsuleGeometry args={[r, len, 6, 12]} />
      <meshStandardMaterial color={color} roughness={0.85} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

/** 左輪手槍的活動零件，由動畫每一幀更新 */
interface GunRig {
  cyl: THREE.Group | null
  hammer: THREE.Group | null
  rounds: (THREE.Mesh | null)[]
}
const CHAMBERS = 6

/** 左輪手槍：槍管朝 -y（跟手臂同方向）。轉輪可以甩出來裝子彈 */
function Revolver({ scale = 1, rig }: { scale?: number; rig?: GunRig }) {
  return (
    <group scale={scale} rotation-x={Math.PI / 2}>
      {/* 槍管 */}
      <mesh position={[0, 0.03, 0.15]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.24, 10]} />
        <meshStandardMaterial color="#5d626b" metalness={0.75} roughness={0.32} />
      </mesh>
      {/* 轉輪（含六個彈巢與子彈） */}
      <group position={[0, 0.03, 0.02]} ref={(g) => void (rig && (rig.cyl = g))}>
        <mesh rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.07, 12]} />
          <meshStandardMaterial color="#7a7f88" metalness={0.8} roughness={0.28} />
        </mesh>
        {Array.from({ length: CHAMBERS }, (_, i) => {
          const a = (i / CHAMBERS) * Math.PI * 2
          return (
            <mesh key={`h${i}`} position={[Math.cos(a) * 0.024, Math.sin(a) * 0.024, -0.036]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.01, 0.01, 0.004, 10]} />
              <meshStandardMaterial color="#0a0a0a" />
            </mesh>
          )
        })}
        {[0, 1, 2].map((i) => {
          const a = (i / CHAMBERS) * Math.PI * 2
          return (
            <mesh key={`r${i}`} ref={(m) => void (rig && (rig.rounds[i] = m))} position={[Math.cos(a) * 0.024, Math.sin(a) * 0.024, -0.036]} rotation-x={Math.PI / 2} visible={false}>
              <cylinderGeometry args={[0.0095, 0.0095, 0.036, 10]} />
              <meshStandardMaterial color="#f0c050" metalness={0.85} roughness={0.2} emissive="#7a5010" emissiveIntensity={0.8} />
            </mesh>
          )
        })}
      </group>
      {/* 槍身 */}
      <mesh position={[0, 0.035, -0.04]} castShadow>
        <boxGeometry args={[0.035, 0.06, 0.08]} />
        <meshStandardMaterial color="#545961" metalness={0.75} roughness={0.35} />
      </mesh>
      {/* 擊錘 */}
      <group position={[0, 0.06, -0.075]} ref={(g) => void (rig && (rig.hammer = g))}>
        <mesh position={[0, 0.015, 0]}>
          <boxGeometry args={[0.012, 0.035, 0.014]} />
          <meshStandardMaterial color="#545961" metalness={0.75} roughness={0.35} />
        </mesh>
      </group>
      {/* 木握把 */}
      <mesh position={[0, -0.03, -0.075]} rotation-x={-0.45} castShadow>
        <boxGeometry args={[0.032, 0.12, 0.045]} />
        <meshStandardMaterial color="#6b3e1e" roughness={0.6} />
      </mesh>
    </group>
  )
}

/** 依時間軸擺動轉輪、子彈、擊錘。age = 舉槍後經過的秒數 */
function animateGun(rig: GunRig, age: number, aim: Aim | undefined, now: number) {
  const reload = !aim || aim.shots.length === 0 || age < GUN.fire + 0.05
  // 轉輪甩出來（往左邊）再合上
  const open = smooth(GUN.open[0], GUN.open[1], age) * (1 - smooth(GUN.spin[1] - 0.04, GUN.close + 0.05, age))
  if (rig.cyl) {
    rig.cyl.position.set(-0.06 * open, 0.03 - 0.025 * open, 0.02)
    rig.cyl.rotation.y = -0.5 * open
    // 裝完子彈轉一圈；之後每開一槍轉一格
    const spin = smooth(GUN.spin[0], GUN.spin[1], age) * Math.PI * 2
    const fired = aim ? aim.shots.filter((s) => now >= s.at).length : 0
    rig.cyl.rotation.z = spin + (fired * Math.PI * 2) / CHAMBERS
  }
  // 子彈從後面滑進彈巢
  GUN.rounds.forEach(([a, b], i) => {
    const m = rig.rounds[i]
    if (!m) return
    const k = smooth(a, b, age)
    m.visible = age >= a && reload
    const ang = (i / CHAMBERS) * Math.PI * 2
    m.position.set(Math.cos(ang) * 0.024, Math.sin(ang) * 0.024, -0.036 - (1 - k) * 0.09)
  })
  // 擊錘：扳起，開火時打下去
  if (rig.hammer) {
    const cock = smooth(GUN.cock[0], GUN.cock[1], age)
    const next = aim?.shots.find((s) => now < s.at + 0.06)
    const down = next && now >= next.at ? 1 : 0
    rig.hammer.rotation.x = -0.9 * cock * (1 - down)
  }
}

const ARM_LEN = 0.6
const DOWN = new THREE.Vector3(0, -1, 0)

/** 從座位看出去，指向另一個座位的方向（身體座標） */
function localDir(fromTheta: number, toTheta: number) {
  const a = polar(fromTheta, SEAT_R, 1.62)
  const b = polar(toTheta, SEAT_R, 1.45)
  const d = b.sub(a)
  d.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(fromTheta + Math.PI))
  return d.normalize()
}

function Figure({
  p,
  n,
  me,
  theta,
  opacity,
  dead,
  acting,
  reduced,
}: {
  p: PublicPlayer
  n: number
  me: number
  theta: number
  opacity: number
  dead: boolean
  acting: boolean
  reduced: boolean
}) {
  const dir = useDirector()
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const gunArm = useRef<THREE.Group>(null)
  const gunInHand = useRef<THREE.Group>(null)
  const gunHolster = useRef<THREE.Group>(null)
  const tint = useRef<THREE.MeshStandardMaterial>(null)
  const seat = p.seat
  const coat = COATS[seat % COATS.length]
  const restDir = useMemo(() => new THREE.Vector3(-0.35, -0.7, 0.62).normalize(), [])
  /** 裝子彈時把槍舉在胸前 */
  const loadDir = useMemo(() => new THREE.Vector3(-0.45, -0.15, 0.88).normalize(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const rig = useMemo<GunRig>(() => ({ cyl: null, hammer: null, rounds: [] }), [])
  useFrame(({ clock }) => {
    if (!body.current || !head.current || !gunArm.current) return
    const now = clock.elapsedTime
    const t = now + seat * 1.7
    // 呼吸與姿勢
    if (!reduced) body.current.scale.y = 1 + Math.sin(t * 1.3) * 0.012
    const lean = dead ? 0.9 : acting ? 0.14 : 0.04
    body.current.rotation.x += (lean - body.current.rotation.x) * 0.06
    // 閃躲：往旁邊一晃
    const dodgeAt = dir.dodge.get(seat)
    const dodge = dodgeAt != null && now - dodgeAt < 0.6 && now >= dodgeAt ? Math.sin(((now - dodgeAt) / 0.6) * Math.PI) * 0.35 : 0
    body.current.rotation.z = dodge
    head.current.rotation.y = reduced ? 0 : Math.sin(t * 0.4) * (acting ? 0.35 : 0.15)
    // 舉槍
    const aim = dir.aims.get(seat)
    let want = restDir
    let aiming = false
    if (aim && !dead) {
      const age = now - aim.t0
      if (age >= 0 && now < aim.until) {
        aiming = true
        // 正在瞄準的目標：下一槍的對象（開完就看最後一槍）
        const shot = aim.shots.find((s) => now < s.at + 0.12) ?? aim.shots[aim.shots.length - 1]
        const d = localDir(theta, seatAngle(shot.target, me, n))
        // 開火後的後座力
        const last = [...aim.shots].reverse().find((s) => now >= s.at)
        const kick = last && now - last.at < 0.18 ? Math.sin(((now - last.at) / 0.18) * Math.PI) * 0.35 : 0
        const turn = smooth(GUN.cock[0] - 0.05, GUN.cock[1], age)
        want = loadDir.clone().lerp(d, turn).add(new THREE.Vector3(0, kick, 0)).normalize()
        head.current.rotation.y = Math.atan2(want.x, want.z) * 0.8
        // 裝子彈時低頭看槍
        head.current.rotation.x = (1 - turn) * 0.35
        animateGun(rig, age, aim, now)
      } else if (now >= aim.until) dir.aims.delete(seat)
    }
    q.setFromUnitVectors(DOWN, want)
    gunArm.current.quaternion.slerp(q, reduced ? 1 : aiming ? 0.25 : 0.1)
    if (gunInHand.current) gunInHand.current.visible = aiming
    if (gunHolster.current) gunHolster.current.visible = !aiming
    // 受傷閃紅
    if (tint.current) {
      const f = dir.flashes.find((x) => x.seat === seat && now - x.t0 < 0.5 && now >= x.t0)
      const k = f ? 1 - (now - f.t0) / 0.5 : 0
      tint.current.emissive.set(f?.kind === 'heal' ? '#3f9a4a' : '#c0201a')
      tint.current.emissiveIntensity = k * 0.9
    }
  })
  const tr = opacity < 1
  const skin = '#d8a27a'
  const hat = HATS[seat % HATS.length]
  const sL = new THREE.Vector3(-0.36, 1.62, 0.02)
  const sR = new THREE.Vector3(0.36, 1.62, 0.02)
  const holding = p.handCount > 0 && !dead
  const eL = holding ? new THREE.Vector3(-0.4, 1.22, 0.3) : new THREE.Vector3(-0.42, 1.18, 0.38)
  const hL = holding ? new THREE.Vector3(-0.1, 1.44, 0.56) : new THREE.Vector3(-0.2, TABLE_Y + 0.08, 0.78)
  return (
    <group>
      {/* 椅子 */}
      <mesh position={[0, 0.72, -0.15]} castShadow>
        <boxGeometry args={[0.85, 0.08, 0.75]} />
        <meshStandardMaterial color="#4a2c16" />
      </mesh>
      <mesh position={[0, 1.35, -0.52]} castShadow>
        <boxGeometry args={[0.85, 1.25, 0.08]} />
        <meshStandardMaterial color="#4a2c16" />
      </mesh>
      {[-0.36, 0.36].map((x) =>
        [0.18, -0.48].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.36, z]}>
            <boxGeometry args={[0.06, 0.72, 0.06]} />
            <meshStandardMaterial color="#3a2210" />
          </mesh>
        )),
      )}
      <group ref={body} position={[0, 0.76, -0.1]}>
        <group position={[0, -0.76, 0.1]}>
          {/* 長大衣 */}
          <mesh position={[0, 1.2, -0.05]} castShadow>
            <cylinderGeometry args={[0.3, 0.44, 0.95, 20]} />
            <meshStandardMaterial ref={tint} color={coat} roughness={0.9} transparent={tr} opacity={opacity} />
          </mesh>
          <mesh position={[0, 1.62, -0.03]} scale={[1.25, 0.5, 0.9]} castShadow>
            <sphereGeometry args={[0.32, 20, 14]} />
            <meshStandardMaterial color={coat} roughness={0.9} transparent={tr} opacity={opacity} />
          </mesh>
          {/* 腰帶與槍套 */}
          <mesh position={[0, 0.98, -0.04]}>
            <cylinderGeometry args={[0.37, 0.39, 0.07, 20]} />
            <meshStandardMaterial color="#2a1a0e" transparent={tr} opacity={opacity} />
          </mesh>
          <group position={[0.38, 0.9, 0.05]}>
            <mesh>
              <boxGeometry args={[0.07, 0.2, 0.11]} />
              <meshStandardMaterial color="#5a3518" />
            </mesh>
            <group ref={gunHolster} position={[0, 0.14, 0.0]} rotation-x={Math.PI}>
              <Revolver scale={0.9} />
            </group>
          </group>
          {/* 領巾 */}
          <mesh position={[0, 1.76, 0.06]} rotation-x={-0.25}>
            <coneGeometry args={[0.2, 0.2, 16, 1, true]} />
            <meshStandardMaterial color={BANDANAS[seat % BANDANAS.length]} side={THREE.DoubleSide} transparent={tr} opacity={opacity} />
          </mesh>
          {/* 左手拿牌 */}
          <Limb from={sL} to={eL} r={0.085} color={coat} opacity={opacity} />
          <Limb from={eL} to={hL} r={0.075} color={coat} opacity={opacity} />
          <mesh position={[hL.x, hL.y + 0.02, hL.z + 0.05]} castShadow>
            <sphereGeometry args={[0.075, 12, 10]} />
            <meshStandardMaterial color={skin} transparent={tr} opacity={opacity} />
          </mesh>
          {holding && <HeldFan n={p.handCount} />}
          {/* 右手：可以拔槍 */}
          <group ref={gunArm} position={sR}>
            <mesh position={[0, -ARM_LEN / 2, 0]} castShadow>
              <capsuleGeometry args={[0.08, ARM_LEN - 0.1, 6, 12]} />
              <meshStandardMaterial color={coat} roughness={0.85} transparent={tr} opacity={opacity} />
            </mesh>
            <mesh position={[0, -ARM_LEN, 0]} castShadow>
              <sphereGeometry args={[0.075, 12, 10]} />
              <meshStandardMaterial color={skin} transparent={tr} opacity={opacity} />
            </mesh>
            <group ref={gunInHand} position={[0, -ARM_LEN - 0.02, 0.02]} visible={false}>
              <Revolver scale={1.5} rig={rig} />
            </group>
          </group>
          {/* 頭與牛仔帽 */}
          <group ref={head} position={[0, 1.98, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[0.19, 24, 18]} />
              <meshStandardMaterial color={skin} roughness={0.7} transparent={tr} opacity={opacity} />
            </mesh>
            {/* 鬍子 */}
            {seat % 2 === 0 && (
              <mesh position={[0, -0.06, 0.16]} scale={[1.4, 0.45, 0.6]}>
                <sphereGeometry args={[0.07, 12, 8]} />
                <meshStandardMaterial color="#3a2414" transparent={tr} opacity={opacity} />
              </mesh>
            )}
            <mesh position={[0, 0.12, 0]} scale={[1, 0.18, 1.12]} castShadow>
              <sphereGeometry args={[0.42, 28, 12]} />
              <meshStandardMaterial color={hat} transparent={tr} opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.24, 0]} castShadow>
              <cylinderGeometry args={[0.15, 0.2, 0.24, 24]} />
              <meshStandardMaterial color={hat} transparent={tr} opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.16, 0]}>
              <cylinderGeometry args={[0.205, 0.205, 0.04, 24]} />
              <meshStandardMaterial color="#c9a227" transparent={tr} opacity={opacity} />
            </mesh>
            {p.role === 'sheriff' && (
              <mesh position={[0, -0.32, 0.27]}>
                <cylinderGeometry args={[0.06, 0.06, 0.02, 5]} />
                <meshStandardMaterial color="#e8c35a" metalness={0.9} roughness={0.25} emissive="#5a4410" />
              </mesh>
            )}
          </group>
        </group>
      </group>
    </group>
  )
}

/** 手上的牌：牌背朝外，張數和實際手牌數一樣 */
function HeldFan({ n }: { n: number }) {
  const back = cardBackTexture()
  const k = Math.min(n, 12)
  const spread = Math.min(0.14 * Math.max(0, k - 1), 1.2)
  return (
    <group position={[-0.12, 1.42, 0.6]} rotation-x={-0.25}>
      {Array.from({ length: k }, (_, i) => {
        const a = k > 1 ? -spread / 2 + (spread * i) / (k - 1) : 0
        return (
          <group key={i} rotation-z={-a} position={[0, 0, -i * 0.004]}>
            <mesh position={[0, 0.17, 0]} castShadow>
              <planeGeometry args={[0.2, 0.29]} />
              <meshStandardMaterial map={back} side={THREE.DoubleSide} roughness={0.8} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** 裝備：放在座位前的桌上，每件都有 3D 道具和一塊大家都看得到的名牌 */
function TableRow({ cards, theta, gold }: { cards: Card[]; theta: number; gold: { uid: number; key: GoldKey }[] }) {
  const r = TABLE_R - 0.78
  const items = [...cards.map((c) => ({ id: `c${c.id}`, card: c as Card | null, gold: null as GoldKey | null })), ...gold.map((g) => ({ id: `g${g.uid}`, card: null, gold: g.key }))]
  const step = Math.min(0.24, 1.5 / Math.max(1, items.length))
  return (
    <group>
      {items.map((it, i) => {
        const a = theta + (i - (items.length - 1) / 2) * step
        const p = polar(a, r, TABLE_Y)
        // 名牌前後交錯，避免擠在一起看不清
        const lift = 0.45 + (i % 2) * 0.27
        return (
          <group key={it.id} position={p} rotation-y={a + Math.PI}>
            {it.card ? (
              <>
                <CardMesh card={it.card} w={0.4} position={[0, 0.012 + i * 0.001, 0.05]} rotation={[-Math.PI / 2, 0, 0]} />
                <GearProp k={it.card.key} />
              </>
            ) : (
              <mesh position={[0, 0.03, 0.05]} castShadow>
                <cylinderGeometry args={[0.13, 0.15, 0.05, 6]} />
                <meshStandardMaterial color="#d4a72c" metalness={0.8} roughness={0.3} />
              </mesh>
            )}
            <GearTag card={it.card} gold={it.gold} y={lift} />
          </group>
        )
      })}
    </group>
  )
}

function GearTag({ card, gold, y }: { card: Card | null; gold: GoldKey | null; y: number }) {
  let text = ''
  let bg = '#efe3c4'
  if (card) {
    const d = CARD_DEFS[card.key]
    const n = cardName(card.key, getLang())
    text = d.range ? tr(`${n}．射程${d.range}`, `${n} · range ${d.range}`, `${n} · tầm ${d.range}`) : n
    bg = card.key === 'jail' ? '#b9b9b9' : card.key === 'dynamite' ? '#f08a6a' : d.colour === 'green' ? '#a9dc8f' : d.range ? '#f2c75c' : '#a9c9f2'
  } else if (gold) {
    text = goldName(gold, getLang())
    bg = '#f0d77a'
  }
  const tex = tagTexture(text, bg)
  return (
    <sprite position={[0, y, 0.05]} scale={[1.04, 0.26, 1]} renderOrder={5}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  )
}

const METAL = { color: '#6b7078', metalness: 0.75, roughness: 0.32 } as const
const WOOD = { color: '#6b3e1e', roughness: 0.6 } as const
const BRASS = { color: '#c9a03a', metalness: 0.85, roughness: 0.25 } as const

/** 每種裝備的小道具（平放在牌上） */
function GearProp({ k }: { k: string }) {
  const range = CARD_DEFS[k as keyof typeof CARD_DEFS]?.range
  const y = 0.05
  if (k === 'carabine' || k === 'winchester' || k === 'shotgun') {
    // 長槍
    const len = k === 'winchester' ? 0.62 : k === 'shotgun' ? 0.48 : 0.56
    return (
      <group position={[0, y, 0.05]} rotation-y={0.25}>
        <mesh position={[len * 0.18, 0, 0]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.018, 0.018, len * 0.75, 10]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        {k === 'shotgun' && (
          <mesh position={[len * 0.18, 0, 0.034]} rotation-z={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.018, 0.018, len * 0.75, 10]} />
            <meshStandardMaterial {...METAL} />
          </mesh>
        )}
        <mesh position={[-len * 0.25, -0.005, 0.015]} castShadow>
          <boxGeometry args={[0.1, 0.05, 0.06]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <mesh position={[-len * 0.45, -0.012, 0.015]} rotation-y={0.08} castShadow>
          <boxGeometry args={[len * 0.32, 0.045, 0.08]} />
          <meshStandardMaterial {...WOOD} />
        </mesh>
      </group>
    )
  }
  if (range) {
    // 手槍：越遠的射程槍管越長
    const barrel = 0.12 + range * 0.035
    return (
      <group position={[0, y, 0.05]} rotation-y={0.35}>
        <mesh position={[barrel / 2 + 0.04, 0.01, 0]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.02, 0.02, barrel, 10]} />
          <meshStandardMaterial {...METAL} />
        </mesh>
        <mesh position={[0.02, 0.01, 0]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.045, 0.045, 0.07, 12]} />
          <meshStandardMaterial {...METAL} color="#7a7f88" />
        </mesh>
        {k === 'volcanic' && (
          <mesh position={[barrel / 2 + 0.04, -0.025, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.014, 0.014, barrel, 8]} />
            <meshStandardMaterial {...BRASS} />
          </mesh>
        )}
        <mesh position={[-0.06, -0.005, 0.03]} rotation-y={-0.5} castShadow>
          <boxGeometry args={[0.1, 0.035, 0.05]} />
          <meshStandardMaterial {...WOOD} />
        </mesh>
      </group>
    )
  }
  switch (k) {
    case 'scope':
    case 'binocular':
      // 望遠鏡：一節一節的黃銅筒
      return (
        <group position={[0, y + 0.01, 0.05]} rotation-y={0.4}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[-0.1 + i * 0.1, 0, 0]} rotation-z={Math.PI / 2} castShadow>
              <cylinderGeometry args={[0.04 - i * 0.008, 0.04 - i * 0.008, 0.11, 14]} />
              <meshStandardMaterial {...BRASS} />
            </mesh>
          ))}
          <mesh position={[-0.16, 0, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.03, 0.03, 0.01, 14]} />
            <meshStandardMaterial color="#9fd3ff" metalness={0.2} roughness={0.05} />
          </mesh>
        </group>
      )
    case 'barrel':
      return (
        <group position={[0, 0.14, 0.05]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.12, 0.12, 0.26, 16]} />
            <meshStandardMaterial color="#8a5a2c" roughness={0.8} />
          </mesh>
          {[-0.08, 0.08].map((h) => (
            <mesh key={h} position={[0, h, 0]}>
              <cylinderGeometry args={[0.128, 0.128, 0.025, 16]} />
              <meshStandardMaterial color="#3a3a3a" metalness={0.6} roughness={0.4} />
            </mesh>
          ))}
        </group>
      )
    case 'mustang':
      // 馬蹄鐵
      return (
        <mesh position={[0, 0.025, 0.05]} rotation-x={-Math.PI / 2} castShadow>
          <torusGeometry args={[0.1, 0.025, 8, 20, Math.PI * 1.3]} />
          <meshStandardMaterial color="#8b8f96" metalness={0.8} roughness={0.35} />
        </mesh>
      )
    case 'hideout':
      return (
        <mesh position={[0, 0.11, 0.05]} castShadow>
          <coneGeometry args={[0.15, 0.2, 4]} />
          <meshStandardMaterial color="#b89b6a" roughness={0.9} />
        </mesh>
      )
    case 'dynamite':
      return (
        <group position={[0, 0.04, 0.05]} rotation-y={0.3}>
          {[-0.04, 0, 0.04].map((z) => (
            <mesh key={z} position={[0, 0, z]} rotation-z={Math.PI / 2} castShadow>
              <cylinderGeometry args={[0.022, 0.022, 0.24, 10]} />
              <meshStandardMaterial color="#c0281f" roughness={0.7} />
            </mesh>
          ))}
          <mesh position={[0.15, 0.02, 0]} rotation-z={-0.6}>
            <cylinderGeometry args={[0.004, 0.004, 0.1, 5]} />
            <meshStandardMaterial color="#e8d7a0" emissive="#ffb040" emissiveIntensity={0.8} />
          </mesh>
        </group>
      )
    case 'jail':
      // 小鐵欄
      return (
        <group position={[0, 0.06, 0.05]}>
          {[-0.09, -0.03, 0.03, 0.09].map((x) => (
            <mesh key={x} position={[x, 0, 0]} castShadow>
              <cylinderGeometry args={[0.01, 0.01, 0.12, 6]} />
              <meshStandardMaterial color="#3d3f44" metalness={0.8} roughness={0.4} />
            </mesh>
          ))}
          <mesh position={[0, 0.06, 0]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.012, 0.012, 0.22, 6]} />
            <meshStandardMaterial color="#3d3f44" metalness={0.8} roughness={0.4} />
          </mesh>
        </group>
      )
    default:
      return null
  }
}

/** 被關進監獄：鐵欄從天而降罩住這個人 */
function JailCage({ theta }: { theta: number }) {
  const g = useRef<THREE.Group>(null)
  const born = useRef<number | null>(null)
  const pos = polar(theta, SEAT_R, 0)
  useFrame(({ clock }) => {
    if (!g.current) return
    if (born.current == null) born.current = clock.elapsedTime
    const k = Math.min(1, (clock.elapsedTime - born.current) / 0.55)
    // 落下後稍微彈一下
    const drop = k < 1 ? (1 - k * k) * 3 : 0
    g.current.position.y = drop
  })
  const bars = 14
  const R = 0.78
  const tex = tagTexture(tr('監獄', 'JAIL', 'JAIL'), '#b9b9b9')
  return (
    <group position={pos}>
      <group ref={g}>
        {Array.from({ length: bars }, (_, i) => {
          const a = (i / bars) * Math.PI * 2
          return (
            <mesh key={i} position={[Math.sin(a) * R, 1.35, Math.cos(a) * R]} castShadow>
              <cylinderGeometry args={[0.022, 0.022, 2.7, 8]} />
              <meshStandardMaterial color="#2e3034" metalness={0.85} roughness={0.35} />
            </mesh>
          )
        })}
        {[0.05, 1.35, 2.7].map((h) => (
          <mesh key={h} position={[0, h, 0]} rotation-x={Math.PI / 2}>
            <torusGeometry args={[R, 0.035, 8, 40]} />
            <meshStandardMaterial color="#2e3034" metalness={0.85} roughness={0.35} />
          </mesh>
        ))}
        <sprite position={[0, 3.05, 0]} scale={[0.9, 0.225, 1]}>
          <spriteMaterial map={tex} transparent depthWrite={false} />
        </sprite>
      </group>
    </group>
  )
}

function Seat({
  p,
  v,
  theta,
  acting,
  aiControlled,
  reduced,
  mode,
}: {
  p: PublicPlayer
  v: GameView
  theta: number
  acting: boolean
  aiControlled: boolean
  reduced: boolean
  mode: ViewMode
}) {
  const plateHost = useContext(PlateHost)
  const me = p.seat === v.me
  const pos = polar(theta, SEAT_R, 0)
  const dead = !p.alive
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const m = ring.current.material as THREE.MeshStandardMaterial
    m.emissiveIntensity = reduced ? 1.2 : 0.9 + Math.sin(clock.elapsedTime * 4) * 0.5
  })
  const ch = p.character ? charName(p.character, getLang()) : null
  const jailed = p.alive && p.table.some((c) => c.key === 'jail')
  const winner = !!v.result?.winners.includes(p.seat)
  const marks: { text: string; cls: string }[] = []
  if (dead) marks.push({ text: tr('死亡', 'Dead', 'Đã chết'), cls: 'm-dead' })
  if (p.ghost) marks.push({ text: tr('幽靈', 'Ghost', 'Hồn ma'), cls: 'm-ai' })
  if (v.active === p.seat && p.alive) marks.push({ text: tr('回合中', 'Their turn', 'Đang đến lượt'), cls: 'm-turn' })
  if (p.table.some((c) => c.key === 'jail')) marks.push({ text: tr('監獄', 'Jail', 'Jail'), cls: 'm-lock' })
  if (p.table.some((c) => c.key === 'dynamite')) marks.push({ text: tr('炸藥', 'Dynamite', 'Dynamite'), cls: 'm-divert' })
  if (acting) marks.push({ text: tr('行動中', 'Acting', 'Đang hành động'), cls: 'm-wait' })
  if (aiControlled && p.alive) marks.push({ text: tr('斷線．AI 代打', 'Offline · computer playing', 'Mất kết nối · máy chơi thay'), cls: 'm-ai' })
  return (
    <group>
      <group position={pos} rotation-y={theta + Math.PI}>
        {!(me && mode === 'first') && <Figure p={p} n={v.players.length} me={v.me} theta={theta} opacity={dead ? 0.5 : p.ghost ? 0.4 : 1} dead={dead} acting={acting} reduced={reduced} />}
      </group>
      {(acting || winner) && (
        <mesh ref={ring} position={polar(theta, TABLE_R - 0.18, TABLE_Y + 0.01)} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.32, 0.42, 40]} />
          <meshStandardMaterial color={winner ? '#e9cf7f' : '#d08a3a'} emissive={winner ? '#e9cf7f' : '#d08a3a'} transparent opacity={0.85} />
        </mesh>
      )}
      <TableRow cards={p.table} theta={theta} gold={p.gold} />
      {jailed && !(me && mode === 'first') && <JailCage theta={theta} />}
      {!(me && mode === 'first') && (
        <Html
          position={me ? polar(theta, TABLE_R + 0.3, TABLE_Y + 0.1) : polar(theta, SEAT_R, 2.95)}
          center
          calculatePosition={mode === 'first' ? clampedPosition : undefined}
          portal={(plateHost ?? undefined) as React.RefObject<HTMLElement> | undefined}
          onOcclude={keepVisible}
          className={`plate ${me ? 'is-me' : ''} ${acting ? 'is-acting' : ''} ${dead ? 'is-out' : ''} ${winner ? 'is-winner' : ''}`}
          zIndexRange={[20, 0]}
        >
          <PlateBody p={p} v={v} me={me} ch={ch} marks={marks} />
        </Html>
      )}
    </group>
  )
}

export function PlateBody({ p, v, me, ch, marks }: { p: PublicPlayer; v: GameView; me: boolean; ch: string | null; marks: { text: string; cls: string }[] }) {
  return (
    <>
      <div className="plate-head">
        <b>{p.name}</b>
        {me && <span className="seat-you">{tr('你', 'You', 'Bạn')}</span>}
        {p.isAI && <span className="seat-ai">{tr('電腦', 'CPU', 'Máy')}</span>}
        <span className="plate-hand">{tr(`手牌 ${p.handCount}`, `Cards ${p.handCount}`, `Bài ${p.handCount}`)}</span>
      </div>
      <div className="plate-char" onClick={() => window.dispatchEvent(new CustomEvent('bang-inspect', { detail: p.seat }))} title={tr('點一下看角色能力與裝備', 'Tap to see abilities and equipment', 'Chạm để xem năng lực và trang bị')}>
        {ch ?? tr('挑選角色中', 'Choosing a character', 'Đang chọn nhân vật')}
        {ch && <span className="plate-info">{tr('能力', 'Info', 'Chi tiết')}</span>}
        {p.role && <span className={`role r-${p.role}`}>{roleName(p.role, getLang())}</span>}
      </div>
      <div className="plate-hp" aria-label={tr(`生命 ${p.hp} / ${p.maxHp}`, `Life ${p.hp} / ${p.maxHp}`, `Máu ${p.hp} / ${p.maxHp}`)}>
        {Array.from({ length: p.maxHp }, (_, i) => (
          <span key={i} className={i < p.hp ? 'bullet on' : 'bullet'} />
        ))}
        {!me && p.alive && v.players[v.me].alive && p.dist > 0 && <span className={`plate-dist ${p.dist <= v.myRange ? 'in-range' : ''}`}>{tr(`距離 ${p.dist}`, `Dist ${p.dist}`, `Cách ${p.dist}`)}</span>}
      </div>
      {p.table.length > 0 && (
        <div className="plate-gear">
          {p.table.map((c) => (
            <span key={c.id} className={`gear g-${CARD_DEFS[c.key].colour} ${v.fresh.includes(c.id) ? 'is-fresh' : ''}`} title={cardDesc(c.key, getLang())}>
              {cardName(c.key, getLang())}
            </span>
          ))}
        </div>
      )}
      {(v.goldOn || p.gold.length > 0) && (
        <div className="plate-gear">
          <span className="nugget">{p.nuggets}</span>
          {p.gold.map((x) => (
            <span key={x.uid} className="gear g-gold" title={goldDesc(x.key, getLang())}>
              {goldName(x.key, getLang())}
            </span>
          ))}
        </div>
      )}
      {p.openHand && (
        <div className="plate-open" title={tr('薩卡加維亞：手牌公開', 'Sacagaway: hand revealed', 'Sacagaway: bài trên tay để ngửa')}>
          {p.openHand.map((c) => cardName(c.key, getLang())).join(tr('、', ', ', ', ')) || tr('沒有手牌', 'No cards', 'Không có bài')}
        </div>
      )}
      {marks.length > 0 && (
        <div className="plate-marks">
          {marks.map((m) => (
            <span key={m.text} className={`mark ${m.cls}`}>
              {m.text}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

// ───────── 第一人稱的手與槍 ─────────

function MyHand({ v, selected }: { v: GameView; selected: number | null }) {
  const dir = useDirector()
  const cards = v.hand.slice(0, 14)
  const n = cards.length
  const spread = Math.min(0.3 * Math.max(0, n - 1), 1.9)
  const coat = COATS[v.me % COATS.length]
  const gun = useRef<THREE.Group>(null)
  const rig = useMemo<GunRig>(() => ({ cyl: null, hammer: null, rounds: [] }), [])
  const sleeve = useRef<THREE.Mesh>(null)
  const lamp = useRef<THREE.PointLight>(null)
  const meAlive = v.players[v.me]?.alive
  useFrame(({ clock, camera }) => {
    const g = gun.current
    if (!g) return
    const aim = dir.aims.get(v.me)
    const now = clock.elapsedTime
    const age = aim ? now - aim.t0 : Infinity
    const on = !!aim && age >= 0 && now < aim.until
    g.visible = on
    if (!on || !aim) {
      if (aim && now >= aim.until) dir.aims.delete(v.me)
      return
    }
    // 裝子彈的位置：鏡頭正前方偏下，側面朝向你，看得到轉輪
    const fwd = new THREE.Vector3()
    camera.getWorldDirection(fwd)
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize()
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
    const loadPos = camera.position.clone().addScaledVector(fwd, 0.2).addScaledVector(up, -0.12).addScaledVector(right, 0.26)
    // 槍口朝左前方，轉輪後面（彈巢）朝向你，看得到子彈一發一發塞進去
    const loadDir = fwd.clone().multiplyScalar(0.75).addScaledVector(right, -0.55).addScaledVector(up, -0.12).normalize()
    // 瞄準的位置與方向
    const shot = aim.shots.find((s) => now < s.at + 0.12) ?? aim.shots[aim.shots.length - 1]
    const target = polar(seatAngle(shot.target, v.me, v.players.length), SEAT_R, 1.5)
    const aimPos = new THREE.Vector3(0.28, 1.95, SEAT_R - 0.35)
    const aimDir = target.clone().sub(aimPos).normalize()
    const last = [...aim.shots].reverse().find((s) => now >= s.at)
    if (last && now - last.at < 0.18) aimDir.y += Math.sin(((now - last.at) / 0.18) * Math.PI) * 0.3
    // 從下方拔出 → 裝子彈 → 轉去瞄準
    const lift = smooth(0, GUN.draw, age)
    const turn = smooth(GUN.cock[0] - 0.05, GUN.cock[1], age)
    const pos = loadPos.clone().addScaledVector(up, -(1 - lift) * 0.35).lerp(aimPos, turn)
    g.position.copy(pos)
    g.quaternion.setFromUnitVectors(DOWN, loadDir.clone().lerp(aimDir, turn).normalize())
    if (sleeve.current) sleeve.current.visible = turn > 0.6
    if (lamp.current) lamp.current.intensity = 2.2 * (1 - turn) * lift
    animateGun(rig, age, aim, now)
  })
  if (!meAlive) return null
  return (
    <group>
      <group position={[0, 1.78, SEAT_R - 0.42]} rotation-x={-0.6}>
        {cards.map((c, i) => {
          const a = n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0
          const up = c.id === selected ? 0.05 : 0
          return (
            <group key={c.id} rotation-z={-a} position={[0, 0, i * 0.004]}>
              <mesh position={[0, 0.15 + up, 0]}>
                <planeGeometry args={[0.13, 0.185]} />
                <meshStandardMaterial map={cardTexture(c, getLang())} side={THREE.DoubleSide} roughness={0.8} />
              </mesh>
            </group>
          )
        })}
        {[-1, 1].map((sx) => (
          <group key={sx}>
            <mesh position={[sx * 0.075, 0.0, 0.04]}>
              <sphereGeometry args={[0.042, 14, 12]} />
              <meshStandardMaterial color="#d8a27a" />
            </mesh>
            <mesh position={[sx * 0.14, -0.08, 0.22]} rotation={[1.15, 0, sx * 0.4]}>
              <capsuleGeometry args={[0.045, 0.3, 6, 12]} />
              <meshStandardMaterial color={coat} roughness={0.9} />
            </mesh>
          </group>
        ))}
      </group>
      {/* 開槍時舉起的右手 */}
      <group ref={gun} visible={false}>
        <pointLight ref={lamp} position={[0.12, -0.2, 0.15]} intensity={0} distance={0.8} decay={1.5} color="#ffe2b0" />
        <mesh ref={sleeve} position={[0, -0.12, 0]}>
          <capsuleGeometry args={[0.05, 0.22, 6, 12]} />
          <meshStandardMaterial color={coat} roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.26, 0]}>
          <sphereGeometry args={[0.05, 12, 10]} />
          <meshStandardMaterial color="#d8a27a" />
        </mesh>
        <group position={[0, -0.28, 0.01]}>
          <Revolver scale={0.9} rig={rig} />
        </group>
      </group>
    </group>
  )
}

// ───────── 槍火、彈道、浮字 ─────────

function muzzleOf(v: GameView, seat: number, target: number, first: boolean) {
  const n = v.players.length
  const th = seatAngle(seat, v.me, n)
  const tt = seatAngle(target, v.me, n)
  if (seat === v.me && first) {
    const from = new THREE.Vector3(0.28, 1.95, SEAT_R - 0.35)
    const d = polar(tt, SEAT_R, 1.5).sub(from).normalize()
    return from.add(d.multiplyScalar(0.36))
  }
  const shoulder = polar(th, SEAT_R, 0).add(new THREE.Vector3(0.36, 1.62, 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), th + Math.PI))
  const d = polar(tt, SEAT_R, 1.45).sub(polar(th, SEAT_R, 1.62)).normalize()
  return shoulder.add(d.multiplyScalar(ARM_LEN + 0.2))
}

function Shots({ v, first }: { v: GameView; first: boolean }) {
  const dir = useDirector()
  const group = useRef<THREE.Group>(null)
  const light = useRef<THREE.PointLight>(null)
  const pool = useRef<THREE.Mesh[]>([])
  const flashPool = useRef<THREE.Mesh[]>([])
  const [, force] = useState(0)
  useEffect(() => {
    force((x) => x + 1)
  }, [dir.version])
  useFrame(({ clock, camera }) => {
    const now = clock.elapsedTime
    dir.shots = dir.shots.filter((s) => now - s.t0 < 0.6)
    let lit = 0
    dir.shots.forEach((s, i) => {
      const age = now - s.t0
      const tracer = pool.current[i]
      const flash = flashPool.current[i]
      if (!tracer || !flash) return
      const on = age >= 0 && age < 0.25
      tracer.visible = on
      flash.visible = age >= 0 && age < 0.12
      if (age < 0) return
      const from = muzzleOf(v, s.from, s.to, first)
      const to = s.to === v.me && first ? camera.position.clone().add(new THREE.Vector3(0.2, -0.3, -0.3)) : polar(seatAngle(s.to, v.me, v.players.length), SEAT_R, 1.5)
      const mid = from.clone().add(to).multiplyScalar(0.5)
      tracer.position.copy(mid)
      tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
      tracer.scale.set(1, from.distanceTo(to), 1)
      ;(tracer.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - age * 3.6)
      flash.position.copy(from)
      flash.scale.setScalar(1 + age * 8)
      if (age < 0.12 && light.current) {
        light.current.position.copy(from)
        lit = 1
      }
    })
    if (light.current) light.current.intensity = lit ? 40 : 0
    // 爆炸與受傷的閃光
    const ex = dir.flashes.find((f) => f.kind === 'explode' && now - f.t0 < 0.8 && now >= f.t0)
    if (ex && light.current) {
      light.current.position.copy(polar(seatAngle(ex.seat, v.me, v.players.length), SEAT_R - 0.6, 1.6))
      light.current.intensity = 120 * (1 - (now - ex.t0) / 0.8)
      light.current.color.set('#ff7a2a')
    } else if (light.current) light.current.color.set('#ffd27a')
    dir.flashes = dir.flashes.filter((f) => now - f.t0 < 1.5)
  })
  const count = Math.max(8, dir.shots.length)
  return (
    <group ref={group}>
      <pointLight ref={light} intensity={0} distance={8} decay={1.5} color="#ffd27a" />
      {Array.from({ length: count }, (_, i) => (
        <mesh key={`t${i}`} ref={(m) => void (m && (pool.current[i] = m))} visible={false}>
          <cylinderGeometry args={[0.012, 0.012, 1, 6]} />
          <meshBasicMaterial color="#fff2b0" transparent opacity={0.9} />
        </mesh>
      ))}
      {Array.from({ length: count }, (_, i) => (
        <mesh key={`f${i}`} ref={(m) => void (m && (flashPool.current[i] = m))} visible={false}>
          <sphereGeometry args={[0.07, 12, 10]} />
          <meshBasicMaterial color="#ffd060" transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/** 浮字：「砰！」「射偏了！」「-1」 */
function Pops({ v }: { v: GameView }) {
  const dir = useDirector()
  const [, force] = useState(0)
  useEffect(() => {
    force((x) => x + 1)
  }, [dir.version])
  return (
    <group>
      {dir.pops.map((p) => (
        <PopSprite key={p.id} pop={p} v={v} onDone={() => (dir.pops = dir.pops.filter((x) => x.id !== p.id))} />
      ))}
    </group>
  )
}

function PopSprite({ pop, v, onDone }: { pop: Pop; v: GameView; onDone: () => void }) {
  const s = useRef<THREE.Sprite>(null)
  const done = useRef(false)
  const theta = seatAngle(pop.seat, v.me, v.players.length)
  const base = pop.seat === v.me ? polar(0, SEAT_R - 1.3, 2.1) : polar(theta, SEAT_R, 2.55)
  const tex = wordTexture(pop.text, pop.colour)
  useFrame(({ clock }) => {
    const sp = s.current
    if (!sp) return
    const age = clock.elapsedTime - pop.t0
    if (age < 0) {
      sp.visible = false
      return
    }
    sp.visible = true
    const life = 1.4
    if (age > life) {
      sp.visible = false
      if (!done.current) {
        done.current = true
        onDone()
      }
      return
    }
    sp.position.set(base.x, base.y + age * 0.45, base.z)
    const pop0 = age < 0.15 ? 0.6 + (age / 0.15) * 0.5 : 1.1 - Math.min(0.1, (age - 0.15) * 0.3)
    sp.scale.set(1.3 * pop0, 0.41 * pop0, 1)
    ;(sp.material as THREE.SpriteMaterial).opacity = age > life - 0.4 ? (life - age) / 0.4 : 1
  })
  return (
    <sprite ref={s} visible={false}>
      <spriteMaterial map={tex} transparent depthTest={false} />
    </sprite>
  )
}
