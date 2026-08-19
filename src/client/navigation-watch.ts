/**
 * Session-navigation watcher (pure, cordis-free).
 *
 * While the calendar overlay is open, switching the current session — clicking
 * a session in the sidebar workspace browser, or starting a new session —
 * closes the calendar so the conversation shows through. The baseline is
 * re-seeded every time the calendar opens, so opening the calendar over an
 * already-current session does not instantly close it.
 *
 * Clicking the ALREADY-current session changes no `list.current` (the manager
 * still notifies, but with the same value), so the list watcher alone cannot
 * see that gesture. `closeOnSessionOpen` patches the shared `sessions.open`
 * method — every explicit session-open (sidebar click, fork, workflow child)
 * flows through it — and closes the calendar on any call, then restores the
 * original on dispose.
 *
 * The two subscriptions (open-store + sessions list) plus the open wrap are the
 * only dependencies, passed in so this stays a plain function that unit tests
 * can drive without a cordis context.
 */

/** The slice of `sessions.list` this watcher reads (kept minimal for tests). */
export interface SessionNavigationList {
  subscribe(fn: () => void): () => void
  getSnapshot(): { current: string | undefined }
}

export interface NavigationWatchDeps {
  /** Whether the calendar is currently open. */
  isOpen(): boolean
  /** Flip the calendar open flag. */
  setOpen(open: boolean): void
  /** Subscribe to open-flag changes; returns an unsubscribe. */
  subscribeOpen(fn: () => void): () => void
  /** The sessions list store (reads `current`, subscribes to changes). */
  list: SessionNavigationList
}

/**
 * Arm the watcher. Returns a disposer that removes both subscriptions.
 * @param deps - the injected store handles (see NavigationWatchDeps).
 */
export function watchSessionNavigation(deps: NavigationWatchDeps): () => void {
  const { isOpen, setOpen, subscribeOpen, list } = deps
  let sessionBaseline: string | undefined = undefined
  let wasOpen = isOpen()

  const onOpenChange = (): void => {
    const nowOpen = isOpen()
    // Only re-seed the baseline on a closed→open transition; keeping it while
    // already open would let the current session become "new" mid-visit.
    if (nowOpen && !wasOpen) sessionBaseline = list.getSnapshot().current
    wasOpen = nowOpen
  }

  const onListChange = (): void => {
    if (!isOpen()) return
    const current = list.getSnapshot().current
    if (current !== sessionBaseline) {
      sessionBaseline = current
      setOpen(false)
    }
  }

  const unsubOpen = subscribeOpen(onOpenChange)
  const unsubList = list.subscribe(onListChange)
  return () => {
    unsubOpen()
    unsubList()
  }
}

/**
 * Close the calendar on any explicit session-open. Patches the shared
 * `sessions.open` method so a click on the already-current session (which
 * changes no `list.current`) also closes the overlay; every open flows through
 * this method. Returns a disposer that restores the original method.
 * @param sessions - the sessions service face (open patched in place).
 * @param close - the calendar-close callback.
 */
export function closeOnSessionOpen(
  sessions: { open(id: string): void },
  close: () => void,
): () => void {
  const original = sessions.open.bind(sessions)
  sessions.open = (id: string): void => {
    close()
    original(id)
  }
  return () => {
    sessions.open = original
  }
}
