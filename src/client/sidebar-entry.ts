/**
 * Sidebar entry injection.
 *
 * Re-creates the original top-left "日历" icon entry in the shell's sidebar.
 * dsh exposes no additive top-sidebar slot, so the row is injected at the DOM
 * level between the shell's New Session button and the workspace browser. The
 * injection self-heals: a MutationObserver + periodic re-assert re-inserts the
 * row whenever a React re-render displaces it. Clicking the entry flips the
 * current session's conversation view to the calendar (a stable slot render).
 */
import { t } from './locales.ts'
import css from './calendar.module.css'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-calendar-entry]'

/** Inline icon (matches the shell's 16px nav-icon look). */
const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10.5" rx="1.5"/><path d="M1.5 6h13M5 1.5v3M11 1.5v3"/></svg>'

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"], button[class*="newProject"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

function createEntry(onActivate: () => void): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshcalendarEntry = ''
  entry.className = css.entry
  entry.setAttribute('aria-label', t('entry.label'))
  entry.title = t('entry.label')
  entry.innerHTML = `<span class="${css.entryIcon}">${ICON}</span><span class="${css.entryLabel}">${t('entry.label')}</span>`
  entry.addEventListener('click', onActivate)
  return entry
}

function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = (row !== null && row.parentElement === root) ? row : button
    const family = Array.from(root.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-dsh-calendar-entry], [data-dsh-taskboard-entry], [data-dsh-ssh-entry]'),
    )
    const anchor = family.length > 0 ? family[0] as Node : (base.nextElementSibling as Node | null)
    root.insertBefore(entry, anchor)
  }
  return true
}

/** Mount the sidebar entry, self-healing on React re-renders. */
export function mountSidebarEntry(onActivate: () => void): () => void {
  if (typeof document !== 'undefined' && document.querySelector(ENTRY_SELECTOR) !== null) {
    return () => {}
  }
  const entry = createEntry(onActivate)
  let root: HTMLElement | undefined
  let placed = false
  let rootObserver: MutationObserver | undefined

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      rootObserver?.disconnect()
      root = undefined
      placed = false
    }
    if (placed) {
      if (document.body.contains(entry)) return
      rootObserver?.disconnect()
      root = undefined
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) {
      rootObserver = new MutationObserver(() => {
        if (root === undefined || !root.isConnected) {
          placed = false
          tryPlace()
          return
        }
        if (!root.contains(entry)) placed = placeEntry(root, entry)
      })
      rootObserver.observe(root, { childList: true, subtree: true })
    }
  }

  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const selfHealTimer = globalThis.setInterval ? globalThis.setInterval(tryPlace, 1000) : undefined

  tryPlace()

  return () => {
    if (selfHealTimer !== undefined) globalThis.clearInterval(selfHealTimer)
    waitObserver.disconnect()
    rootObserver?.disconnect()
    entry.remove()
  }
}
