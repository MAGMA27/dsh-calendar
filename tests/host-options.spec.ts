import { describe, expect, it } from 'vitest'
import { buildCatalogFromApi, type CatalogApiFace } from '../src/host-options.ts'

describe('buildCatalogFromApi', () => {
  it('projects llm models, workspaces, and grouped sessions; names are distinct per project', async () => {
    const api: CatalogApiFace = {
      llm: { models: async () => ({ result: { ok: true, value: { groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }, { id: 'reason', name: 'Reasoner' }] },
        { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT' }] },
      ] } } }) },
      workspace: { list: async () => ({ result: { ok: true, value: {
        items: [
          { workspaceId: 'w1', title: 'Proj A', path: '/a', sessionIds: ['s1', 's2'] },
          { workspaceId: 'w2', title: 'Proj B', path: '/b', sessionIds: ['s3', 's4'] },
        ],
        archivedSessionIds: ['s2', 's4'],
      } } }) },
      sessions: { list: async () => ({ result: { ok: true, value: { items: [
        { sessionId: 's1', cwd: '/a' },
        { sessionId: 's2', cwd: '/a' },
        { sessionId: 's3', cwd: '/b' },
        { sessionId: 's4', cwd: '/b' },
      ] } } }) },
    }

    const cat = await buildCatalogFromApi(api)
    expect(cat.providers.map(p => p.id)).toEqual(['deepseek', 'openai'])
    expect(cat.modelsByProvider['deepseek'].map(m => m.id)).toEqual(['chat', 'reason'])

    // Archived sessions (s2, s4) are excluded.
    expect(cat.sessions.map(s => s.id)).toEqual(['s1', 's3'])

    // Grouped under projects, one session each after archiving.
    expect(cat.projects.length).toBe(2)
    expect(cat.projects[0].label).toBe('Proj A')
    expect(cat.projects[0].sessions.map(s => s.id)).toEqual(['s1'])
    expect(cat.projects[1].sessions.map(s => s.id)).toEqual(['s3'])
  })

  it('disambiguates identical session names within one workspace by id suffix', async () => {
    const api: CatalogApiFace = {
      workspace: { list: async () => ({ result: { ok: true, value: {
        items: [{ workspaceId: 'w1', title: 'P', path: '/p', sessionIds: ['aaaaaa111', 'bbbbbb222'] }],
        archivedSessionIds: [],
      } } }) },
      sessions: { list: async () => ({ result: { ok: true, value: { items: [
        { sessionId: 'aaaaaa111', cwd: '/p' },
        { sessionId: 'bbbbbb222', cwd: '/p' },
      ] } } }) },
    }
    const cat = await buildCatalogFromApi(api)
    const labels = cat.projects[0].sessions.map(s => s.label)
    expect(labels[0]).not.toBe(labels[1])
    // First keeps plain name; second gets a suffix.
    expect(labels[0]).toBe('p')
    expect(labels[1]).toContain('p · ')
  })

  it('degrades to empty catalog when the ApiProxy is absent', async () => {
    const cat = await buildCatalogFromApi({})
    expect(cat.workspaces).toEqual([])
    expect(cat.providers).toEqual([])
    expect(cat.projects).toEqual([])
  })
})
