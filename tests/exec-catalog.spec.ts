// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  buildCatalog, buildCatalogAsync, EMPTY_CATALOG, overlaySessionTitles, uniquifyLabels,
} from '../src/core/exec-catalog.ts'
import type { ExecutionCatalog } from '../src/core/exec-catalog.ts'

describe('exec-catalog buildCatalog', () => {
  it('maps workspaces, sessions, and sync models into dropdown options', () => {
    const cat = buildCatalog({
      workspaces: { items: [{ workspaceId: 'w1', title: 'Project A' }, { workspaceId: 'w2', title: '', path: '/tmp/b' }] },
      sessions: { ids: ['s1', 's2'], byId: { s1: { id: 's1', displayTitle: 'Hello' }, s2: { id: 's2', displayTitle: 'World' } } },
      models: () => ({ groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reasoner' }] },
      ] }),
    })
    expect(cat.workspaces.map(w => w.label)).toEqual(['Project A', '/tmp/b'])
    expect(cat.sessions.map(s => s.label)).toEqual(['Hello', 'World'])
    expect(cat.providers.map(p => p.id)).toEqual(['deepseek'])
    expect(cat.modelsByProvider['deepseek'].map(m => m.id)).toEqual(['chat', 'reasoner'])
  })

  it('returns empty catalog when given nothing', () => {
    expect(buildCatalog({})).toEqual(EMPTY_CATALOG)
  })

  it('fills models asynchronously via buildCatalogAsync', async () => {
    const cat = await buildCatalogAsync({
      workspaces: { items: [{ workspaceId: 'w1', title: 'A' }] },
      models: async () => ({ groups: [{ id: 'o', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT' }] }] }),
    })
    expect(cat.providers.map(p => p.id)).toEqual(['o'])
    expect(cat.modelsByProvider['o'][0].id).toBe('gpt')
  })
})

describe('overlaySessionTitles', () => {
  const base: ExecutionCatalog = {
    workspaces: [{ id: 'w1', label: 'P' }],
    sessions: [{ id: 's1', label: 'p' }, { id: 's2', label: 'p · abc123' }],
    projects: [
      { id: 'w1', label: 'P', sessions: [{ id: 's1', label: 'p' }, { id: 's2', label: 'p · abc123' }] },
    ],
    providers: [],
    modelsByProvider: {},
  }

  it('overlays real durable titles and re-uniquifies', () => {
    const titles = new Map<string, string>([['s1', 'My Session'], ['s2', 'My Session']])
    const out = overlaySessionTitles(base, titles)
    // Both projects sessions show the durable title.
    expect(out.projects[0].sessions.map(s => s.label)).toEqual(['My Session', 'My Session · s2'])
    expect(out.sessions.map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('keeps original labels when no titles are given', () => {
    const out = overlaySessionTitles(base, undefined)
    expect(out.projects[0].sessions[0].label).toBe('p')
  })
})
