/**
 * Boundary adapter for the DSH 0.1.2 Host services.
 *
 * The calendar domain and runner keep a deliberately small, test-friendly
 * `{ rpcId, payload }` face. DSH no longer exposes the old `apiProxy`; the
 * current Host publishes direct services instead:
 * `sessionController`, `workspaceRegistry`, `agentPresets`, `agents`, and
 * `commands`. This module is the only place that translates those services to
 * the calendar faces, so the ledger and scheduler stay framework-free.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  type CatalogApiFace,
  type CatalogModelProviderGroup,
  type CatalogPresetEntry,
  type CatalogSessionRow,
  type CatalogWorkspaceRow,
} from './host-options.ts'
import {
  type HostExecutionEnv,
  type RunnerAgentsFace,
  type RunnerCommandExecution,
  type RunnerCommandsFace,
  type RunnerPresetsFace,
  type RunnerSessionRow,
  type RunnerSessionsFace,
  type RunnerWorkspaceFace,
} from './host-runner.ts'

interface CalendarSessionSummary {
  sessionId: unknown
  updatedAt?: number
  running?: boolean
  blank?: boolean
  cwd?: string
  projections?: { values?: Readonly<Record<string, unknown>> }
}

interface CalendarSessionControllerFace {
  list(request: { cursor?: string }, signal: AbortSignal): Promise<{ items: readonly CalendarSessionSummary[] }>
  create(request: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }): Promise<{ sessionId: unknown; agentPreset?: unknown }>
  selectModel(request: { sessionId: unknown; provider: string; model: string; reasoningEffort?: string }): Promise<unknown>
  rename(request: { sessionId: unknown; title: string }): Promise<unknown>
  prompt(request: {
    requestId: string
    sessionId: unknown
    mode: 'queue'
    content: readonly { type: 'text'; text: string }[]
  }, signal: AbortSignal): Promise<unknown>
  resolveAgent(sessionId: string): Promise<CalendarAgentResolution | undefined>
  modelCatalog(): Promise<{ groups: readonly CatalogModelProviderGroup[] }>
}

interface CalendarAgentResolution {
  agent?: unknown
  error?: unknown
}

interface CalendarWorkspace {
  id: unknown
  path?: string
  title?: string
  sessionIds?: readonly unknown[]
}

interface CalendarWorkspaceRegistryFace {
  list(): readonly CalendarWorkspace[]
  archivedSessionIds: readonly unknown[]
}

interface CalendarPresetRow {
  id: string
  name?: string
  broken?: string
}

interface CalendarPreset {
  id: string
  name?: string
  broken?: string
}

interface CalendarAgentPresetsFace {
  remoteExportList?: () => Promise<{ presets: readonly CalendarPresetRow[] }>
  list?: () => Promise<readonly CalendarPreset[]>
  select(agent: unknown, agentPreset: string): Promise<string>
}

interface CalendarAgentsFace {
  get(id: string): unknown
}

interface CalendarCommandsFace {
  execute(
    agent: unknown,
    line: string,
    images: readonly unknown[],
    signal: AbortSignal,
  ): Promise<RunnerCommandExecution | undefined>
}

interface CalendarRuntimeContext {
  sessionController: CalendarSessionControllerFace
  workspaceRegistry: CalendarWorkspaceRegistryFace
}

/** The current Host services needed by calendar routes, tools, and runner. */
export interface CalendarHostRuntime {
  sessionController: CalendarSessionControllerFace
  workspaceRegistry: CalendarWorkspaceRegistryFace
  agentPresets?: CalendarAgentPresetsFace
  agents?: CalendarAgentsFace
  commands?: CalendarCommandsFace
}

/** Read an optional service without making it a hard loader dependency. */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  try {
    return ctx.get(name) as unknown as T | undefined
  } catch {
    return undefined
  }
}

