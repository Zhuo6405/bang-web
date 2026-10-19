import { CARD_DEFS, rankLabel, ROLE_NAME, SUIT_SYMBOL } from '../../engine/data'
import type { Card, Role } from '../../engine/types'

export function CardFace({
  card,
  selected,
  usable,
  onClick,
  small,
  forced,
}: {
  card: Card
  selected?: boolean
  usable?: boolean
  onClick?: () => void
  small?: boolean
  forced?: boolean
}) {
  const def = CARD_DEFS[card.key]
  const red = card.suit === 'H' || card.suit === 'D'
  const cls = ['card', `c-${def.colour}`, selected && 'is-selected', usable && 'is-usable', small && 'is-small', forced && 'is-forced'].filter(Boolean).join(' ')
  const title = `${def.name}（${SUIT_SYMBOL[card.suit]}${rankLabel(card.rank)}）\n${def.desc}`
  const inner = (
    <>
      <span className={`card-suit ${red ? 'is-red' : ''}`}>
        {rankLabel(card.rank)}
        {SUIT_SYMBOL[card.suit]}
      </span>
      <span className="card-name">{def.name}</span>
      {!small && <span className="card-type">{def.colour === 'blue' ? (def.range ? `射程 ${def.range}` : '裝備') : def.colour === 'green' ? '綠牌' : def.cost ? '另棄 1 張' : '立即使用'}</span>}
    </>
  )
  if (!onClick)
    return (
      <div className={cls} title={title}>
        {inner}
      </div>
    )
  return (
    <button type="button" className={cls} onClick={onClick} title={title} aria-pressed={selected} aria-label={`${def.name} ${SUIT_SYMBOL[card.suit]}${rankLabel(card.rank)}`}>
      {inner}
    </button>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`role r-${role}`}>{ROLE_NAME[role]}</span>
}
