/**
 * ExecutionSettings data sources: turn the live dsh runtime (workspaces list,
 * sessions list, LLM model catalog) into flat dropdown options for the
 * execution-settings form. Framework-free and tolerant: when the runtime
 * isn't available (tests, degraded boot) the loader returns an empty catalog
 * and the form falls back to free-text inputs.
 */

/** One selectable workspace. */
export interface ExecWorkspaceOption { id: string; label: string }
/** One selectable session. */
export interface ExecSessionOption { id: string; label: string }
/** One selectable provider. */
export interface ExecProviderOption { id: string; label: string }
/** One selectable model under a provider. */
export interface ExecModelOption { id: string; label: string }

/** One project (workspace) with its sessions, for grouped session selection. */
export interface ExecProjectOption {
  id: string
  label: string
  sessions: ExecSessionOption[]
}

/** Catalog the execution-settings form renders as <select>s. */
export interface ExecutionCatalog {
  workspaces: ExecWorkspaceOption[]
  /** Flat session list (archived excluded); the flat fallback. */
  sessions: ExecSessionOption[]
  /** Project-grouped sessions (project → sessions), archived excluded. */
  projects: ExecProjectOption[]
  providers: ExecProviderOption[]
  /** Models keyed by provider id. */
  modelsByProvider: Record<string, ExecModelOption[]>
}

export const EMPTY_CATALOG: ExecutionCatalog = {
  workspaces: [], sessions: [], projects: [], providers: [], modelsByProvider: {},
}

/** Minimal read face the loader needs from the live runtime; satisfies both
 * the reactive stores and plain API responses, so tests inject fakes. */
export interface ExecutionRuntimeFace {
  workspaces?: { items: Array<{ workspaceId: string; title: string; path?: string }> } | (() => { items: Array<{ workspaceId: string; title: string; path?: string }> })
  sessions?: { ids?: string[]; byId?: Record<string, { id: string; displayTitle: string; title?: string }> } | (() => { ids: string[]; byId: Record<string, { id: string; displayTitle: string; title?: string }> })
  models?: (() => Promise<{ groups?: Array<{ id: string; name: string; models: Array<{ id: string; name?: string }> }> }>) | (() => { groups: Array<{ id: string; name: string; models: Array<{ id: string; name?: string }> }> })
}

function unwrap<T>(v: T | (() => T)): T {
  return typeof v === 'function' ? (v as () => T)() : v
}

/** Build the catalog from the runtime face (returns EMPTY_CATALOG on gaps). */
export function buildCatalog(face: ExecutionRuntimeFace): ExecutionCatalog {
  const cat: ExecutionCatalog = { workspaces: [], sessions: [], projects: [], providers: [], modelsByProvider: {} }

  try {
    const ws = unwrap(face.workspaces)
    if (ws !== undefined) {
      cat.workspaces = ws.items.map(w => ({ id: w.workspaceId, label: w.title || w.path || w.workspaceId }))
    }
  } catch { /* ignore */ }

  try {
    const ss = unwrap(face.sessions)
    if (ss !== undefined) {
      const ids = ss.ids ?? Object.keys(ss.byId ?? {})
      cat.sessions = ids
        .map(id => { const s = ss.byId?.[id]; return s ?? { id, displayTitle: id } })
        .map(s => ({ id: s.id, label: s.displayTitle || s.title || s.id }))
    }
  } catch { /* ignore */ }

  try {
    const models = face.models?.()
    // Sync path
    if (!(models instanceof Promise) && models !== undefined) {
      fillModelGroups(cat, (models as { groups?: Array<{ id: string; name: string; models: Array<{ id: string; name?: string }> }> }).groups)
    }
  } catch { /* ignore */ }

  return cat
}

/** Async variant: resolves model groups (calls face.models() and awaits). */
export async function buildCatalogAsync(face: ExecutionRuntimeFace): Promise<ExecutionCatalog> {
  const cat = buildCatalog({ workspaces: face.workspaces, sessions: face.sessions })
  try {
    const res = await face.models?.()
    fillModelGroups(cat, res?.groups)
  } catch { /* ignore */ }
  return cat
}

function fillModelGroups(cat: ExecutionCatalog, groups: Array<{ id: string; name: string; models: Array<{ id: string; name?: string }> }> | undefined): void {
  if (groups === undefined) return
  cat.providers = groups.map(g => ({ id: g.id, label: g.name || g.id }))
  cat.modelsByProvider = {}
  for (const g of groups) {
    cat.modelsByProvider[g.id] = g.models.map(m => ({ id: m.id, label: m.name || m.id }))
  }
}