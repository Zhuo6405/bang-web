import { useSyncExternalStore } from 'react'
import { pick, type Lang } from '../engine/i18n'

/** 介面語言：存在這台裝置上，切換時所有畫面一起更新 */
const KEY = 'bang-lang'
const subs = new Set<() => void>()

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'en' || v === 'zh') return v
  } catch {
    /* 無痕模式等情況讀不到就用預設 */
  }
  return 'zh'
}

let current: Lang = initial()
if (typeof document !== 'undefined') document.documentElement.lang = current === 'en' ? 'en-GB' : 'zh-Hant-TW'

export const getLang = () => current

export function setLang(l: Lang) {
  if (l === current) return
  current = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l === 'en' ? 'en-GB' : 'zh-Hant-TW'
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

/** 介面上的固定文字：t('中文', 'English') */
export const t = (zh: string, en: string) => (current === 'en' ? en : zh)
/** 引擎送來的雙語文字（紀錄、詢問、錯誤）挑目前的語言 */
export const tx = (s: string | null | undefined) => (s ? pick(s, current) : '')

/** 切換語言的按鈕 */
export function LangToggle({ className = 'ghost lang-btn' }: { className?: string }) {
  const l = useLang()
  return (
    <button
      type="button"
      className={className}
      onClick={() => setLang(l === 'en' ? 'zh' : 'en')}
      aria-label={l === 'en' ? '切換成中文' : 'Switch to English'}
      title={l === 'en' ? '切換成中文' : 'Switch to English'}
    >
      {l === 'en' ? '中文' : 'EN'}
    </button>
  )
}
