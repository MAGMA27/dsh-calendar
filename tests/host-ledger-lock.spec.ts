import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireLedgerLock } from '../src/host-ledger.ts'

const temporaryHomes: string[] = []

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-calendar-lock-'))
  temporaryHomes.push(home)
  return home
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('ledger lock', () => {
  it('writes ownership metadata and releases only its own lock', () => {
    const home = makeHome()
    const release = acquireLedgerLock(home)
    const lockPath = join(home, 'calendar', 'ledger-v1.lock')
    const record = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; token: string; acquiredAt: string }

    expect(record.pid).toBe(process.pid)
    expect(record.token).not.toBe('')
    expect(record.acquiredAt).not.toBe('')
    expect(() => acquireLedgerLock(home)).toThrow('calendar ledger is locked by another dsh process')

    release()
    expect(() => readFileSync(lockPath, 'utf8')).toThrow()
  })

  it('recovers a stale lock whose owner process no longer exists', () => {
    const home = makeHome()
    const lockPath = join(home, 'calendar', 'ledger-v1.lock')
    const calendarPath = join(home, 'calendar')
    const stalePid = 999_999_999
    mkdirSync(calendarPath, { recursive: true })
    writeFileSync(lockPath, JSON.stringify({ pid: stalePid, token: 'old-token', acquiredAt: new Date(0).toISOString() }))

    const release = acquireLedgerLock(home)
    const record = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; token: string }
    expect(record.pid).toBe(process.pid)
    expect(record.token).not.toBe('old-token')
    release()
  })

  it('recovers the plain-PID lock format written by older versions', () => {
    const home = makeHome()
    const lockPath = join(home, 'calendar', 'ledger-v1.lock')
    const calendarPath = join(home, 'calendar')
    mkdirSync(calendarPath, { recursive: true })
    writeFileSync(lockPath, '999999999')

    const release = acquireLedgerLock(home)
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({ pid: process.pid })
    release()
  })
})