/** Create the adapter from the new direct-service Host context. */
export function calendarRuntimeFromContext(ctx: Context): CalendarHostRuntime {
  const required = ctx as unknown as CalendarRuntimeContext
  return {
    sessionController: required.sessionController,
    workspaceRegistry: required.workspaceRegistry,
    agentPresets: optionalService<CalendarAgentPresetsFace>(ctx, 'agentPresets'),
    agents: optionalService<CalendarAgentsFace>(ctx, 'agents'),
    commands: optionalService<CalendarCommandsFace>(ctx, 'commands'),
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return String(error)
}

function rejected(message: string): { result: { ok: false; error: { message: string } } } {
  return { result: { ok: false, error: { message } } }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function listSignal(): AbortSignal {
  return new AbortController().signal
}

async function sessionSummaries(runtime: CalendarHostRuntime): Promise<readonly CalendarSessionSummary[]> {
  const result = await runtime.sessionController.list({}, listSignal())
  return result.items
}

function catalogSessionOf(item: CalendarSessionSummary): CatalogSessionRow {
  const title = stringValue(item.projections?.values?.title)
  return {
    sessionId: item.sessionId,
    cwd: item.cwd,
    ...(title === undefined ? {} : { projections: { values: { title } } }),
  }
}

function runnerSessionOf(item: CalendarSessionSummary): RunnerSessionRow {
  const preset = stringValue(item.projections?.values?.agentPreset)
  return {
    sessionId: item.sessionId,
    ...(item.running === undefined ? {} : { running: item.running }),
    ...(item.blank === undefined ? {} : { blank: item.blank }),
    ...(preset === undefined ? {} : { agentPreset: preset }),
    ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
  }
}

async function presetRows(face: CalendarAgentPresetsFace): Promise<readonly CatalogPresetEntry[]> {
  if (face.remoteExportList !== undefined) {
    const roster = await face.remoteExportList()
    return roster.presets.map(row => ({ id: row.id, name: row.name, broken: row.broken }))
  }
  const rows = await face.list?.()
  return (rows ?? []).map(row => ({ id: row.id, name: row.name, broken: row.broken }))
}

/**
 * Expose the current model/workspace/session/preset services through the
 * catalog face used by the HTTP route and model-callable tool.
 */
export function catalogApiFromRuntime(runtime: CalendarHostRuntime): CatalogApiFace {
  const api: CatalogApiFace = {
    llm: {
      models: async () => {
        try {
          const catalog = await runtime.sessionController.modelCatalog()
          return { result: { ok: true, value: { groups: catalog.groups } } }
        } catch (error) {
          return rejected(`model catalog unavailable: ${messageOf(error)}`)
        }
      },
    },
    workspace: {
      list: async () => {
        try {
          const workspaces = runtime.workspaceRegistry.list()
          const items: CatalogWorkspaceRow[] = workspaces.map(workspace => ({
            workspaceId: workspace.id,
            title: workspace.title ?? '',
            path: workspace.path,
            sessionIds: workspace.sessionIds,
          }))
          return {
            result: {
              ok: true,
              value: {
                items,
                archivedSessionIds: [...runtime.workspaceRegistry.archivedSessionIds],
              },
            },
          }
        } catch (error) {
          return rejected(`workspace catalog unavailable: ${messageOf(error)}`)
        }
      },
    },
    sessions: {
      list: async () => {
        try {
          const items = await sessionSummaries(runtime)
          return { result: { ok: true, value: { items: items.map(catalogSessionOf) } } }
        } catch (error) {
          return rejected(`session catalog unavailable: ${messageOf(error)}`)
        }
      },
    },
  }

  if (runtime.agentPresets !== undefined) {
    api.agentPresets = {
      list: async () => {
        try {
          return { result: { ok: true, value: { presets: await presetRows(runtime.agentPresets as CalendarAgentPresetsFace) } } }
        } catch (error) {
          return rejected(`agent preset catalog unavailable: ${messageOf(error)}`)
        }
      },
    }
  }
  return api
}

function workspaceFace(runtime: CalendarHostRuntime): RunnerWorkspaceFace {
  return {
    list: async () => {
      try {
        return {
          result: {
            ok: true,
            value: { items: runtime.workspaceRegistry.list().map(workspace => ({ workspaceId: workspace.id })) },
          },
        }
      } catch (error) {
        return rejected(`workspace lookup failed: ${messageOf(error)}`)
      }
    },
  }
}

function sessionsFace(runtime: CalendarHostRuntime): RunnerSessionsFace {
  return {
    list: async () => {
      try {
        const items = await sessionSummaries(runtime)
        return { result: { ok: true, value: { items: items.map(runnerSessionOf) } } }
      } catch (error) {
        return rejected(`session lookup failed: ${messageOf(error)}`)
      }
    },
    create: async request => {
      try {
        const value = await runtime.sessionController.create({
          workspaceId: request.payload.workspaceId,
          sessionId: request.payload.sessionId,
          agentPreset: request.payload.agentPreset,
        })
        return {
          result: {
            ok: true,
            value: {
              sessionId: value.sessionId,
              agentPreset: stringValue(value.agentPreset),
            },
          },
        }
      } catch (error) {
        return rejected(`session creation failed: ${messageOf(error)}`)
      }
    },
    selectModel: async request => {
      try {
        await runtime.sessionController.selectModel({
          sessionId: request.payload.sessionId,
          provider: request.payload.provider,
          model: request.payload.model,
          reasoningEffort: request.payload.reasoningEffort,
        })
        return { result: { ok: true } }
      } catch (error) {
        return rejected(`model selection failed: ${messageOf(error)}`)
      }
    },
    rename: async request => {
      try {
        await runtime.sessionController.rename({
          sessionId: request.payload.sessionId,
          title: request.payload.title,
        })
        return { result: { ok: true } }
      } catch (error) {
        return rejected(`session rename failed: ${messageOf(error)}`)
      }
    },
    prompt: async request => {
      try {
        await runtime.sessionController.prompt({
          requestId: String(request.rpcId),
          sessionId: request.payload.sessionId,
          mode: request.payload.mode,
          content: request.payload.content,
        }, new AbortController().signal)
        return { result: { ok: true } }
      } catch (error) {
        return rejected(`session prompt failed: ${messageOf(error)}`)
      }
    },
  }
}

function presetsFace(runtime: CalendarHostRuntime): RunnerPresetsFace | undefined {
  const presets = runtime.agentPresets
  if (presets === undefined) return undefined
  return {
    select: async request => {
      try {
        const resolved = await runtime.sessionController.resolveAgent(String(request.payload.sessionId))
        const agent = resolved?.agent
        if (agent === undefined) {
          const reason = resolved?.error === undefined ? 'session agent unavailable' : messageOf(resolved.error)
          return rejected(reason)
        }
        await presets.select(agent, request.payload.agentPreset)
        return { result: { ok: true } }
      } catch (error) {
        return rejected(`agent preset selection failed: ${messageOf(error)}`)
      }
    },
  }
}

function agentsFace(runtime: CalendarHostRuntime): RunnerAgentsFace {
  return {
    get: id => runtime.agents?.get(id),
    resolve: async id => {
      try {
        const resolved = await runtime.sessionController.resolveAgent(id)
        return resolved?.agent
      } catch {
        return undefined
      }
    },
  }
}

function commandsFace(runtime: CalendarHostRuntime): RunnerCommandsFace | undefined {
  const commands = runtime.commands
  if (commands === undefined) return undefined
  const execute = async (
    agent: unknown,
    line: string,
    images: readonly unknown[],
    signal: AbortSignal,
  ): Promise<RunnerCommandExecution | undefined> => await commands.execute(agent, line, images, signal)
  return {
    // The current DSH command runtime has the four-argument shape. The
    // runner's public face also accepts the legacy three-argument test face.
    execute: execute as RunnerCommandsFace['execute'],
  }
}

/** Expose the current Host services through the runner's testable face. */
export function executionEnvFromRuntime(runtime: CalendarHostRuntime): HostExecutionEnv {
  const env: HostExecutionEnv = {
    sessions: sessionsFace(runtime),
    workspace: workspaceFace(runtime),
    agentPresets: presetsFace(runtime),
    agents: agentsFace(runtime),
    commands: commandsFace(runtime),
  }
  return env
}
