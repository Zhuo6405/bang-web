import { CARD_DEFS, rankLabel, SUIT_SYMBOL } from '../../engine/data'
import { cardDesc, cardName, roleName } from '../../engine/i18n'
import { getLang, t } from '../lang'
import type { Card, Role } from '../../engine/types'

export function CardFace({
  card,
  selected,
  usable,
  onClick,
  small,
  forced,
  onDoubleClick,
}: {
  card: Card
  selected?: boolean
  usable?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  small?: boolean
  forced?: boolean
}) {
  const def = CARD_DEFS[card.key]
  const l = getLang()
  const name = cardName(card.key, l)
  const red = card.suit === 'H' || card.suit === 'D'
  const cls = ['card', `c-${def.colour}`, selected && 'is-selected', usable && 'is-usable', small && 'is-small', forced && 'is-forced'].filter(Boolean).join(' ')
  const title = `${name} (${SUIT_SYMBOL[card.suit]}${rankLabel(card.rank)})\n${cardDesc(card.key, l)}`
  const inner = (
    <>
      <span className={`card-suit ${red ? 'is-red' : ''}`}>
        {rankLabel(card.rank)}
        {SUIT_SYMBOL[card.suit]}
      </span>
      <span className="card-name">{name}</span>
      {!small && <span className="card-type">{def.colour === 'blue' ? (def.range ? t(`射程 ${def.range}`, `Range ${def.range}`, `Tầm ${def.range}`) : t('裝備', 'Equipment', 'Trang bị')) : def.colour === 'green' ? t('綠牌', 'Green', 'Xanh lá') : def.cost ? t('另棄 1 張', '+1 discard', 'Bỏ thêm 1 lá') : t('立即使用', 'Play now', 'Đánh ngay')}</span>}
    </>
  )
  if (!onClick)
    return (
      <div className={cls} title={title}>
        {inner}
      </div>
    )
  return (
    <button type="button" className={cls} onClick={onClick} onDoubleClick={onDoubleClick} title={title} aria-pressed={selected} aria-label={`${name} ${SUIT_SYMBOL[card.suit]}${rankLabel(card.rank)}`}>
      {inner}
    </button>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`role r-${role}`}>{roleName(role, getLang())}</span>
}
