/**
 * Host-side real-execution runner for dsh-calendar (M4). Given a task, it
 * opens an execution record on the Host ledger, connects a real dsh session
 * (reusing a task-pinned session or creating a fresh one in the target or
 * recent workspace), applies the task's execution pins (provider+model via
 * `sessions.selectModel`, agent preset via `agentPresets.select`, permission
 * via the `/permission <id>` slash command), renames the session to the task
 * title, sends the task prompt through `sessions.prompt` (mode 'queue'), and
 * settles the execution record once the session's turn completes.
 *
 * It is host-authoritative and deliberately framework-free: every runtime
 * face is a narrow structural slice of the ApiProxy session/workspace/presets
 * contracts (the same `{ rpcId, payload }` / `{ result }` envelope the catalog
 * builder already uses), so tests drive it with plain fakes and the Host
 * wires the real `ctx.apiProxy` in.
 *
 * Fail-closed: any pin that cannot be applied exactly as the task declares
 * fails the run without sending the prompt — running under different settings
 * than the task declared is worse than not running.
 */
import type { TaskRecord } from './core/tasks.ts'
import { randomId } from './protocol.ts'

/** A session row as the runner reads it from `sessions.list`. */
export interface RunnerSessionRow {
  sessionId: unknown
  running?: boolean
  blank?: boolean
  updatedAt?: number
}

/** The narrow sessions face (a structural slice of the ApiProxy). */
export interface RunnerSessionsFace {
  list(request: { rpcId: unknown; payload: Record<string, unknown> }): Promise<{ result?: { ok?: boolean; value?: { items?: RunnerSessionRow[] } } }>
  create(request: { rpcId: unknown; payload: { workspaceId?: string; sessionId?: string; agentPreset?: string } }): Promise<{ result?: { ok?: boolean; value?: { sessionId?: unknown; agentPreset?: string } } }>
  selectModel(request: { rpcId: unknown; payload: { sessionId: unknown; provider: string; model: string; reasoningEffort?: string } }): Promise<{ result?: { ok?: boolean } }>
  rename(request: { rpcId: unknown; payload: { sessionId: unknown; title: string } }): Promise<{ result?: { ok?: boolean } }>
  prompt(request: { rpcId: unknown; payload: { sessionId: unknown; mode: 'queue'; content: { type: 'text'; text: string }[] } }): Promise<{ result?: { ok?: boolean } }>
}

/** The narrow workspaces face (structural slice of the ApiProxy). */
export interface RunnerWorkspaceFace {
  list(request: { rpcId: unknown; payload: Record<string, unknown> }): Promise<{ result?: { ok?: boolean; value?: { items?: { workspaceId?: unknown }[] } } }>
}

/** The narrow agent-presets face (structural slice of the ApiProxy). */
export interface RunnerPresetsFace {
  select(request: { rpcId: unknown; payload: { sessionId: unknown; agentPreset: string } }): Promise<{ result?: { ok?: boolean } }>
}

/** Everything the runner needs from the runtime. */
export interface HostExecutionEnv {
  sessions: RunnerSessionsFace
  workspace?: RunnerWorkspaceFace
  presets?: RunnerPresetsFace
}

/** The narrow ledger face the runner writes executions through. */
export interface RunnerLedgerFace {
  taskById(id: string): TaskRecord | undefined
  openExecution(taskId: string, executionId: string, now: number): boolean
  settleExecution(taskId: string, executionId: string, outcome: 'succeeded' | 'failed' | 'cancelled', now: number, error: string | undefined, sessionId?: string): boolean
}

/** The result of a runner attempt: whether the execution was opened and,
 * when it was, the promise that settles the record (unknown duration). */
export interface RunResult {
  accepted: boolean
  settleFinished?: Promise<void>
}

