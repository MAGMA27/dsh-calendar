/**
 * Cross-module-instance apply guard for the dsh-calendar client bundle.
 *
 * The client factory can run more than once in a single page lifetime (for
 * example when a stale bundle is mixed with a rebuilt one while `dsh web` is
 * restarted). The flag lives on globalThis so separate module instances share
 * one guard. First claim wins; later claims become no-ops until the claim is
 * released (fiber unload / hot-reload) or the page reloads.
 */

declare global {
  // eslint-disable-next-line no-var
  var __dshcalendarApplied: boolean | undefined
}

/** Claims the plugin apply slot. Returns true when this call won the slot. */
export function claimApply(): boolean {
  if (globalThis.__dshcalendarApplied === true) return false
  globalThis.__dshcalendarApplied = true
  return true
}

/** Releases the claim (fiber unload / hot-reload). */
export function releaseApply(): void {
  globalThis.__dshcalendarApplied = undefined
}
