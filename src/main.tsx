/// <reference types="vite-plugin-pwa/client" />
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

// --- Boot splash --------------------------------------------------------------
// Fade out the inline splash (markup in index.html) once React has painted.
function hideBootSplash() {
  const splash = document.getElementById('boot-splash')
  if (!splash) return
  splash.classList.add('boot-hidden')
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })
  // Safety net in case transitionend never fires.
  window.setTimeout(() => splash.remove(), 800)
}
requestAnimationFrame(() => requestAnimationFrame(hideBootSplash))

// --- Service worker -----------------------------------------------------------
// Offline app-shell + auto-update. registerType is 'autoUpdate', so a new SW
// activates on the next navigation; we just refresh to pick it up.
const updateSW = registerSW({
  onNeedRefresh() {
    updateSW(true)
  },
})

// --- Add-to-Home-Screen hint --------------------------------------------------
// Android/Chromium fire `beforeinstallprompt` (we defer it and trigger on tap).
// iOS Safari has no prompt API, so we show the manual Share-sheet instructions.
const A2HS_DISMISSED = 'dwc:a2hs-dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari standalone flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIosSafari() {
  const ua = navigator.userAgent
  const iOS = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ masquerades as macOS but exposes touch points.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const webkit = /AppleWebKit/.test(ua)
  const notOtherBrowser = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  return iOS && webkit && notOtherBrowser
}

function dismissed() {
  try {
    return localStorage.getItem(A2HS_DISMISSED) === '1'
  } catch {
    return false
  }
}

function rememberDismiss() {
  try {
    localStorage.setItem(A2HS_DISMISSED, '1')
  } catch {
    /* private mode — fine, banner just won't be remembered */
  }
}

function showInstallHint(opts: { ios: boolean; onInstall?: () => void }) {
  if (document.getElementById('a2hs-hint')) return

  const wrap = document.createElement('div')
  wrap.id = 'a2hs-hint'
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-label', 'Install this app')
  wrap.className =
    'fixed inset-x-0 bottom-0 z-[9998] flex justify-center px-4 ' +
    'pb-[calc(env(safe-area-inset-bottom)+1rem)] animate-fade-in-up'

  const body = opts.ios
    ? `Tap <span class="text-gold">Share</span> then
       <span class="text-gold">“Add to Home Screen”</span> to install.`
    : `Install this app for a full-screen, offline experience.`

  wrap.innerHTML = `
    <div class="card flex w-full max-w-sm items-center gap-3 !p-3.5">
      <img src="/pwa-192x192.png" alt="" width="44" height="44" class="rounded-xl" />
      <div class="min-w-0 flex-1">
        <p class="font-serif text-lg leading-tight text-gold">Wedding Disposable</p>
        <p class="text-xs leading-snug text-gold-300/70">${body}</p>
      </div>
      ${
        opts.ios
          ? ''
          : `<button id="a2hs-install" class="btn-gold !px-4 !py-2 text-sm">Install</button>`
      }
      <button id="a2hs-close" aria-label="Dismiss"
        class="icon-btn h-8 w-8 shrink-0 text-lg leading-none">×</button>
    </div>`

  const close = () => {
    wrap.classList.remove('animate-fade-in-up')
    wrap.style.transition = 'opacity 0.3s ease, transform 0.3s ease'
    wrap.style.opacity = '0'
    wrap.style.transform = 'translateY(12px)'
    window.setTimeout(() => wrap.remove(), 320)
  }

  document.body.appendChild(wrap)

  wrap.querySelector('#a2hs-close')?.addEventListener('click', () => {
    rememberDismiss()
    close()
  })
  wrap.querySelector('#a2hs-install')?.addEventListener('click', () => {
    rememberDismiss()
    close()
    opts.onInstall?.()
  })
}

function initInstallHint() {
  if (isStandalone() || dismissed()) return

  let deferred: BeforeInstallPromptEvent | null = null

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    // Give the guest a moment to land before nudging them.
    window.setTimeout(() => {
      if (dismissed() || isStandalone()) return
      showInstallHint({
        ios: false,
        onInstall: async () => {
          if (!deferred) return
          await deferred.prompt()
          await deferred.userChoice
          deferred = null
        },
      })
    }, 3500)
  })

  // Stop reminding once installed.
  window.addEventListener('appinstalled', () => {
    rememberDismiss()
    document.getElementById('a2hs-hint')?.remove()
  })

  // iOS never fires beforeinstallprompt — show manual instructions instead.
  if (isIosSafari()) {
    window.setTimeout(() => {
      if (dismissed() || isStandalone()) return
      showInstallHint({ ios: true })
    }, 3500)
  }
}

initInstallHint()