/** Tuning knobs; defaults are safe for real runs and cheap to fake in tests. */
export interface HostExecutionRunnerOptions {
  now?: () => number
  uuid?: () => string
  settlePollMs?: number
  settleTimeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Human copy of a thrown value. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

let rpcSeq = 0
function req<P extends object = Record<string, unknown>>(payload: P = {} as P): { rpcId: unknown; payload: P } {
  return { rpcId: `calendar-run-${rpcSeq++}`, payload }
}

type SessionStatus = 'running' | 'stopped' | 'gone'

/**
 * Host-runner: opens an execution, drives a real dsh session, and settles the
 * execution record. `run()` is async and resolves once the prompt is accepted
 * (settlement continues detached, so the HTTP action handler and scheduler
 * return immediately); `reconcile()` settles executions left running across a
 * Host restart.
 */
export class HostExecutionRunner {
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly settlePollMs: number
  private readonly settleTimeoutMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(
    private readonly ledger: RunnerLedgerFace,
    private readonly env: HostExecutionEnv,
    private readonly options: HostExecutionRunnerOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.uuid = options.uuid ?? randomId
    this.settlePollMs = options.settlePollMs ?? 5_000
    this.settleTimeoutMs = options.settleTimeoutMs ?? 10 * 60_000
    this.sleep = options.sleep ?? defaultSleep
  }

  /** Open an execution and run the task to prompt-accepted (does not block on
   * settlement). Returns whether the run was accepted and, when it was, the
   * detached promise that settles the execution record once the turn completes.
   */
  async run(taskId: string): Promise<RunResult> {
    const task = this.ledger.taskById(taskId)
    if (task === undefined) return { accepted: false }
    const executionId = this.uuid()
    const startedAt = this.now()
    if (!this.ledger.openExecution(taskId, executionId, startedAt)) return { accepted: false }
    let sessionId: string | undefined
    try {
      const { sessionId: sid, fresh } = await this.connectSession(task)
      sessionId = sid
      await this.applyPins(task, sessionId, fresh)
      await this.sendPrompt(task, sessionId)
    } catch (error) {
      this.ledger.settleExecution(taskId, executionId, 'failed', this.now(), messageOf(error), sessionId)
      return { accepted: true }
    }
    // Settlement runs detached so the caller (HTTP route or scheduler) never
    // blocks on a long LLM turn. An await on settleFinished observes it.
    const settleFinished = this.settle(taskId, executionId, sessionId, startedAt)
    return { accepted: true, settleFinished }
  }

  /** Settle any execution left 'running' across a Host restart. A task whose
   * latest execution has no endedAt and no session id is left untouched (there
   * is nothing to reconcile). With a session id, the current session status
   * decides: gone → cancelled; stopped with prompt evidence → succeeded;
   * otherwise left running (a resumed agent may still be mid-turn). Returns
   * true when something was settled.
   */
  async reconcile(taskId: string): Promise<boolean> {
    const task = this.ledger.taskById(taskId)
    if (task === undefined) return false
    const execution = task.executions[task.executions.length - 1]
    if (execution === undefined || execution.endedAt !== undefined) return false
    if (execution.sessionId === undefined || execution.sessionId === '') return false
    const sessionId = execution.sessionId
    try {
      const status = await this.readStatus(sessionId, execution.startedAt)
      if (status === 'gone') {
        return this.ledger.settleExecution(taskId, execution.id, 'cancelled', this.now(), 'execution session no longer exists after host restart', sessionId)
      }
      if (status === 'stopped') {
        return this.ledger.settleExecution(taskId, execution.id, 'succeeded', this.now(), undefined, sessionId)
      }
    } catch {
      // A transport failure must not corrupt a running record; leave it.
      return false
    }
    return false
  }

  /** Connect (reuse or create) the execution session. */
  private async connectSession(task: TaskRecord): Promise<{ sessionId: string; fresh: boolean }> {
    if (task.sessionId !== undefined && task.sessionId !== '') {
      const row = await this.findSessionRow(task.sessionId)
      if (row === undefined) throw new Error(`pinned execution session not found: ${task.sessionId}`)
      if (row.running === true) throw new Error(`pinned execution session is busy: ${task.sessionId}`)
      return { sessionId: task.sessionId, fresh: false }
    }
    const workspaceId = await this.resolveWorkspaceId(task)
    const agentPreset = task.mode !== undefined && task.mode !== '' ? task.mode : undefined
    const created = await this.env.sessions.create(req({ workspaceId, agentPreset }))
    if (created?.result?.ok !== true || created.result.value?.sessionId === undefined) {
      throw new Error('failed to create the execution session')
    }
    return { sessionId: String(created.result.value.sessionId), fresh: true }
  }

  private async findSessionRow(sessionId: string): Promise<RunnerSessionRow | undefined> {
    const list = await this.env.sessions.list(req())
    return list?.result?.value?.items?.find(x => String(x.sessionId) === sessionId)
  }

