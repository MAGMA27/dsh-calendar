// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REFRESH_DEBOUNCE_MS, watchCatalogRefresh } from '../src/client/catalog-refresh.ts'

function makeDeps(overrides: Partial<Parameters<typeof watchCatalogRefresh>[0]> = {}) {
  let open = false
  const listSubs = new Set<() => void>()
  const openSubs = new Set<() => void>()
  const refresh = vi.fn()
  const deps = {
    list: { subscribe: (fn: () => void) => { listSubs.add(fn); return () => { listSubs.delete(fn) } } },
    subscribeOpen: (fn: () => void) => { openSubs.add(fn); return () => { openSubs.delete(fn) } },
    isOpen: () => open,
    refresh,
    ...overrides,
  }
  return {
    deps,
    emitList: () => { for (const fn of [...listSubs]) fn() },
    setOpen: (v: boolean) => { open = v; for (const fn of [...openSubs]) fn() },
    listSubs,
    openSubs,
    refresh,
  }
}

describe('watchCatalogRefresh', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('re-pulls the catalog after a sessions-list change (debounced)', () => {
    const h = makeDeps()
    watchCatalogRefresh(h.deps)
    h.emitList()
    expect(h.refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('coalesces a burst of list notifications into one refresh', () => {
    const h = makeDeps()
    watchCatalogRefresh(h.deps)
    h.emitList()
    h.emitList()
    h.emitList()
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1)
    h.emitList()
    vi.advanceTimersByTime(1)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('re-pulls on a closed→open transition (fresh data when entering)', () => {
    const h = makeDeps()
    watchCatalogRefresh(h.deps)
    h.setOpen(true)
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS)
    expect(h.refresh).toHaveBeenCalledTimes(1)
    // Staying open does not re-trigger.
    h.setOpen(true)
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS)
    expect(h.refresh).toHaveBeenCalledTimes(1)
    // Close then reopen triggers again.
    h.setOpen(false)
    h.setOpen(true)
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS)
    expect(h.refresh).toHaveBeenCalledTimes(2)
  })

  it('refresh on open only when the calendar was actually closed', () => {
    const h = makeDeps()
    h.setOpen(true) // open before the watcher arms
    watchCatalogRefresh(h.deps)
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS)
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it('dispose unsubscribes both stores and cancels a pending refresh', () => {
    const h = makeDeps()
    const dispose = watchCatalogRefresh(h.deps)
    h.emitList()
    dispose()
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS)
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.listSubs.size).toBe(0)
    expect(h.openSubs.size).toBe(0)
  })
})
