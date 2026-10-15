/**
 * The top of every page, and the page's width.
 *
 * The header is 64 px: the title in the phone's page-title style (21/600, as
 * "Projects" is on the phone), an optional line under it, and the page's
 * main action on the right. Pages are at most 1144 px wide with 32 px
 * gutters, which at 1440 is exactly the room the rail leaves.
 *
 *   <Page title="Jobs" actions={<Button variant="primary" href={paths.jobNew}>New job</Button>}>
 *     …
 *   </Page>
 */
import type { ReactNode } from 'react'
import { color, size, space, text } from '../tokens'

export interface PageHeaderProps {
  title: ReactNode
  /** A line under the title, in grey. */
  subtitle?: ReactNode
  /** Before the title: a back link. */
  leading?: ReactNode
  /** On the right: the page's main action, and at most one or two more. */
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, leading, actions }: PageHeaderProps) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: space.md, minHeight: size.header, padding: `${space.sm}px 0`, boxSizing: 'border-box' }}>
      {leading}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, ...text.title, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h1>
        {subtitle && <div style={{ ...text.sm, marginTop: 2, color: color.muted }}>{subtitle}</div>}
      </div>
      {actions && <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: space.xs }}>{actions}</div>}
    </header>
  )
}

export interface PageLayoutProps extends Partial<PageHeaderProps> {
  children?: ReactNode
  /** 'full' drops the 1144 px cap, for a page that is mostly map. */
  width?: 'page' | 'full'
}

/** A page: the header (when it has a title; the job page draws its own) and the body at page width. */
export function Page({ children, width = 'page', title, ...header }: PageLayoutProps) {
  return (
    <div
      style={{
        maxWidth: width === 'full' ? 'none' : size.page + 2 * size.gutter,
        margin: '0 auto',
        // 32 px gutters at a desk, easing to 16 on a phone-width window.
        padding: `0 clamp(16px, 4vw, ${size.gutter}px) ${space.xxl}px`,
        boxSizing: 'border-box',
      }}
    >
      {title !== undefined && <PageHeader title={title} {...header} />}
      {children}
    </div>
  )
}
