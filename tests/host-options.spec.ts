import { describe, expect, it } from 'vitest'
import { buildCatalogFromApi, type CatalogApiFace } from '../src/host-options.ts'

describe('buildCatalogFromApi', () => {
  it('projects llm models, workspaces, grouped sessions; archival excluded', async () => {
    const api: CatalogApiFace = {
      llm: { models: async () => ({ result: { ok: true, value: { groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] },
        { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT' }] },
      ] } } }) },
      workspace: { list: async () => ({ result: { ok: true, value: {
        items: [
          { workspaceId: 'w1', title: 'Proj A', path: '/a', sessionIds: ['s1', 's2'] },
        ],
        archivedSessionIds: ['s2'],
      } } }) },
      sessions: { list: async () => ({ result: { ok: true, value: { items: [
        { sessionId: 's1', cwd: '/a' },
        { sessionId: 's2', cwd: '/a' },
      ] } } }) },
      agentPresets: { list: async () => ({ result: { ok: true, value: { presets: [
        { id: 'standard', trust: 'system', isDefault: true },
        { id: 'minimal', trust: 'user', isDefault: false, name: 'Minimal' },
        { id: 'broken-one', trust: 'user', isDefault: false, broken: 'cannot mount' },
      ] } } }) },
    }

    const cat = await buildCatalogFromApi(api)
    expect(cat.providers.map(p => p.id)).toEqual(['deepseek', 'openai'])
    expect(cat.sessions.map(s => s.id)).toEqual(['s1'])
    expect(cat.projects[0].label).toBe('Proj A')
    expect(cat.projects[0].sessions.map(s => s.id)).toEqual(['s1'])
    // Modes: roster presets become dropdown options; broken ones excluded;
    // label prefers the published name and falls back to the id.
    expect(cat.modes).toEqual([
      { id: 'standard', label: 'standard' },
      { id: 'minimal', label: 'Minimal' },
    ])
  })

  it('prefers the real session title (projection) over the cwd basename', async () => {
    const api: CatalogApiFace = {
      workspace: { list: async () => ({ result: { ok: true, value: {
        items: [{ workspaceId: 'w1', title: 'P', path: '/p', sessionIds: ['s1', 's2'] }],
        archivedSessionIds: [],
      } } }) },
      sessions: { list: async () => ({ result: { ok: true, value: { items: [
        // s1 has a real title; s2 falls back to cwd basename
        { sessionId: 's1', cwd: '/p', projections: { values: { title: 'Build the calendar plugin' } } },
        { sessionId: 's2', cwd: '/p', projections: { values: {} } },
      ] } } }) },
    }
    const cat = await buildCatalogFromApi(api)
    const labels = cat.projects[0].sessions.map(s => s.id === 's1' ? s.label : '')
    // s1 shows the real title.
    expect(cat.projects[0].sessions[0].label).toBe('Build the calendar plugin')
    // s2 (no title) uses the cwd basename 'p'; because s1 already took a
    // distinct label, s2 keeps its basename.
    expect(cat.projects[0].sessions[1].label).toBe('p')
  })

  it('degrades to empty catalog when the catalog adapter is absent', async () => {
    const cat = await buildCatalogFromApi({})
    expect(cat.workspaces).toEqual([])
    expect(cat.providers).toEqual([])
    expect(cat.projects).toEqual([])
    expect(cat.modes).toEqual([])
  })
})
