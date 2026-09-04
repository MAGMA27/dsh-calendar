import { describe, expect, it } from 'vitest'
import { buildCatalogFromApi } from '../src/host-options.ts'
import { catalogApiFromRuntime, executionEnvFromRuntime, type CalendarHostRuntime } from '../src/host-runtime.ts'

function makeRuntime(): CalendarHostRuntime {
  return {
    sessionController: {
      list: async () => ({
        items: [
          {
            sessionId: 'session-focus',
            cwd: 'D:/Projects/calendar',
            blank: false,
            running: false,
            projections: { values: { title: 'Focus session', agentPreset: 'code' } },
          },
          { sessionId: 'session-archived', cwd: 'D:/Projects/archive' },
        ],
      }),
      create: async request => ({ sessionId: request.sessionId ?? 'session-created', agentPreset: request.agentPreset }),
      selectModel: async () => undefined,
      rename: async () => undefined,
      prompt: async () => undefined,
      resolveAgent: async () => ({ agent: { id: 'live-agent' } }),
      modelCatalog: async () => ({
        groups: [{ id: 'provider-a', name: 'Provider A', models: [{ id: 'model-a', name: 'Model A' }] }],
      }),
    },
    workspaceRegistry: {
      list: () => [{ id: 'workspace-a', title: 'Project A', path: 'D:/Projects/calendar', sessionIds: ['session-focus', 'session-archived'] }],
      archivedSessionIds: ['session-archived'],
    },
    agentPresets: {
      remoteExportList: async () => ({ presets: [{ id: 'code', name: 'Code' }] }),
      select: async () => 'ok',
    },
    agents: { get: () => undefined },
    commands: {
      execute: async (_agent, _line, _images, _signal) => ({ result: { kind: 'success', text: 'ok' } }),
    },
  }
}

describe('current DSH Host runtime adapter', () => {
  it('projects current service catalogs into the calendar catalog', async () => {
    const catalog = await buildCatalogFromApi(catalogApiFromRuntime(makeRuntime()))

    expect(catalog.workspaces).toEqual([{ id: 'workspace-a', label: 'Project A' }])
    expect(catalog.projects).toEqual([{
      id: 'workspace-a',
      label: 'Project A',
      sessions: [{ id: 'session-focus', label: 'Focus session' }],
    }])
    expect(catalog.providers).toEqual([{ id: 'provider-a', label: 'Provider A' }])
    expect(catalog.modelsByProvider).toEqual({ 'provider-a': [{ id: 'model-a', label: 'Model A' }] })
    expect(catalog.modes).toEqual([{ id: 'code', label: 'Code' }])
  })

  it('keeps the current four-argument command signature visible to the runner', async () => {
    const env = executionEnvFromRuntime(makeRuntime())
    const sessions = await env.sessions.list({ rpcId: 'test', payload: {} })
    expect(sessions.result?.value?.items).toEqual([{
      sessionId: 'session-focus',
      running: false,
      blank: false,
      agentPreset: 'code',
    }, { sessionId: 'session-archived' }])

    const execute = env.commands?.execute
    expect(execute?.length).toBe(4)
    const command = await execute?.({ id: 'live-agent' }, '/permission read-only', [], new AbortController().signal)
    expect(command).toEqual({ result: { kind: 'success', text: 'ok' } })
  })
})
