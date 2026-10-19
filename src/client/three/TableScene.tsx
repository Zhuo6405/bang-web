import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeElements } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { CARD_DEFS, CHAR_BY_ID, EVENT_BY_ID, ROLE_NAME } from '../../engine/data'
import type { Card, Fx } from '../../engine/types'
import type { GameView, PublicPlayer } from '../../engine/view'
import { cardBackTexture, cardTexture, clearTextures, eventTexture, wordTexture } from './textures'

// 3D 酒館牌桌：圍坐的牛仔、桌上的裝備、拔槍射擊

const TABLE_R = 3.4
const SEAT_R = 4.35
const TABLE_Y = 0.92
const COATS = ['#6b4a2e', '#3f4a5a', '#7a3b2a', '#4d5233', '#5b4a6b', '#2e4a48', '#8a6a3a', '#3b3f45']
const BANDANAS = ['#a3262a', '#1f4e8a', '#c9a227', '#2f6b3a', '#7b2a6b', '#d0662a', '#e8e0d0', '#222']
const HATS = ['#3a2516', '#1e1a18', '#5a3d22', '#2a2a2a', '#6b4a2e', '#1f1a14', '#4a3018', '#2b2116']

const AIM_TIME = 1.5 // 舉槍持續秒數
const FIRE_AT = 0.45 // 舉槍後多久開火

function seatAngle(seat: number, me: number, n: number) {
  return (((seat - me + n) % n) / n) * Math.PI * 2
}
const polar = (theta: number, r: number, y: number) => new THREE.Vector3(r * Math.sin(theta), y, r * Math.cos(theta))

export type ViewMode = 'first' | 'overview'

// ───────── 特效排程：把引擎的 fx 轉成動畫事件 ─────────

