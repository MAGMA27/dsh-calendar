/** Close the calendar when DSH's UI workspace service navigates to a session. */
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'

type SessionNavigation = Pick<UiWorkspace, 'openSession' | 'openWorkspace' | 'startSession'>

/** Wrap the public session-navigation actions and restore them on disposal. */
export function closeOnSessionNavigation(
  workspace: SessionNavigation,
  close: () => void,
): () => void {
  const originalOpenSession = workspace.openSession
  const originalOpenWorkspace = workspace.openWorkspace
  const originalStartSession = workspace.startSession

  workspace.openSession = target => {
    close()
    originalOpenSession.call(workspace, target)
  }
  workspace.openWorkspace = (workspaceId, beforeOpen) => {
    close()
    return originalOpenWorkspace.call(workspace, workspaceId, beforeOpen)
  }
  workspace.startSession = workspaceId => {
    close()
    originalStartSession.call(workspace, workspaceId)
  }

  return () => {
    workspace.openSession = originalOpenSession
    workspace.openWorkspace = originalOpenWorkspace
    workspace.startSession = originalStartSession
  }
}
