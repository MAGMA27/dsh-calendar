/**
 * Root-scoped calendar open/close store.
 *
 * Both the `shell.overlay` calendar panel and the `sidebar.footer.action`
 * entry are root-scoped (reachable without opening a session), so they cannot
 * share a per-session store. This tiny module-level store coordinates the two:
 * the entry toggles it, the overlay reads it.
 */

let open = false
const listeners = new Set<() => void>()

/** Synchronously-readable open flag (a useSyncExternalStore source). */
export function isCalendarOpen(): boolean {
  return open
}

/** Flip the open flag and notify subscribers. */
export function setCalendarOpen(value: boolean): void {
  if (open === value) return
  open = value
  for (const fn of [...listeners]) fn()
}

/** Toggle the open flag. */
export function toggleCalendarOpen(): void {
  setCalendarOpen(!open)
}

/** Subscribe to open-flag changes; returns an unsubscribe. */
export function subscribeCalendarOpen(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
