import { describe, expect, it } from 'vitest'
import { buildCatalogFromApi, type CatalogApiFace } from '../src/host-options.ts'

describe('buildCatalogFromApi', () => {
  it('projects llm models, workspaces, and sessions into the flat catalog', async () => {
    const api: CatalogApiFace = {
      llm: { models: async () => ({ result: { ok: true, value: { groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reasoner' }] },
        { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT' }] },
      ] } } }) },
      workspace: { list: async () => ({ result: { ok: true, value: { items: [
        { workspaceId: 'w1', title: 'Proj A', path: '/a' },
        { workspaceId: 'w2', title: 'Proj B', path: '/b' },
      ] } } }) },
      sessions: { list: async () => ({ result: { ok: true, value: { items: [
        { sessionId: 's1', cwd: '/a' },
        { sessionId: 's2', cwd: '/b' },
      ] } } }) },
    }

    const cat = await buildCatalogFromApi(api)
    expect(cat.providers.map(p => p.id)).toEqual(['deepseek', 'openai'])
    expect(cat.modelsByProvider['deepseek'].map(m => m.id)).toEqual(['chat', 'reason'])
    expect(cat.workspaces.map(w => w.label)).toEqual(['Proj A', 'Proj B'])
    expect(cat.sessions.map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('degrades to empty catalog when the ApiProxy is absent', async () => {
    const cat = await buildCatalogFromApi({})
    expect(cat.workspaces).toEqual([])
    expect(cat.providers).toEqual([])
  })
})
