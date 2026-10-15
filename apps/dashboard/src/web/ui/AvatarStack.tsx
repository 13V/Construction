/**
 * Who is on a job, as overlapping initials: the phone's avatar stacks, in
 * its four greys (avatarGrey) so neighbouring heads stay separable.
 *
 * Shows `max` people and a +N for the rest. Each head's name is its tooltip,
 * and the stack as a whole reads "Dean Papadopoulos, Maria Voulgaris and 2
 * more".
 */
import { avatarGrey } from '../phone'
import { color } from '../tokens'

export interface Person {
  id: string
  name: string
  /** Falls back to the first letters of the first and last names. */
  initials?: string | null
}

export const initialsOf = (p: Person) =>
  (p.initials?.trim() ||
    p.name
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i, all) => (i === 0 || i === all.length - 1 ? w[0] : ''))
      .join('')
  ).slice(0, 2).toUpperCase()

export function AvatarStack({ people, max = 4, size = 26 }: { people: ReadonlyArray<Person>; max?: number; size?: number }) {
  if (people.length === 0) return null
  const shown = people.slice(0, people.length > max ? max - 1 : max)
  const more = people.length - shown.length
  const names = people.map((p) => p.name)
  const said =
    names.length <= max ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, shown.length).join(', ')} and ${more} more`
  const head = { width: size, height: size, borderRadius: '50%', boxShadow: `0 0 0 2px ${color.panel}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: Math.round(size * 0.4), fontWeight: 700, letterSpacing: '.02em' } as const

  return (
    <span role="img" aria-label={said} style={{ display: 'inline-flex', alignItems: 'center', paddingLeft: 2 }}>
      {shown.map((p, i) => (
        <span key={p.id} title={p.name} aria-hidden="true" style={{ ...head, marginLeft: i === 0 ? 0 : -6, background: avatarGrey(i), color: color.onDark, zIndex: shown.length - i }}>
          {initialsOf(p)}
        </span>
      ))}
      {more > 0 && (
        <span title={names.slice(shown.length).join(', ')} aria-hidden="true" style={{ ...head, marginLeft: -6, background: color.fill, color: color.body, fontSize: Math.round(size * 0.38) }}>
          +{more}
        </span>
      )}
    </span>
  )
}
