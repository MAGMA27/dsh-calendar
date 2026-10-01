import { describe, expect, it, vi } from 'vitest'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { closeOnSessionNavigation } from '../src/client/navigation-watch.ts'

type Navigation = Pick<UiWorkspace, 'openSession' | 'openWorkspace' | 'startSession'>

function makeNavigation(calls: string[]): Navigation {
  return {
    openSession: target => { calls.push(`session:${String(target)}`) },
    openWorkspace: async workspaceId => { calls.push(`workspace:${String(workspaceId)}`) },
    startSession: workspaceId => { calls.push(`start:${String(workspaceId)}`) },
  }
}

describe('closeOnSessionNavigation', () => {
  it('closes before opening a session, including the already-current one', () => {
    const calls: string[] = []
    const workspace = makeNavigation(calls)
    const dispose = closeOnSessionNavigation(workspace, () => { calls.push('close') })

    workspace.openSession('session-a' as Parameters<Navigation['openSession']>[0])

    expect(calls).toEqual(['close', 'session:session-a'])
    dispose()
  })

  it('closes on workspace and new-session navigation', async () => {
    const calls: string[] = []
    const workspace = makeNavigation(calls)
    const dispose = closeOnSessionNavigation(workspace, () => { calls.push('close') })

    await workspace.openWorkspace('workspace-a' as Parameters<Navigation['openWorkspace']>[0])
    workspace.startSession('workspace-a' as Parameters<Navigation['startSession']>[0])

    expect(calls).toEqual(['close', 'workspace:workspace-a', 'close', 'start:workspace-a'])
    dispose()
  })

  it('restores the original navigation methods on dispose', () => {
    const calls: string[] = []
    const workspace = makeNavigation(calls)
    const original = workspace.openSession
    const close = vi.fn()
    const dispose = closeOnSessionNavigation(workspace, close)
    dispose()

    workspace.openSession('session-b' as Parameters<Navigation['openSession']>[0])

    expect(workspace.openSession).toBe(original)
    expect(close).not.toHaveBeenCalled()
    expect(calls).toEqual(['session:session-b'])
  })
})
