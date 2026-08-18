/**
 * dsh-calender host half (node). Loader entry for the plugin's host face: the
 * Host owns the ledger, cron scheduler, execution runner, HTTP/SSE routes,
 * and the system-prompt announcement — the browser is a same-origin async view
 * over that service.
 *
 * M0 scaffold: the apply is intentionally minimal so the package mounts and
 * boots without error. The HostCalenderService (host-ledger / host-service /
 * host-runner / host-routes) and the SystemPrompt section land in M1 / M6.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Required services (empty for the scaffold; filled as host features land). */
export const inject: string[] = []

/** Host plugin body: nothing to mount yet in the scaffold. */
export function apply(_ctx: Context): void {}
