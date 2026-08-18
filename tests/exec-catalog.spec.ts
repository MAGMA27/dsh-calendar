// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildCatalog, buildCatalogAsync, EMPTY_CATALOG } from '../src/core/exec-catalog.ts'

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