interface Aim {
  target: number
  t0: number
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
function apply(d: Director, f: Fx, t: number) {
  const pop = (seat: number, text: string, colour: string, dt = 0) => d.pops.push({ id: uid++, seat, text, colour, t0: t + dt })
  switch (f.kind) {
    case 'shoot':
      if (f.from == null || f.to == null) return
      d.aims.set(f.from, { target: f.to, t0: t })
      d.shots.push({ id: uid++, from: f.from, to: f.to, t0: t + FIRE_AT })
      pop(f.from, '砰！', '#ffcf5a', FIRE_AT)
      return
    case 'miss':
      if (f.to == null) return
      pop(f.to, '射偏了！', '#cfe8ff')
      d.dodge.set(f.to, t)
      return
    case 'hit':
      if (f.to == null) return
      pop(f.to, `-${f.amount ?? 1}`, '#ff5a4a')
      d.flashes.push({ id: uid++, seat: f.to, kind: 'hit', t0: t })
      return
    case 'heal':
      if (f.to == null) return
      pop(f.to, `+${f.amount ?? 1}`, '#7fe08a')
      d.flashes.push({ id: uid++, seat: f.to, kind: 'heal', t0: t })
      return
    case 'explode':
      if (f.to == null) return
      pop(f.to, '轟！', '#ff8a2a')
      d.flashes.push({ id: uid++, seat: f.to, kind: 'explode', t0: t })
      return
    case 'death':
      if (f.to != null) pop(f.to, '倒下', '#d8d0c0')
      return
    case 'check':
      if (f.to != null && f.card) pop(f.to, f.ok ? '判定成功' : '判定失敗', f.ok ? '#9fe0a0' : '#e0a09f')
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

export function TableScene(props: SceneProps) {
  const [fontsReady, setFontsReady] = useState(0)
  useEffect(() => {
    void document.fonts?.ready.then(() => {
      clearTextures()
      setFontsReady((x) => x + 1)
    })
  }, [])
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 6.4, 8.2], fov: 44 }} gl={{ antialias: true }} key={fontsReady}>
      <Inner {...props} />
    </Canvas>
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
  const tex = card ? cardTexture(card) : cardBackTexture()
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
      {v.event && EVENT_BY_ID[v.event] && (
        <mesh position={[0, TABLE_Y + 0.025, -1.25]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[0.9, 1.25]} />
          <meshStandardMaterial map={eventTexture(EVENT_BY_ID[v.event].name, EVENT_BY_ID[v.event].text)} roughness={0.85} />
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

/** 左輪手槍：槍管朝 -y（跟手臂同方向） */
function Revolver({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale} rotation-x={Math.PI / 2}>
      {/* 槍管 */}
      <mesh position={[0, 0.03, 0.15]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.24, 10]} />
        <meshStandardMaterial color="#2b2b2e" metalness={0.85} roughness={0.3} />
      </mesh>
      {/* 轉輪 */}
      <mesh position={[0, 0.03, 0.02]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.07, 12]} />
        <meshStandardMaterial color="#3a3a3e" metalness={0.85} roughness={0.35} />
      </mesh>
      {/* 槍身 */}
      <mesh position={[0, 0.035, -0.04]} castShadow>
        <boxGeometry args={[0.035, 0.06, 0.08]} />
        <meshStandardMaterial color="#2b2b2e" metalness={0.8} roughness={0.35} />
      </mesh>
      {/* 木握把 */}
      <mesh position={[0, -0.03, -0.075]} rotation-x={-0.45} castShadow>
        <boxGeometry args={[0.032, 0.12, 0.045]} />
        <meshStandardMaterial color="#6b3e1e" roughness={0.6} />
      </mesh>
    </group>
  )
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
  const q = useMemo(() => new THREE.Quaternion(), [])
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
      if (age >= 0 && age < AIM_TIME) {
        aiming = true
        const d = localDir(theta, seatAngle(aim.target, me, n))
        // 開火後的後座力
        const kick = age > FIRE_AT && age < FIRE_AT + 0.18 ? Math.sin(((age - FIRE_AT) / 0.18) * Math.PI) * 0.35 : 0
        want = d.clone().add(new THREE.Vector3(0, kick, 0)).normalize()
        head.current.rotation.y = Math.atan2(d.x, d.z) * 0.8
      } else if (age >= AIM_TIME) dir.aims.delete(seat)
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
              <Revolver scale={1.4} />
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

/** 裝備：放在座位前的桌上 */
function TableRow({ cards, theta }: { cards: Card[]; theta: number }) {
  const r = TABLE_R - 0.8
  const step = 0.2
  return (
    <group>
      {cards.map((c, i) => {
        const off = (i - (cards.length - 1) / 2) * step
        const p = polar(theta + off, r, TABLE_Y + 0.012 + i * 0.001)
        return <CardMesh key={c.id} card={c} position={p} rotation={[-Math.PI / 2, 0, theta + Math.PI]} />
      })}
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
  const me = p.seat === v.me
  const pos = polar(theta, SEAT_R, 0)
  const dead = !p.alive
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const m = ring.current.material as THREE.MeshStandardMaterial
    m.emissiveIntensity = reduced ? 1.2 : 0.9 + Math.sin(clock.elapsedTime * 4) * 0.5
  })
  const ch = p.character ? CHAR_BY_ID[p.character] : null
  const winner = !!v.result?.winners.includes(p.seat)
  const marks: { text: string; cls: string }[] = []
  if (dead) marks.push({ text: '死亡', cls: 'm-dead' })
  if (p.ghost) marks.push({ text: '幽靈', cls: 'm-ai' })
  if (v.active === p.seat && p.alive) marks.push({ text: '回合中', cls: 'm-turn' })
  if (p.table.some((c) => c.key === 'jail')) marks.push({ text: '監獄', cls: 'm-lock' })
  if (p.table.some((c) => c.key === 'dynamite')) marks.push({ text: '炸藥', cls: 'm-divert' })
  if (acting) marks.push({ text: '行動中', cls: 'm-wait' })
  if (aiControlled && p.alive) marks.push({ text: '斷線．AI 代打', cls: 'm-ai' })
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
      <TableRow cards={p.table} theta={theta} />
      {!(me && mode === 'first') && (
        <Html
          position={me ? polar(theta, TABLE_R + 0.3, TABLE_Y + 0.1) : polar(theta, SEAT_R, 2.95)}
          center
          className={`plate ${me ? 'is-me' : ''} ${acting ? 'is-acting' : ''} ${dead ? 'is-out' : ''} ${winner ? 'is-winner' : ''}`}
          zIndexRange={[20, 0]}
        >
          <PlateBody p={p} v={v} me={me} ch={ch?.name ?? null} marks={marks} />
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
        {me && <span className="seat-you">你</span>}
        {p.isAI && <span className="seat-ai">電腦</span>}
        <span className="plate-hand">手牌 {p.handCount}</span>
      </div>
      <div className="plate-char">
        {ch ?? '挑選角色中'}
        {p.role && <span className={`role r-${p.role}`}>{ROLE_NAME[p.role]}</span>}
      </div>
      <div className="plate-hp" aria-label={`生命 ${p.hp} / ${p.maxHp}`}>
        {Array.from({ length: p.maxHp }, (_, i) => (
          <span key={i} className={i < p.hp ? 'bullet on' : 'bullet'} />
        ))}
        {!me && p.alive && v.players[v.me].alive && p.dist > 0 && <span className={`plate-dist ${p.dist <= v.myRange ? 'in-range' : ''}`}>距離 {p.dist}</span>}
      </div>
      {p.table.length > 0 && (
        <div className="plate-gear">
          {p.table.map((c) => (
            <span key={c.id} className={`gear g-${CARD_DEFS[c.key].colour} ${v.fresh.includes(c.id) ? 'is-fresh' : ''}`} title={CARD_DEFS[c.key].desc}>
              {CARD_DEFS[c.key].name}
            </span>
          ))}
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
  const meAlive = v.players[v.me]?.alive
  useFrame(({ clock }) => {
    const g = gun.current
    if (!g) return
    const aim = dir.aims.get(v.me)
    const now = clock.elapsedTime
    const age = aim ? now - aim.t0 : Infinity
    const on = age >= 0 && age < AIM_TIME
    g.visible = on
    if (!on || !aim) return
    // 舉起來指向目標
    const theta = seatAngle(aim.target, v.me, v.players.length)
    const target = polar(theta, SEAT_R, 1.5)
    const from = new THREE.Vector3(0.28, 1.95, SEAT_R - 0.35)
    const lift = Math.min(1, age / 0.3)
    g.position.set(from.x, from.y - (1 - lift) * 0.4, from.z)
    const d = target.clone().sub(from).normalize()
    const kick = age > FIRE_AT && age < FIRE_AT + 0.18 ? Math.sin(((age - FIRE_AT) / 0.18) * Math.PI) * 0.3 : 0
    d.y += kick
    g.quaternion.setFromUnitVectors(DOWN, d.normalize())
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
                <meshStandardMaterial map={cardTexture(c)} side={THREE.DoubleSide} roughness={0.8} />
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
        <mesh position={[0, -0.12, 0]}>
          <capsuleGeometry args={[0.05, 0.22, 6, 12]} />
          <meshStandardMaterial color={coat} roughness={0.9} />
        </mesh>
        <mesh position={[0, -0.26, 0]}>
          <sphereGeometry args={[0.05, 12, 10]} />
          <meshStandardMaterial color="#d8a27a" />
        </mesh>
        <group position={[0, -0.28, 0.01]}>
          <Revolver scale={0.8} />
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
