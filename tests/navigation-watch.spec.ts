/**
 * watchSessionNavigation: while the calendar is open, switching the current
 * session closes the calendar; the baseline re-seeds on each open so opening
 * over the current session does not instantly close it.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  watchSessionNavigation,
  type SessionNavigationList,
} from '../src/client/navigation-watch.ts'

/** Minimal observable list fake driven by an explicit `current` value. */
function listFake(current: string | undefined): {
  list: SessionNavigationList
  setCurrent(v: string | undefined): void
} {
  let value = current
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => ({ current: value }),
      subscribe: (fn) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    },
    setCurrent(v) {
      value = v
      for (const fn of [...listeners]) fn()
    },
  }
}

/** Build an open-flag fake plus the watch result for the common shape. */
function harness(initialCurrent: string | undefined) {
  const { list, setCurrent } = listFake(initialCurrent)
  let open = false
  const openListeners = new Set<() => void>()
  const setOpen = vi.fn((v: boolean) => {
    open = v
    for (const fn of [...openListeners]) fn()
  })
  const dispose = watchSessionNavigation({
    isOpen: () => open,
    setOpen,
    subscribeOpen: (fn) => {
      openListeners.add(fn)
      return () => { openListeners.delete(fn) }
    },
    list,
  })
  return { list, setCurrent, open: () => open, setOpen, dispose }
}

describe('watchSessionNavigation', () => {
  it('closes the calendar when the current session changes while open', () => {
    const h = harness('session-a')
    h.setOpen(true) // open calendar over session-a (baseline = session-a)
    expect(h.open()).toBe(true)
    h.setCurrent('session-b') // click a different session in the sidebar
    expect(h.open()).toBe(false)
    expect(h.setOpen).toHaveBeenCalledWith(false)
  })

  it('does not close on a session change while the calendar is closed', () => {
    const h = harness('session-a')
    h.setCurrent('session-b')
    expect(h.open()).toBe(false)
    expect(h.setOpen).not.toHaveBeenCalled()
  })

  it('does not close when the current session stays the same', () => {
    const h = harness('session-a')
    h.setOpen(true)
    expect(h.open()).toBe(true)
    h.setCurrent('session-a') // same session re-selected
    expect(h.open()).toBe(true)
    expect(h.setOpen).not.toHaveBeenCalledWith(false)
  })

  it('re-seeds the baseline each open so a pre-existing current is not "new"', () => {
    const h = harness('session-a')
    h.setOpen(true) // baseline = session-a
    h.setOpen(false) // calendar closed
    // While closed, current changes...
    h.setCurrent('session-b')
    // ...then the calendar opens over session-b: baseline = session-b, no close.
    h.setOpen(true)
    expect(h.open()).toBe(true)
    h.setCurrent('session-b')
    expect(h.open()).toBe(true)
  })

  it('closes when a new session starts (current transitions through undefined)', () => {
    const h = harness(undefined)
    h.setOpen(true) // no-session state; baseline = undefined
    h.setCurrent('brand-new') // start a new session
    expect(h.open()).toBe(false)
  })

  it('disposer removes both subscriptions', () => {
    const h = harness('session-a')
    h.setOpen(true)
    h.dispose()
    h.setCurrent('session-b')
    expect(h.open()).toBe(true) // no longer watching
  })
})
