/**
 * The drawing's own presentation, copied: on anything wider than a phone the
 * app renders inside the zip's 390 × 844 charcoal bezel on the grey canvas —
 * so a laptop shows exactly what the design file shows. On a real phone the
 * frame disappears and the app owns the screen.
 */
import { useEffect, useState, type ReactNode } from 'react'

const WIDE = '(min-width: 700px)'

export function PhoneFrame({ children }: { children: ReactNode }) {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)

  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  if (!wide) return <div style={{ height: '100dvh', minHeight: '100vh' }}>{children}</div>

  return (
    <div style={{ height: '100dvh', minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: '22px 20px 28px', background: '#EDEFF1' }}>
      <div style={{ flex: 'none', width: 390, height: 844, background: '#2B2F33', borderRadius: 42, padding: 9, boxShadow: '0 10px 30px rgba(26,29,33,.22)' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 34, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#F5F6F7' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
