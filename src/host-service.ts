/**
 * Host-side service container for dsh-calender: owns the ledger and the
 * lifecycle of the Host half. M1 carries no scheduler/execution yet — the
 * cron scheduler (M5) and the real-execution runner (M4) mount here.
 */
import { AtomicFileLedgerPersist, HostLedger, type HostLedgerPersist } from './host-ledger.ts'

export interface HostServiceOptions {
  /** Persistence backend; defaults to the atomic file ledger under $DSH_HOME. */
  ledgerPersist?: HostLedgerPersist
  clock?: () => number
}

/** The Host side of dsh-calender. */
export class CalenderHostService {
  readonly ledger: HostLedger
  private disposed = false

  constructor(options: HostServiceOptions = {}) {
    const persist = options.ledgerPersist ?? new AtomicFileLedgerPersist()
    this.ledger = new HostLedger(persist, options.clock)
  }

  /** Idempotent teardown of everything the Host half owns. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
  }
}
