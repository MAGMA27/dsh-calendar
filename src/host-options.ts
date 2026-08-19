/**
 * Host-side ExecutionSettings catalog: reads the live dsh runtime through the
 * host ApiProxy (LLM model catalog, workspaces, sessions) and projects it into
 * the ExecutionCatalog the browser form renders as dropdowns.
 *
 * Sessions are grouped under their owning project (workspace); archived
 * sessions are excluded, and each session is labelled by its display name
 * (cwd basename) rather than the full folder path.
 *
 * Serving from the Host keeps the data source authoritative and avoids the
 * browser reaching into runtime internals; the client fetches it over HTTP
 * like every other calendar resource.
 */
// Type-only imports keep the ApiProxy shapes available without pulling the
// host-apiproxy value runtime into this bundle.
import type {
  ModelProviderGroup,
  AgentPresetEntry,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ExecutionCatalog } from './core/exec-catalog.ts'
import { uniquifyLabels } from './core/exec-catalog.ts'

/** A minimal structural workspace row (extra fields on real objects are fine). */
interface WsRow {
  workspaceId: unknown
  title: string
  path?: string
  sessionIds?: readonly unknown[]
}
/** A minimal structural session row. */
interface SsRow {
  sessionId: unknown
  cwd?: string
  /** Real session title from the per-session projection (when known). */
  projections?: { values?: { title?: string } }
}

/** The narrow ApiProxy faces the catalog needs. */
export interface CatalogApiFace {
  llm?: { models(request: { rpcId: unknown; payload: object }): Promise<{ result: { ok: boolean; value?: { groups?: readonly ModelProviderGroup[] } } }> }
  workspace?: { list(request: { rpcId: unknown; payload: object }): Promise<{ result: { ok: boolean; value?: { items?: readonly WsRow[]; archivedSessionIds?: readonly unknown[] } } }> }
  sessions?: { list(request: { rpcId: unknown; payload: object }): Promise<{ result: { ok: boolean; value?: { items?: readonly SsRow[] } } }> }
  // NOTE: the in-process ApiProxy domain object is `agentPresets` (plural),
  // even though the wire method path is `agentPreset.list` (singular).
  agentPresets?: { list(request: { rpcId: unknown; payload: object }): Promise<{ result: { ok: boolean; value?: { presets?: readonly AgentPresetEntry[] } } }> }
}

let rpcSeq = 0
function req(): { rpcId: unknown; payload: object } {
  return { rpcId: `calendar-options-${rpcSeq++}`, payload: {} }
}

/** A session's display name. Priority: the real durable title (from the
 * per-session projection, i.e. the DSH "session title"), then the last
 * non-empty path segment of its cwd (the project directory), then the
 * session id. */
function sessionNameOf(row: SsRow, sessionId: string): string {
  const title = row.projections?.values?.title?.trim()
  if (title !== undefined && title !== '') return title
  const cwd = row.cwd
  if (cwd !== undefined && cwd !== '') {
    const segments = cwd.replaceAll(/\\/g, '/').split('/').filter(Boolean)
    if (segments.length > 0) return segments[segments.length - 1]
  }
  return sessionId
}

/** Build the catalog from the ApiProxy: providers+models, workspaces, and
 * project-grouped sessions (archived sessions excluded). Resolves a
 * non-throwing catalog on every path. */
export async function buildCatalogFromApi(api: CatalogApiFace): Promise<ExecutionCatalog> {
  let groups: readonly ModelProviderGroup[] | undefined
  let wsItems: readonly WsRow[] | undefined
  let archived = new Set<string>()
  let ssItems: readonly SsRow[] | undefined

  try {
    const res = await api.llm?.models?.(req()) as { result?: { ok?: boolean; value?: { groups?: readonly ModelProviderGroup[] } } } | undefined
    if (res?.result?.ok === true && res.result.value !== undefined) groups = res.result.value.groups
  } catch { /* ignore */ }

  try {
    const res = await api.workspace?.list?.(req()) as { result?: { ok?: boolean; value?: { items?: readonly WsRow[]; archivedSessionIds?: readonly unknown[] } } } | undefined
    if (res?.result?.ok === true && res.result.value !== undefined) {
      wsItems = res.result.value.items
      archived = new Set((res.result.value.archivedSessionIds ?? []).map(String))
    }
  } catch { /* ignore */ }

  try {
    const res = await api.sessions?.list?.(req()) as { result?: { ok?: boolean; value?: { items?: readonly SsRow[] } } } | undefined
    if (res?.result?.ok === true && res.result.value !== undefined) ssItems = res.result.value.items
  } catch { /* ignore */ }

  // Agent presets (modes): the roster of preset ids a task run can pin. Broken
  // presets are excluded — offering one for selection would only defer the
  // failure to a run that names it.
  let presetItems: readonly AgentPresetEntry[] | undefined
  try {
    const res = await api.agentPresets?.list?.(req()) as { result?: { ok?: boolean; value?: { presets?: readonly AgentPresetEntry[] } } } | undefined
    if (res?.result?.ok === true && res.result.value !== undefined) presetItems = res.result.value.presets
  } catch { /* ignore */ }

  // session id → display name (basename of cwd)
  const nameById = new Map<string, string>()
  for (const s of ssItems ?? []) {
    const id = String(s.sessionId)
    nameById.set(id, sessionNameOf(s, id))
  }

  const catalog: ExecutionCatalog = { workspaces: [], sessions: [], projects: [], providers: [], modelsByProvider: {}, modes: [] }

  // projects group sessions by their owning workspace, skipping archived ids.
  for (const w of wsItems ?? []) {
    const id = String(w.workspaceId)
    const raw = (w.sessionIds ?? [])
      .map(String)
      .filter(sid => !archived.has(sid))
      .map(sid => ({ id: sid, label: nameById.get(sid) ?? sessionNameOf({ sessionId: sid }, sid) }))
    // Sessions in one project share the same cwd, so their cwd-basename labels
    // collide; disambiguate duplicates with a short id suffix.
    const sessions = uniquifyLabels(raw)
    catalog.projects.push({ id, label: w.title || w.path || id, sessions })
    catalog.workspaces.push({ id, label: w.title || w.path || id })
    catalog.sessions.push(...sessions)
  }

  // sessions not accounted to any workspace (ungrouped) — still listed flat.
  for (const s of ssItems ?? []) {
    const id = String(s.sessionId)
    if (archived.has(id)) continue
    if (catalog.sessions.some(x => x.id === id)) continue
    catalog.sessions.push({ id, label: nameById.get(id) ?? id })
  }

  if (groups !== undefined) {
    catalog.providers = groups.map(g => ({ id: g.id, label: g.name || g.id }))
    catalog.modelsByProvider = {}
    for (const g of groups) catalog.modelsByProvider[g.id] = g.models.map(m => ({ id: m.id, label: m.name || m.id }))
  }

  // Preset label: the display name the preset published, id as fallback.
  catalog.modes = (presetItems ?? [])
    .filter(p => p.broken === undefined)
    .map(p => ({ id: p.id, label: p.name ?? p.id }))

  return catalog
}