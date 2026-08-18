/**
 * Host-side ExecutionSettings catalog: reads the live dsh runtime through the
 * host ApiProxy (LLM model catalog, workspaces, sessions) and projects it into
 * the same flat ExecutionCatalog the browser form renders as dropdowns.
 *
 * Serving from the Host keeps the data source authoritative and avoids the
 * browser reaching into runtime internals; the client fetches it over HTTP
 * like every other calender resource.
 */
// Type-only imports keep the ApiProxy shapes available without pulling the
// host-apiproxy value runtime into this bundle.
import type {
  ModelProviderGroup, SessionSummary, WorkspaceView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { buildCatalogAsync, type ExecutionCatalog } from './core/exec-catalog.ts'

/** The narrow ApiProxy faces the catalog needs (structural; extra fields on
 * real objects are fine). */
export interface CatalogApiFace {
  llm?: { models(request: { rpcId: unknown; payload: object }): Promise<{ result: { ok: boolean; value?: { groups?: readonly ModelProviderGroup[] } } }> }
  workspace?: { list(request: { rpcId: unknown; payload: object }): Promise<{ result: { ok: boolean; value?: { items?: ReadonlyArray<{ workspaceId: unknown; title: string; path?: string }> } } }> }
  sessions?: { list(request: { rpcId: unknown; payload: object }): Promise<{ result: { ok: boolean; value?: { items?: ReadonlyArray<{ sessionId: unknown; cwd?: string }> } } }> }
}

let rpcSeq = 0
function req(): { rpcId: unknown; payload: object } {
  return { rpcId: `calender-options-${rpcSeq++}`, payload: {} }
}

/** Build the flat catalog from the ApiProxy. Always resolves (never rejects). */
export async function buildCatalogFromApi(api: CatalogApiFace): Promise<ExecutionCatalog> {
  let groups: readonly ModelProviderGroup[] | undefined
  let wsItems: readonly WorkspaceView[] | undefined
  let ssItems: readonly SessionSummary[] | undefined

  try {
    const res = await api.llm?.models?.(req()) as { result?: { ok?: boolean; value?: { groups?: readonly ModelProviderGroup[] } } } | undefined
    if (res?.result?.ok === true && res.result.value !== undefined) groups = res.result.value.groups
  } catch { /* ignore */ }

  try {
    const res = await api.workspace?.list?.(req()) as { result?: { ok?: boolean; value?: { items?: readonly WorkspaceView[] } } } | undefined
    if (res?.result?.ok === true && res.result.value !== undefined) wsItems = res.result.value.items
  } catch { /* ignore */ }

  try {
    const res = await api.sessions?.list?.(req()) as { result?: { ok?: boolean; value?: { items?: readonly SessionSummary[] } } } | undefined
    if (res?.result?.ok === true && res.result.value !== undefined) ssItems = res.result.value.items
  } catch { /* ignore */ }

  return await buildCatalogAsync({
    workspaces: { items: (wsItems ?? []).map(w => ({ workspaceId: String(w.workspaceId), title: w.title, path: w.path })) },
    sessions: {
      ids: (ssItems ?? []).map(s => String(s.sessionId)),
      byId: Object.fromEntries((ssItems ?? []).map(s => [String(s.sessionId), { id: String(s.sessionId), displayTitle: s.cwd ?? String(s.sessionId) }])),
    },
    models: async () => ({ groups: groups === undefined ? [] : [...groups] }),
  })
}
