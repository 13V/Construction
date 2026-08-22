/**
 * The file viewer — where every tapped file actually opens.
 *
 * On the web, `target="_blank"` on a signed URL is a perfectly good way to
 * open a PDF. Inside the iOS shell it is not: WKWebView has no tabs, no
 * download manager and no address bar, so a popup either bounces the crew out
 * to Safari or does nothing at all — and an `<a download>` on a blob URL,
 * which is how every generated PDF used to leave the app, is silently ignored
 * by WKWebView. A certificate button that works on a laptop and dies on the
 * phone it was drawn for is the worst kind of broken.
 *
 * So files open here instead: a full-screen sheet with the document in an
 * iframe, which WKWebView renders natively for PDFs and images — the same
 * engine Safari uses on the same phone. Share hands the actual bytes to the
 * system share sheet (AirDrop, Mail, Save to Files) where the platform offers
 * one, which is how a certificate really gets to a builder standing next to
 * you.
 *
 * One instance is mounted at the app root; callers anywhere say
 * `viewFile(...)` and never learn where the sheet lives. A module-level store
 * rather than context, because the call sites are leaf components ten levels
 * deep in five different screens and every one of them would otherwise be
 * threading a prop it does not care about.
 */
import { useEffect, useState } from 'react'
import { SAFE_BOTTOM, SAFE_TOP } from './stheme'

export interface ViewableFile {
  /** A resolved (usually signed) URL. Give this or `blob`. */
  url?: string | null
  /** The bytes themselves — a just-rendered PDF that exists nowhere else yet. */
  blob?: Blob
  /** What the header and the share sheet call it. */
  name: string
}

let listener: ((f: ViewableFile) => void) | null = null

/** Open a file over everything. A null/undefined URL is a no-op, not a crash. */
export function viewFile(file: ViewableFile) {
  if (!file.blob && !file.url) return
  listener?.(file)
}

const mimeOf = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic') return 'image/heic'
  return 'application/octet-stream'
}

export function FileViewerHost() {
  const [file, setFile] = useState<ViewableFile | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  useEffect(() => {
    listener = (f) => {
      setFile(f)
      setShareError(null)
    }
    return () => {
      listener = null
    }
  }, [])

  // A blob gets an object URL for the iframe, revoked when the sheet closes —
  // not immediately, because revoking a URL an iframe is still reading from
  // cancels the render in Safari.
  useEffect(() => {
    if (!file) {
      setSrc(null)
      return
    }
    if (file.blob) {
      const u = URL.createObjectURL(file.blob)
      setSrc(u)
      return () => URL.revokeObjectURL(u)
    }
    setSrc(file.url ?? null)
    return undefined
  }, [file])

  if (!file) return null

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function share() {
    if (!file || sharing) return
    setSharing(true)
    setShareError(null)
    try {
      // The share sheet wants bytes, not a URL — a signed URL expires and
      // means nothing to Mail. Storage is CORS-open, so a URL-only file is
      // fetched here, once, when somebody actually asks to share it.
      const blob = file.blob ?? (await (await fetch(file.url!)).blob())
      const f = new File([blob], file.name, { type: blob.type || mimeOf(file.name) })
      if (navigator.canShare && !navigator.canShare({ files: [f] })) {
        await navigator.share({ title: file.name, url: file.url ?? undefined })
      } else {
        await navigator.share({ files: [f], title: file.name })
      }
    } catch (err) {
      // Closing the share sheet without picking anything rejects with
      // AbortError. That is a choice, not a failure.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setShareError('Could not open the share sheet for this file.')
      }
    }
    setSharing(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'flex', flexDirection: 'column', background: '#14171A', paddingTop: SAFE_TOP }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.name}
        </span>
        {canShare && (
          <span
            onClick={() => void share()}
            style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 16, background: 'rgba(255,255,255,.12)', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer', opacity: sharing ? 0.55 : 1 }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 12.5V3.4M6.8 6.2L10 3l3.2 3.2" />
              <path d="M4.5 10.5v5.3h11v-5.3" />
            </svg>
            {sharing ? 'Sharing…' : 'Share'}
          </span>
        )}
        <span
          onClick={() => setFile(null)}
          style={{ flex: 'none', display: 'flex', alignItems: 'center', height: 32, padding: '0 13px', borderRadius: 16, background: 'rgba(255,255,255,.12)', fontSize: 13.5, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
        >
          Done
        </span>
      </div>
      {shareError && (
        <span style={{ flex: 'none', margin: '0 16px 10px', padding: '9px 12px', borderRadius: 9, background: 'rgba(220,80,80,.18)', fontSize: 12.5, color: '#FFB4B4' }}>
          {shareError}
        </span>
      )}
      <div style={{ flex: 1, minHeight: 0, background: '#fff', paddingBottom: SAFE_BOTTOM }}>
        {src ? (
          <iframe title={file.name} src={src} style={{ display: 'block', width: '100%', height: '100%', border: 0 }} />
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 13.5, color: '#8B9096' }}>
            Loading…
          </span>
        )}
      </div>
    </div>
  )
}
