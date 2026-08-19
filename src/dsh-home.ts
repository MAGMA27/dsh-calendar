/**
 * Resolution of the DSH home directory and the calendar data root. The ledger
 * lives under `$DSH_HOME/calendar`, never under a cwd-dependent path.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'

/** The calendar data directory name under the DSH home. */
export const calendar_DIR = 'calendar'
/** The ledger file name. */
export const LEDGER_FILE = 'ledger-v1.json'

/** Resolve the DSH home (env `DSH_HOME`, else `~/.dsh`). */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Resolve the calendar data directory (creates nothing here). */
export function calendarDir(home: string = dshHome()): string {
  return join(home, calendar_DIR)
}

/** Resolve the ledger file path. */
export function ledgerPath(home: string = dshHome()): string {
  return join(calendarDir(home), LEDGER_FILE)
}