  /** Resolve the workspace the run lands in: task pin, else the first in the registry. */
  private async resolveWorkspaceId(task: TaskRecord): Promise<string | undefined> {
    if (task.workspaceId !== undefined && task.workspaceId !== '') return task.workspaceId
    const ws = await this.env.workspace?.list?.(req())
    const items = ws?.result?.value?.items ?? []
    const first = items[0]
    return first === undefined ? undefined : String(first.workspaceId)
  }

  /**
   * Apply the task's pins. Everything runs before the prompt; any rejection
   * throws and fails the run without sending the task prompt.
   */
  private async applyPins(task: TaskRecord, sessionId: string, fresh: boolean): Promise<void> {
    // Agent preset: fresh sessions were created under it already; a reused
    // session must be recomposed (only legal while still blank).
    if (task.mode !== undefined && task.mode !== '' && !fresh) {
      const preset = this.env.presets
      if (preset === undefined) throw new Error(`this deployment does not support agent presets (task asks for ${task.mode})`)
      const res = await preset.select(req({ sessionId, agentPreset: task.mode }))
      if (res?.result?.ok !== true) throw new Error(`agent preset switch to ${task.mode} rejected`)
    }
    // Provider + model route.
    if (task.provider !== undefined && task.provider !== '' && task.model !== undefined && task.model !== '') {
      const res = await this.env.sessions.selectModel(req({
        sessionId,
        provider: task.provider,
        model: task.model,
        reasoningEffort: task.reasoningEffort,
      }))
      if (res?.result?.ok !== true) throw new Error(`model selection rejected: ${task.provider}/${task.model}`)
    } else if (task.provider !== undefined || task.model !== undefined) {
      // A provider without a model (or vice versa) is an incomplete pin: refuse.
      throw new Error('incomplete model pin: provider and model must be set together')
    }
    // Permission preset via the /permission slash command.
    if (task.permission !== undefined) {
      const res = await this.env.sessions.prompt(req({
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: `/permission ${task.permission}` }],
      }))
      if (res?.result?.ok !== true) throw new Error(`permission command rejected: /permission ${task.permission}`)
    }
    // Cosmetic rename; failures do not fail the run.
    await this.env.sessions.rename(req({ sessionId, title: task.title })).catch(() => { /* rename is cosmetic */ })
  }

  /** Send the task prompt (prompt text else title) through sessions.prompt. */
  private async sendPrompt(task: TaskRecord, sessionId: string): Promise<void> {
    const text = task.prompt.trim() !== '' ? task.prompt : task.title
    const res = await this.env.sessions.prompt(req({ sessionId, mode: 'queue', content: [{ type: 'text', text }] }))
    if (res?.result?.ok !== true) throw new Error('task prompt rejected by the session')
  }

  /**
   * Poll the session until its turn settles, then write the outcome. A
   * session that disappears is cancelled; one that stops with evidence it saw
   * the prompt is succeeded; a run that never settles within the timeout is
   * cancelled. Never throws — the ledger is the only exit.
   */
  private async settle(taskId: string, executionId: string, sessionId: string, startedAt: number): Promise<void> {
    const deadline = startedAt + this.settleTimeoutMs
    for (;;) {
      const status = await this.readStatus(sessionId, startedAt)
      if (status === 'gone') {
        this.ledger.settleExecution(taskId, executionId, 'cancelled', this.now(), 'execution session no longer exists', sessionId)
        return
      }
      if (status === 'stopped') {
        this.ledger.settleExecution(taskId, executionId, 'succeeded', this.now(), undefined, sessionId)
        return
      }
      if (this.now() > deadline) {
        this.ledger.settleExecution(taskId, executionId, 'cancelled', this.now(), 'execution timed out waiting for settlement', sessionId)
        return
      }
      await this.sleep(this.settlePollMs)
    }
  }

  /**
   * Read the session's settlement status. A session counts as `stopped` (turn
   * done) only when it is not running AND carries evidence it saw the prompt
   * (its list `updatedAt` advanced past the run start); without that evidence
   * (e.g. the prompt has not registered yet) it stays `running` so a fast
   * pre-running read cannot settle too early.
   */
  private async readStatus(sessionId: string, startedAt: number): Promise<SessionStatus> {
    const row = await this.findSessionRow(sessionId)
    if (row === undefined) return 'gone'
    if (row.running === true) return 'running'
    const sawPrompt = (row.updatedAt ?? 0) > startedAt
    return sawPrompt ? 'stopped' : 'running'
  }
}
