/**
 * dsh-calender client half (browser). Loader entry for the GUI face: mounts
 * the same-origin calendar view over the Host service (HTTP transport, sidebar
 * entry, center-column takeover).
 *
 * M0 scaffold: the apply is intentionally minimal so the package mounts and
 * boots without error. The transport (host-api), DOM mounting
 * (sidebar-entry / calendar-mount) and the React views land in M2+.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Required services (empty for the scaffold; filled as client features land). */
export const inject: string[] = []

/** Client plugin body: nothing to mount yet in the scaffold. */
export function apply(_ctx: ClientContext): void {}
