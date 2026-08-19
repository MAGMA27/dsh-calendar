/**
 * Session-navigation watcher (pure, cordis-free).
 *
 * While the calendar overlay is open, switching the current session — clicking
 * a session in the sidebar workspace browser, or starting a new session —
 * closes the calendar so the conversation shows through. The baseline is
 * re-seeded every time the calendar opens, so opening the calendar over an
 * already-current session does not instantly close it.
 *
 * The two subscriptions (open-store + sessions list) are the only dependency,
 * passed in so this stays a plain function that unit tests can drive without a
 * cordis context.
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
