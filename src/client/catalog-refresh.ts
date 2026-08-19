/**
 * Catalog-refresh watcher (pure, cordis-free).
 *
 * The execution-settings catalog (workspaces / sessions / providers+models /
 * presets) is assembled on the Host and fetched once at plugin boot. Sessions
 * created AFTER that boot — the sidebar creates them through the sessions
 * manager — would otherwise never appear in the task-detail session dropdown
 * until a reload. This watcher keeps the catalog live:
 *
 * - any change to the sessions list store (a session was created, renamed,
 *   archived, or adopted) schedules a re-pull;
 * - opening the calendar also schedules a re-pull, covering sessions the list
 *   store does not track (cold/persisted sessions attached from disk);
 *
 * Both paths go through a short debounce so a burst of store notifications
 * (a create fires several) coalesces into one HTTP GET. Returns a disposer.
 */

/** The slice of `sessions.list` this watcher subscribes to. */
export interface CatalogRefreshList {
  subscribe(fn: () => void): () => void
}

export interface CatalogRefreshDeps {
  /** The sessions list store; any change re-pulls the catalog. */
  list: CatalogRefreshList
  /** Subscribe to the calendar open-flag store. */
  subscribeOpen(fn: () => void): () => void
  /** Whether the calendar is currently open. */
  isOpen(): boolean
  /** Re-pull the catalog from the Host (best-effort, fire-and-forget). */
  refresh(): void
}

/** Coalescing window: several store notifications land as one refresh. */
export const REFRESH_DEBOUNCE_MS = 300

/**
 * Arm the watcher. Returns a disposer that unsubscribes both stores and
 * cancels any pending debounced refresh.
 */
export function watchCatalogRefresh(deps: CatalogRefreshDeps): () => void {
  const { list, subscribeOpen, isOpen, refresh } = deps
  let timer: ReturnType<typeof setTimeout> | undefined
  let wasOpen = isOpen()

  const schedule = (): void => {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  // A session was created/renamed/archived while the plugin runs → re-pull.
  const onListChange = (): void => schedule()

  // Entering the calendar is a natural moment for fresh data, and it covers
  // cold sessions the list store never saw (persisted sessions attached on
  // demand from disk).
  const onOpenChange = (): void => {
    const nowOpen = isOpen()
    if (nowOpen && !wasOpen) schedule()
    wasOpen = nowOpen
  }

  const unsubList = list.subscribe(onListChange)
  const unsubOpen = subscribeOpen(onOpenChange)
  return () => {
    unsubList()
    unsubOpen()
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
}
