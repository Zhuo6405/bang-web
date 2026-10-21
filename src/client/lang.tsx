import { useSyncExternalStore } from 'react'
import { pick, type Lang } from '../engine/i18n'

/** 介面語言：存在這台裝置上，切換時所有畫面一起更新 */
const KEY = 'bang-lang'
const subs = new Set<() => void>()

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'en' || v === 'zh' || v === 'vi') return v
  } catch {
    /* 無痕模式等情況讀不到就用預設 */
  }
  return 'zh'
}

let current: Lang = initial()
const HTML_LANG: Record<Lang, string> = { zh: 'zh-Hant-TW', en: 'en-GB', vi: 'vi' }
if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[current]

export const getLang = () => current

export function setLang(l: Lang) {
  if (l === current) return
  current = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* ignore */
  }
  document.documentElement.lang = HTML_LANG[l]
  for (const f of subs) f()
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => current,
    () => current,
  )
}

/** 介面上的固定文字：t('中文', 'English', 'Tiếng Việt')；沒給越南文就用英文 */
export const t = (zh: string, en: string, vi?: string) => (current === 'zh' ? zh : current === 'vi' ? (vi ?? en) : en)
/** 日期等格式用的語系 */
export const locale = () => ({ zh: 'zh-TW', en: 'en-GB', vi: 'vi-VN' })[current]
/** 引擎送來的雙語文字（紀錄、詢問、錯誤）挑目前的語言 */
export const tx = (s: string | null | undefined) => (s ? pick(s, current) : '')

/** 切換語言：中文／English／Tiếng Việt */
const LANGS: { id: Lang; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'vi', label: 'Tiếng Việt' },
]
export function LangToggle({ className = 'lang-btn' }: { className?: string }) {
  const l = useLang()
  return (
    <select className={className} value={l} onChange={(e) => setLang(e.target.value as Lang)} aria-label="語言 / Language / Ngôn ngữ" title="語言 / Language / Ngôn ngữ">
      {LANGS.map((x) => (
        <option key={x.id} value={x.id}>
          {x.label}
        </option>
      ))}
    </select>
  )
}
