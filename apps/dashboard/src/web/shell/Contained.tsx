/**
 * A box the phone's own screens run in, unchanged, inside the website.
 *
 * The phone's sheets are position:fixed to the bottom of the screen. Inside
 * a box with a transform, "fixed" means fixed to that box instead (CSS makes
 * a transformed element the containing block for its fixed descendants), so
 * a sheet opened by a panel in here opens in here, at the panel's width,
 * rather than across the whole window. Measured: the New project sheet went
 * from 1440x828 to 372x826 inside a 372 px host.
 *
 * This is the only seam for reusing phone UI. A phone component never gets a
 * prop for the website's sake (even a default-valued one changes the iOS
 * bundle), and nothing here reaches into it: no wb- class, no DOM shim.
 *
 * Two boxes, on purpose: the outer one has the transform and does not
 * scroll, the inner one scrolls. Fixed sheets belong to the outer one, so
 * they stay put at its bottom while the panel scrolls underneath, as they
 * do on a phone.
 *
 * Inside, the text settings are put back to what the phone's own page has
 * (index.css's body: 16 px, normal line height), because the website's root
 * sets 14 px and a phone screen that inherits a size would otherwise shrink.
 *
 *   <Contained width={440} height="calc(100vh - 220px)" label="Waterproofing, as the crew see it">
 *     <WaterproofingPanel me={me} site={site} />
 *   </Contained>
 */
import type { CSSProperties, ReactNode } from 'react'
import { color, font, radius } from '../tokens'

export interface ContainedProps {
  children: ReactNode
  /** A phone is 390-430 px; most panels want 440. Any CSS length. */
  width?: number | string
  /** It must be bounded, or sheets would sit below the fold. Any CSS length. */
  height: number | string
  /** What a screen reader calls the region. */
  label: string
  style?: CSSProperties
}

export function Contained({ children, width = '100%', height, label, style }: ContainedProps) {
  return (
    <section
      aria-label={label}
      style={{
        position: 'relative',
        width,
        maxWidth: '100%',
        height,
        transform: 'translateZ(0)',
        isolation: 'isolate',
        overflow: 'hidden',
        background: color.appBg,
        border: `1px solid ${color.borderSoft}`,
        borderRadius: radius.lg,
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <div
        style={{
          height: '100%',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: font,
          fontSize: 16,
          lineHeight: 'normal',
          letterSpacing: 'normal',
          color: color.ink,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {children}
      </div>
    </section>
  )
}
