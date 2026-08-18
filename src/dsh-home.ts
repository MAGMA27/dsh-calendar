/**
 * Resolution of the DSH home directory and the calender data root. The ledger
 * lives under `$DSH_HOME/calender`, never under a cwd-dependent path.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'

/** The calender data directory name under the DSH home. */
export const CALENDER_DIR = 'calender'
/** The ledger file name. */
export const LEDGER_FILE = 'ledger-v1.json'

/** Resolve the DSH home (env `DSH_HOME`, else `~/.dsh`). */
export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Resolve the calender data directory (creates nothing here). */
export function calenderDir(home: string = dshHome()): string {
  return join(home, CALENDER_DIR)
}

/** Resolve the ledger file path. */
export function ledgerPath(home: string = dshHome()): string {
  return join(calenderDir(home), LEDGER_FILE)
}
