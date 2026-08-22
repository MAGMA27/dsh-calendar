// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { calendarClientController, initialState } from '../src/client/controller.ts'
import { MemorycalendarHostTransport } from '../src/client/host-api.ts'
import { TaskDetailPanel } from '../src/client/components/TaskDetailPanel.tsx'
import { CreateTaskModal } from '../src/client/components/CreateTaskModal.tsx'
import { ScheduleClearConfirm } from '../src/client/components/ScheduleClearConfirm.tsx'
import { RepeatDeleteConfirm } from '../src/client/components/RepeatDeleteConfirm.tsx'
import { MatrixPanel } from '../src/client/components/MatrixPanel.tsx'
import { AgendaPanel } from '../src/client/components/AgendaPanel.tsx'
import { MonthGrid } from '../src/client/components/MonthGrid.tsx'
import { TaskBlock } from '../src/client/components/TaskBlock.tsx'
import { WeekGrid } from '../src/client/components/WeekGrid.tsx'
import { ExecutionSettings, type ExecutionSettingsValue } from '../src/client/components/ExecutionSettings.tsx'
import type { calendarAction, calendarSnapshot } from '../src/protocol.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

function snapshotWith(task: TaskRecord): calendarSnapshot {
  return { schemaVersion: 1, revision: 1, tasks: [task], scheduler: { timeZone: 'Asia/Shanghai' } }
}

function makeTask(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1', title: 'Plan', description: '', prompt: '', startAt: 1000, endAt: 2000,
    urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
    createdAt: 0, updatedAt: 0, ...over,
  }
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter === undefined) throw new Error('input value setter unavailable')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Transport records dispatched actions and returns a stable snapshot. */
function recordTransport(initial: calendarSnapshot) {
  let snap = initial
  const dispatched: calendarAction[] = []
  const applier = (a: calendarAction): calendarSnapshot => { dispatched.push(a); return snap }
  return { transport: new MemorycalendarHostTransport(snap, applier), dispatched }
}

describe('TaskDetailPanel', () => {
  it('toggles a subtask and hides archive actions', async () => {
    const task = makeTask({ subtasks: [{ id: 's1', title: 'Step one', done: false }] })
    const { transport, dispatched } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={task} onClose={() => {}} />) })

    const checks = host.querySelectorAll('input[type=checkbox]')
    expect(checks.length).toBe(1)
    // Simulate a user click by dispatching a native click (React listens on click for checkboxes).
    await act(async () => { (checks[0] as HTMLInputElement).click() })
    expect(dispatched.some(a => a.kind === 'setSubtaskDone')).toBe(true)
    const footerButtons = [...host.querySelectorAll('[data-dsh-calendar-detail-footer] button')]
    expect(footerButtons.some(button => /归档|恢复|Archive|Restore/.test(button.textContent ?? ''))).toBe(false)
    const footerLabels = footerButtons.map(button => button.textContent?.trim())
    expect(footerLabels.indexOf('删除')).toBeLessThan(footerLabels.indexOf('立即执行'))

    await act(async () => { root.unmount(); host.remove() })
  })

  it('confirms before deleting a one-off task', async () => {
    const task = makeTask({ id: 'single', title: 'One-off task' })
    const { transport, dispatched } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    let closed = false
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={task} onClose={() => { closed = true }} />) })

    const deleteButton = [...host.querySelectorAll('[data-dsh-calendar-detail-footer] button')]
      .find(button => button.textContent === '删除' || button.textContent === 'Delete') as HTMLButtonElement | undefined
    expect(deleteButton).toBeTruthy()
    await act(async () => { deleteButton!.click() })
    expect(dispatched.some(action => action.kind === 'delete')).toBe(false)
    expect(host.querySelector('[data-dsh-calendar-confirm-dialog]')).toBeTruthy()
    expect(host.textContent).toContain('一次性任务')

    const cancel = [...host.querySelectorAll('[data-dsh-calendar-confirm-dialog] button')]
      .find(button => button.textContent === '取消' || button.textContent === 'Cancel') as HTMLButtonElement | undefined
    expect(cancel).toBeTruthy()
    await act(async () => { cancel!.click() })
    expect(host.querySelector('[data-dsh-calendar-confirm-dialog]')).toBeNull()
    expect(dispatched.some(action => action.kind === 'delete')).toBe(false)

    await act(async () => { deleteButton!.click() })
    const confirm = host.querySelector('[data-dsh-calendar-confirm-action]') as HTMLButtonElement | null
    expect(confirm).toBeTruthy()
    await act(async () => { confirm!.click() })
    expect(dispatched.some(action => action.kind === 'delete' && action.id === task.id)).toBe(true)
    expect(closed).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('keeps detail actions visible while execution records stay collapsible and bounded', async () => {
    const executions: TaskRecord['executions'] = Array.from({ length: 20 }, (_, i) => ({
      id: `run-${i}`,
      startedAt: i + 1,
      result: i === 0 ? 'failed' : 'succeeded',
      error: i === 0 ? 'timeout' : undefined,
    }))
    const task = makeTask({ executions })
    const { transport } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={task} onClose={() => {}} />) })

    const detail = host.querySelector('[data-dsh-calendar-detail]')
    expect(detail?.querySelector('[data-dsh-calendar-detail-body]')).toBeTruthy()
    const footer = detail?.querySelector('[data-dsh-calendar-detail-footer]')
    expect(footer).toBeTruthy()
    expect(footer?.textContent).toContain('保存')
    expect(footer?.querySelector('[data-dsh-calendar-detail-body]')).toBeNull()

    const executionsDisclosure = host.querySelector('details[data-dsh-calendar-disclosure="executions"]') as HTMLDetailsElement | null
    expect(executionsDisclosure?.open).toBe(true)
    expect(executionsDisclosure?.querySelector('[data-dsh-calendar-execution-records]')).toBeTruthy()
    expect(host.textContent).toContain('执行失败：timeout')
    const summary = executionsDisclosure?.querySelector('summary') as HTMLElement | null
    expect(summary).toBeTruthy()
    await act(async () => { summary?.click() })
    expect(executionsDisclosure?.open).toBe(false)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('edits a task start and duration, including a cross-day range', async () => {
    const start = new Date(2026, 7, 20, 9, 0).getTime()
    const end = new Date(2026, 7, 20, 10, 0).getTime()
    const { transport, dispatched } = recordTransport(snapshotWith(makeTask({ startAt: start, endAt: end })))
    const controller = new calendarClientController(transport, initialState(start, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={makeTask({ startAt: start, endAt: end })} onClose={() => {}} />) })

    const startDateInput = host.querySelector('#dsh-calendar-task-start-date') as HTMLInputElement
    const startTimeSelect = host.querySelector('#dsh-calendar-task-start-time') as HTMLSelectElement
    const durationInput = host.querySelector('#dsh-calendar-task-duration') as HTMLInputElement
    expect(startDateInput).toBeTruthy()
    expect(startTimeSelect).toBeTruthy()
    expect(durationInput).toBeTruthy()
    expect(startDateInput.type).toBe('date')
    expect(host.querySelector('[data-dsh-calendar-detail]')?.textContent).not.toContain('触发时间')
    expect(startTimeSelect.getAttribute('aria-label')).toBe('开始时间')
    expect(startTimeSelect.options).toHaveLength(96)
    expect([...startTimeSelect.options].some(option => option.value === '09:10')).toBe(false)
    expect(durationInput.step).toBe('15')
    const nextStartDate = '2026-08-27'
    const nextStartTime = '23:30'
    const duration = '120'
    await act(async () => {
      setInputValue(startDateInput, nextStartDate)
      startTimeSelect.value = nextStartTime
      startTimeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      setInputValue(durationInput, duration)
    })

    const save = [...host.querySelectorAll('button')].find(b => b.textContent === '保存' || b.textContent === 'Save')
    expect(save).toBeTruthy()
    await act(async () => { save!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    const update = dispatched.find(a => a.kind === 'update')
    expect(update?.kind).toBe('update')
    if (update?.kind === 'update') {
      const nextStart = new Date(`${nextStartDate}T${nextStartTime}`).getTime()
      expect(update.patch.startAt).toBe(nextStart)
      expect(update.patch.endAt).toBe(nextStart + Number(duration) * 60_000)
    }

    await act(async () => { root.unmount(); host.remove() })
  })

  it('snaps arbitrary detail duration to 15-minute steps and caps it at 24 hours', async () => {
    const start = new Date(2026, 7, 20, 9, 0).getTime()
    const end = new Date(2026, 7, 20, 10, 0).getTime()
    const { transport, dispatched } = recordTransport(snapshotWith(makeTask({ startAt: start, endAt: end })))
    const controller = new calendarClientController(transport, initialState(start, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={makeTask({ startAt: start, endAt: end })} onClose={() => {}} />) })

    const durationInput = host.querySelector('input#dsh-calendar-task-duration') as HTMLInputElement
    await act(async () => {
      durationInput.focus()
      setInputValue(durationInput, '20')
      durationInput.blur()
    })
    expect(durationInput.value).toBe('15')
    await act(async () => {
      durationInput.focus()
      setInputValue(durationInput, '1500')
      durationInput.blur()
    })
    expect(durationInput.value).toBe('1440')
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === '保存' || b.textContent === 'Save')
    await act(async () => { save!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    const update = dispatched.find(a => a.kind === 'update')
    expect(update?.kind).toBe('update')
    if (update?.kind === 'update') expect(update.patch.endAt).toBe(start + 24 * 60 * 60_000)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('rejects a provider without a model during save and keeps the panel open', async () => {
    const task = makeTask()
    const { transport, dispatched } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={task} onClose={() => {}} />) })

    const defaultInputs = host.querySelectorAll('input[placeholder="（默认）"]')
    expect(defaultInputs.length).toBeGreaterThanOrEqual(2)
    await act(async () => { setInputValue(defaultInputs[0] as HTMLInputElement, 'ark') })
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === '保存' || b.textContent === 'Save')
    expect(save).toBeTruthy()
    await act(async () => { save!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(dispatched).toHaveLength(0)
    expect(host.textContent).toContain('Provider 和模型必须同时填写')
    expect(host.querySelector('[data-dsh-calendar-detail]')).toBeTruthy()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('renders execution-target knobs when set (provider/model badges via exec settings)', async () => {
    const task = makeTask({ provider: 'deepseek', model: 'chat', workspaceId: 'w1', permission: 'workspace-write' })
    const { transport } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={task} onClose={() => {}} />) })
    // Execution settings selects should expose the pinned permission.
    const executionDisclosure = host.querySelector('details[data-dsh-calendar-disclosure="execution"]') as HTMLDetailsElement | null
    expect(executionDisclosure?.open).toBe(false)
    await act(async () => { (executionDisclosure?.querySelector('summary') as HTMLElement).click() })
    expect(executionDisclosure?.open).toBe(true)
    const permSelect = executionDisclosure?.querySelector('[data-dsh-calendar-exec-permission]') as HTMLSelectElement | null
    expect(permSelect).toBeTruthy()
    expect(permSelect?.value).toBe('workspace-write')
    await act(async () => { root.unmount(); host.remove() })
  })

  it('a repeat copy shows the series rule in its schedule section (consistent with the template)', async () => {
    const tpl = makeTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } } })
    const copy = makeTask({ id: 'c1', originTaskId: 'tpl' })
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [tpl, copy], scheduler: { timeZone: 'Asia/Shanghai' } }
    const { transport } = recordTransport(snap)
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={copy} onClose={() => {}} />) })

    // The schedule mode select is seeded from the series rule, not the copy's own (absent) schedule.
    const modeSelect = [...host.querySelectorAll('select')].find(s => (s as HTMLSelectElement).value === 'daily') as HTMLSelectElement | undefined
    expect(modeSelect).toBeTruthy()
    // The series summary + the series-scope hint are rendered.
    expect(host.textContent).toContain('触发（按时间段）')
    expect(host.textContent).toContain('整个重复系列')

    await act(async () => { root.unmount(); host.remove() })
  })

  it('clearing the schedule on a repeat copy stages a this-day-vs-all confirm (no direct dispatch)', async () => {
    const tpl = makeTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } } })
    const copy = makeTask({ id: 'c1', originTaskId: 'tpl', schedule: { enabled: true, dueAt: 5000 } })
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [tpl, copy], scheduler: { timeZone: 'Asia/Shanghai' } }
    const { transport, dispatched } = recordTransport(snap)
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={copy} onClose={() => {}} />) })

    const clearBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '清除定时' || b.textContent === 'Clear schedule') as HTMLButtonElement | undefined
    expect(clearBtn).toBeTruthy()
    await act(async () => { clearBtn!.click() })

    // The clear is staged, not dispatched: the user must pick day vs all.
    expect(controller.getSnapshot().pendingScheduleClear).toEqual({ taskId: 'c1' })
    expect(dispatched.some(a => a.kind === 'setSchedule' || a.kind === 'clearInstanceSchedule')).toBe(false)

    // Picking "this day" dispatches clearInstanceSchedule on the copy.
    await act(async () => { controller.confirmScheduleClearDay() })
    expect(dispatched.some(a => a.kind === 'clearInstanceSchedule' && a.id === 'c1')).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('offers this-day clearing on a repeat template too', async () => {
    const template = makeTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } } })
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [template], scheduler: { timeZone: 'Asia/Shanghai' } }
    const { transport, dispatched } = recordTransport(snap)
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={template} onClose={() => {}} />) })

    const clearBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '清除定时' || b.textContent === 'Clear schedule') as HTMLButtonElement | undefined
    expect(clearBtn).toBeTruthy()
    await act(async () => { clearBtn!.click() })
    expect(controller.getSnapshot().pendingScheduleClear).toEqual({ taskId: 'tpl' })

    await act(async () => { controller.confirmScheduleClearDay() })
    expect(dispatched.some(a => a.kind === 'clearInstanceSchedule' && a.id === 'tpl')).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('asks for repeat delete scope and dispatches instance vs series targets', async () => {
    const template = makeTask({ id: 'tpl', title: 'Template', schedule: { enabled: true, repeat: { kind: 'daily' } } })
    const copy = makeTask({ id: 'copy', title: 'Copy', originTaskId: 'tpl', schedule: { enabled: true, dueAt: 5000 } })
    const { transport, dispatched } = recordTransport({ schemaVersion: 1, revision: 1, tasks: [template, copy], scheduler: { timeZone: 'Asia/Shanghai' } })
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={copy} onClose={() => {}} />) })

    const deleteBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '删除' || b.textContent === 'Delete') as HTMLButtonElement | undefined
    expect(deleteBtn).toBeTruthy()
    await act(async () => { deleteBtn!.click() })
    expect(controller.getSnapshot().pendingRepeatDelete).toEqual({ taskId: 'copy' })

    const dialog = document.createElement('div'); document.body.appendChild(dialog)
    const dialogRoot = createRoot(dialog)
    await act(async () => { dialogRoot.render(<RepeatDeleteConfirm controller={controller} />) })
    expect(dialog.textContent).toContain('删除这一天')
    await act(async () => { controller.confirmRepeatDeleteThis() })
    expect(dispatched.some(a => a.kind === 'deleteInstance' && a.id === 'copy')).toBe(true)

    const p = controller.requestRepeatDelete('copy')
    await act(async () => { controller.confirmRepeatDeleteAll() })
    await expect(p).resolves.toBe('all')
    expect(controller.getSnapshot().pendingRepeatDelete).toBeUndefined()

    await act(async () => { root.unmount(); dialogRoot.unmount(); host.remove(); dialog.remove() })
  })

  it('shows the this-day option in the clear dialog for a repeat template', async () => {
    const template = makeTask({ id: 'tpl', title: 'Template', schedule: { enabled: true, repeat: { kind: 'daily' } } })
    const { transport } = recordTransport(snapshotWith(template))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const pending = controller.requestScheduleClear(template.id)
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ScheduleClearConfirm controller={controller} />) })

    expect(host.textContent).toContain('取消这一天')
    await act(async () => { controller.cancelScheduleClear() })
    await expect(pending).resolves.toBe('cancel')
    await act(async () => { root.unmount(); host.remove() })
  })

  it('"this day" is offered on a plain copy too and removes that day\'s copy', async () => {
    const tpl = makeTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily' } } })
    const copy = makeTask({ id: 'c1', originTaskId: 'tpl' }) // plain copy, no own schedule
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [tpl, copy], scheduler: { timeZone: 'Asia/Shanghai' } }
    const { transport, dispatched } = recordTransport(snap)
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={copy} onClose={() => {}} />) })

    const clearBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '清除定时' || b.textContent === 'Clear schedule') as HTMLButtonElement | undefined
    expect(clearBtn).toBeTruthy()
    await act(async () => { clearBtn!.click() })

    expect(controller.getSnapshot().pendingScheduleClear).toEqual({ taskId: 'c1' })
    await act(async () => { controller.confirmScheduleClearDay() })
    // No own schedule → the day's occurrence is removed.
    expect(dispatched.some(a => a.kind === 'delete' && a.id === 'c1')).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('CreateTaskModal', () => {
  it('uses the compact detail layout for a week drag-created task', async () => {
    const controller = new calendarClientController(
      new MemorycalendarHostTransport({ schemaVersion: 1, revision: 1, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } }),
      initialState(0, 0),
    )
    await controller.start()
    controller.setDraft({ start: 9 * 60 * 60_000, end: 10 * 60 * 60_000 })
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<CreateTaskModal controller={controller} onClose={() => {}} />) })

    const modal = host.querySelector('[data-dsh-calendar-create]')
    expect(modal).toBeTruthy()
    expect(modal?.querySelector('[data-dsh-calendar-create-body]')).toBeTruthy()
    expect(modal?.querySelectorAll('details')).toHaveLength(5)
    expect(modal?.querySelector('[data-dsh-calendar-disclosure="content"]')).toBeTruthy()
    expect(modal?.querySelector('[data-dsh-calendar-disclosure="execution"]')).toBeTruthy()
    expect(modal?.textContent).toContain('创建')
    expect([...modal?.querySelectorAll('button') ?? []].some(button => /关闭|Close/.test(button.textContent ?? ''))).toBe(false)
    expect([...modal?.querySelectorAll('button') ?? []].some(button => /取消|Cancel/.test(button.textContent ?? ''))).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('submits edited date, start time, and duration instead of the drag draft', async () => {
    const draftStart = new Date(2026, 7, 20, 9, 0).getTime()
    const draftEnd = new Date(2026, 7, 20, 10, 0).getTime()
    const { transport, dispatched } = recordTransport({ schemaVersion: 1, revision: 1, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } })
    const controller = new calendarClientController(transport, initialState(draftStart, 0))
    await controller.start()
    controller.setDraft({ start: draftStart, end: draftEnd })
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<CreateTaskModal controller={controller} onClose={() => {}} />) })

    const titleInput = host.querySelector('input[aria-label]') as HTMLInputElement
    const startDateInput = host.querySelector('#dsh-calendar-new-task-start-date') as HTMLInputElement
    const startTimeSelect = host.querySelector('#dsh-calendar-new-task-start-time') as HTMLSelectElement
    const durationInput = host.querySelector('#dsh-calendar-new-task-duration') as HTMLInputElement
    expect(titleInput).toBeTruthy()
    expect(startDateInput).toBeTruthy()
    expect(startTimeSelect).toBeTruthy()
    expect(durationInput).toBeTruthy()

    const nextStartDate = '2026-08-21'
    const nextStartTime = '10:15'
    const nextDuration = '90'
    await act(async () => {
      setInputValue(titleInput, 'Adjustable')
      setInputValue(startDateInput, nextStartDate)
      startTimeSelect.value = nextStartTime
      startTimeSelect.dispatchEvent(new Event('change', { bubbles: true }))
      setInputValue(durationInput, nextDuration)
    })

    const create = [...host.querySelectorAll('button')].find(b => b.textContent === '创建' || b.textContent === 'Create')
    expect(create).toBeTruthy()
    await act(async () => { create!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    const action = dispatched.find(a => a.kind === 'create')
    expect(action?.kind).toBe('create')
    if (action?.kind === 'create') {
      const nextStart = new Date(`${nextStartDate}T${nextStartTime}`).getTime()
      expect(action.input.startAt).toBe(nextStart)
      expect(action.input.endAt).toBe(nextStart + Number(nextDuration) * 60_000)
    }

    await act(async () => { root.unmount(); host.remove() })
  })

  it('renders new subtasks as compact checkable rows', async () => {
    const { transport } = recordTransport({ schemaVersion: 1, revision: 1, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } })
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    controller.setDraft({ start: 9 * 60 * 60_000, end: 10 * 60 * 60_000 })
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<CreateTaskModal controller={controller} onClose={() => {}} />) })

    const input = host.querySelector('[data-dsh-calendar-create-subtask-input]') as HTMLInputElement
    const add = host.querySelector('[data-dsh-calendar-create-subtask-add]') as HTMLButtonElement
    expect(input).toBeTruthy()
    expect(add).toBeTruthy()
    await act(async () => {
      setInputValue(input, 'Review the draft')
      add.click()
    })

    const row = host.querySelector('[data-dsh-calendar-create-subtask]')
    const checkbox = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    expect(row).toBeTruthy()
    expect(checkbox).toBeTruthy()
    expect(row?.querySelector('[class*=subtaskRemove]')).toBeTruthy()
    await act(async () => { checkbox?.click() })
    expect(checkbox?.checked).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('Calendar completion styling', () => {
  it('marks a completed week task block at the card level', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <TaskBlock
          task={makeTask({ done: true })}
          topPct={10}
          heightPct={10}
          leftPct={10}
          widthPct={80}
          onSelect={() => {}}
        />,
      )
    })

    expect(host.querySelector('[data-dsh-calendar-block][data-done]')).toBeTruthy()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('marks a completed month task chip', async () => {
    const done = makeTask({
      id: 'done-month-task',
      title: 'Completed month task',
      startAt: new Date().setHours(9, 0, 0, 0),
      endAt: new Date().setHours(10, 0, 0, 0),
      done: true,
    })
    const pending = makeTask({
      id: 'pending-month-task',
      title: 'Pending month task',
      startAt: done.startAt,
      endAt: done.endAt,
    })
    const snap: calendarSnapshot = {
      schemaVersion: 1,
      revision: 1,
      tasks: [done, pending],
      scheduler: { timeZone: 'Asia/Shanghai' },
    }
    const controller = new calendarClientController(new MemorycalendarHostTransport(snap), initialState(done.startAt, 0))
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MonthGrid controller={controller} />) })

    const doneChip = [...host.querySelectorAll('[data-dsh-calendar-month] [data-done]')]
      .find(node => node.textContent === done.title)
    expect(doneChip).toBeTruthy()
    expect(host.querySelector('[data-dsh-calendar-month] [data-done]')?.textContent).toBe(done.title)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('keeps short-task status metadata inside the first row', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const start = new Date(2026, 7, 20, 9, 0).getTime()
    await act(async () => {
      root.render(
        <TaskBlock
          task={makeTask({ startAt: start, endAt: start + 30 * 60_000, originTaskId: 'template' })}
          topPct={10}
          heightPct={3}
          leftPct={10}
          widthPct={80}
          onSelect={() => {}}
        />,
      )
    })

    const headerChildren = Array.from(host.querySelector('[class*=taskBlockHeader]')?.children ?? [])
    const titleIndex = headerChildren.findIndex(node => node.matches('[class*=taskBlockTitle]'))
    const signalIndex = headerChildren.findIndex(node => node.matches('[class*=taskBlockSignalSlot]'))
    expect(signalIndex).toBeGreaterThan(titleIndex)
    expect(host.querySelector('[class*=taskBlockHeader] [class*=taskBadgeCompact]')).toBeTruthy()
    expect(host.querySelector('[class*=taskBlockMeta]')).toBeNull()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('does not reserve marker space for a plain short task', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const start = new Date(2026, 7, 20, 9, 0).getTime()
    await act(async () => {
      root.render(
        <TaskBlock
          task={makeTask({ startAt: start, endAt: start + 30 * 60_000 })}
          topPct={10}
          heightPct={3}
          leftPct={10}
          widthPct={80}
          onSelect={() => {}}
        />,
      )
    })

    expect(host.querySelector('[class*=taskBlockSignalSlot]')).toBeNull()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('uses a spacious week block to show and toggle subtasks', async () => {
    const task = makeTask({
      startAt: new Date(2026, 7, 20, 9, 0).getTime(),
      endAt: new Date(2026, 7, 20, 11, 0).getTime(),
      originTaskId: 'template',
      subtasks: [{ id: 's1', title: 'First step', done: false }, { id: 's2', title: 'Second step', done: true }],
    })
    const toggled: Array<{ id: string; done: boolean }> = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <TaskBlock
          task={task}
          topPct={10}
          heightPct={12}
          leftPct={10}
          widthPct={80}
          onSelect={() => {}}
          onToggleSubtask={(_, id, done) => toggled.push({ id, done })}
        />,
      )
    })

    expect(host.querySelector('[data-dsh-calendar-task-body]')).toBeTruthy()
    expect(host.querySelector('[class*=taskBlockSignalSlot] [class*=taskBadgeCompact]')).toBeTruthy()
    expect(host.querySelector('[class*=taskBlockMeta]')?.textContent).not.toContain('↻')
    expect(host.querySelectorAll('[data-dsh-calendar-task-body] input[type="checkbox"]')).toHaveLength(2)
    const first = host.querySelector('[data-dsh-calendar-task-body] input[type="checkbox"]') as HTMLInputElement
    await act(async () => { first.click() })
    expect(toggled).toEqual([{ id: 's1', done: true }])

    await act(async () => { root.unmount(); host.remove() })
  })

  it('renders all month-day tasks and lets a crowded cell scroll internally', async () => {
    const start = new Date(2026, 7, 20, 9, 0).getTime()
    const tasks: TaskRecord[] = Array.from({ length: 7 }, (_, i) => makeTask({
      id: `month-task-${i}`,
      title: `Month task ${i}`,
      startAt: start + i * 900_000,
      endAt: start + (i + 1) * 900_000,
    }))
    const snap: calendarSnapshot = {
      schemaVersion: 1,
      revision: 1,
      tasks,
      scheduler: { timeZone: 'Asia/Shanghai' },
    }
    const controller = new calendarClientController(new MemorycalendarHostTransport(snap), initialState(start, 0))
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MonthGrid controller={controller} />) })

    const crowdedCell = [...host.querySelectorAll('[data-dsh-calendar-month] button')]
      .find(cell => cell.querySelector('[data-dsh-calendar-month-chip]')?.textContent === 'Month task 0')
    expect(crowdedCell).toBeTruthy()
    expect(crowdedCell?.querySelectorAll('[data-dsh-calendar-month-chip]')).toHaveLength(7)
    expect(crowdedCell?.querySelector('.monthMore')).toBeNull()

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('MatrixPanel', () => {
  it('sorts tasks in each quadrant by start time', async () => {
    const base = new Date()
    base.setHours(9, 0, 0, 0)
    const earlier = makeTask({
      id: 'matrix-earlier',
      title: 'Earlier task',
      startAt: base.getTime(),
      endAt: base.getTime() + 60 * 60_000,
    })
    const later = makeTask({
      id: 'matrix-later',
      title: 'Later task',
      startAt: base.getTime() + 6 * 60 * 60_000,
      endAt: base.getTime() + 7 * 60 * 60_000,
    })
    const controller = new calendarClientController(
      new MemorycalendarHostTransport({ schemaVersion: 1, revision: 1, tasks: [later, earlier], scheduler: { timeZone: 'Asia/Shanghai' } }),
      initialState(0, 0),
    )
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MatrixPanel controller={controller} />) })

    const labels = [...host.querySelectorAll('[data-dsh-calendar-matrix] [role="group"] [role="button"]')]
      .map(item => item.getAttribute('aria-label'))
    expect(labels).toEqual(['Earlier task', 'Later task'])

    await act(async () => { root.unmount(); host.remove() })
  })

  it('hides completed tasks from other dates but keeps today and overdue tasks', async () => {
    const day = (offset: number): number => {
      const d = new Date()
      d.setHours(9, 0, 0, 0)
      d.setDate(d.getDate() + offset)
      return d.getTime()
    }
    const oldDone = makeTask({ id: 'old-done', title: 'Done yesterday', startAt: day(-1), endAt: day(-1) + 60 * 60_000, done: true })
    const todayDone = makeTask({ id: 'today-done', title: 'Done today', startAt: day(0), endAt: day(0) + 60 * 60_000, done: true })
    const overdue = makeTask({ id: 'overdue', title: 'Still overdue', startAt: day(-2), endAt: day(-2) + 60 * 60_000 })
    const controller = new calendarClientController(
      new MemorycalendarHostTransport({ schemaVersion: 1, revision: 1, tasks: [oldDone, todayDone, overdue], scheduler: { timeZone: 'Asia/Shanghai' } }),
      initialState(0, 0),
    )
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MatrixPanel controller={controller} />) })

    const text = host.querySelector('[data-dsh-calendar-matrix]')?.textContent ?? ''
    expect(text).toContain(todayDone.title)
    expect(text).toContain(overdue.title)
    expect(text).not.toContain(oldDone.title)
    expect(host.querySelector('[data-dsh-calendar-matrix] [data-done]')).toBeTruthy()
    expect(text).toContain('已完成')

    await act(async () => { root.unmount(); host.remove() })
  })

  it('shows today’s completed repeat occurrence instead of the next unfinished copy', async () => {
    const day = (offset: number): number => {
      const d = new Date()
      d.setHours(9, 0, 0, 0)
      d.setDate(d.getDate() + offset)
      return d.getTime()
    }
    const template = makeTask({
      id: 'repeat-template',
      title: 'Daily review',
      startAt: day(0),
      endAt: day(0) + 60 * 60_000,
      done: true,
      schedule: { enabled: true, repeat: { kind: 'daily' } },
    })
    const doneCopy = makeTask({
      id: 'done-copy',
      title: 'Daily review',
      originTaskId: template.id,
      startAt: day(1),
      endAt: day(1) + 60 * 60_000,
      done: true,
    })
    const oldestUnfinished = makeTask({
      id: 'oldest-copy',
      title: 'Daily review',
      originTaskId: template.id,
      startAt: day(2),
      endAt: day(2) + 60 * 60_000,
    })
    const latestUnfinished = makeTask({
      id: 'latest-copy',
      title: 'Daily review',
      originTaskId: template.id,
      startAt: day(3),
      endAt: day(3) + 60 * 60_000,
    })
    const snap: calendarSnapshot = {
      schemaVersion: 1,
      revision: 1,
      tasks: [template, doneCopy, oldestUnfinished, latestUnfinished],
      scheduler: { timeZone: 'Asia/Shanghai' },
    }
    const controller = new calendarClientController(new MemorycalendarHostTransport(snap), initialState(0, 0))
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MatrixPanel controller={controller} />) })

    expect(host.textContent).toContain(new Date(template.startAt).toLocaleDateString())
    expect(host.textContent).not.toContain(new Date(oldestUnfinished.startAt).toLocaleDateString())
    expect(host.textContent).not.toContain(new Date(latestUnfinished.startAt).toLocaleDateString())
    expect(host.textContent).not.toContain(new Date(doneCopy.startAt).toLocaleDateString())
    expect(host.querySelector('[data-dsh-calendar-matrix] [data-done]')).toBeTruthy()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('marks an unfinished task from a previous date as overdue', async () => {
    const d = new Date()
    d.setHours(9, 0, 0, 0)
    d.setDate(d.getDate() - 1)
    const task = makeTask({ startAt: d.getTime(), endAt: d.getTime() + 60 * 60_000 })
    const controller = new calendarClientController(
      new MemorycalendarHostTransport(snapshotWith(task)),
      initialState(0, 0),
    )
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MatrixPanel controller={controller} />) })

    const item = host.querySelector('[data-dsh-calendar-matrix] [data-overdue]')
    expect(item).toBeTruthy()
    expect(item?.textContent).toContain('已过期')

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('AgendaPanel', () => {
  it('hides completed tasks from other dates but keeps today and overdue groups', async () => {
    const day = (offset: number): number => {
      const d = new Date()
      d.setHours(9, 0, 0, 0)
      d.setDate(d.getDate() + offset)
      return d.getTime()
    }
    const oldDone = makeTask({ id: 'agenda-old-done', title: 'Done yesterday', startAt: day(-1), endAt: day(-1) + 60 * 60_000, done: true })
    const todayDone = makeTask({ id: 'agenda-today-done', title: 'Done today', startAt: day(0), endAt: day(0) + 60 * 60_000, done: true })
    const overdue = makeTask({ id: 'agenda-overdue', title: 'Still overdue', startAt: day(-2), endAt: day(-2) + 60 * 60_000 })
    const controller = new calendarClientController(
      new MemorycalendarHostTransport({ schemaVersion: 1, revision: 1, tasks: [oldDone, todayDone, overdue], scheduler: { timeZone: 'Asia/Shanghai' } }),
      initialState(0, 0),
    )
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<AgendaPanel controller={controller} />) })

    const doneText = host.querySelector('[data-group="done"]')?.textContent ?? ''
    const overdueText = host.querySelector('[data-group="overdue"]')?.textContent ?? ''
    expect(doneText).toContain(todayDone.title)
    expect(doneText).not.toContain(oldDone.title)
    expect(overdueText).toContain(overdue.title)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('places the oldest unfinished repeat occurrence in today when it is today', async () => {
    const day = (offset: number): number => {
      const d = new Date()
      d.setHours(9, 0, 0, 0)
      d.setDate(d.getDate() + offset)
      return d.getTime()
    }
    const template = makeTask({
      id: 'agenda-template',
      title: 'Daily review',
      startAt: day(0),
      endAt: day(0) + 60 * 60_000,
      schedule: { enabled: true, repeat: { kind: 'daily' } },
    })
    const tomorrow = makeTask({
      id: 'agenda-tomorrow',
      title: 'Daily review',
      originTaskId: template.id,
      startAt: day(1),
      endAt: day(1) + 60 * 60_000,
    })
    const snap: calendarSnapshot = {
      schemaVersion: 1,
      revision: 1,
      tasks: [template, tomorrow],
      scheduler: { timeZone: 'Asia/Shanghai' },
    }
    const controller = new calendarClientController(new MemorycalendarHostTransport(snap), initialState(0, 0))
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<AgendaPanel controller={controller} />) })

    expect(host.querySelector('[data-group="today"]')?.textContent).toContain('Daily review')
    expect(host.querySelector('[data-group="upcoming"]')?.textContent).not.toContain('Daily review')

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('Direct task completion controls', () => {
  it('completes a week task from its inline checkbox without selecting it', async () => {
    const start = new Date(2026, 7, 20, 9, 0).getTime()
    const task = makeTask({ id: 'week-done', title: 'Week task', startAt: start, endAt: start + 60 * 60_000 })
    const { transport, dispatched } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(start, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    const checkbox = host.querySelector('[data-dsh-calendar-week] [data-dsh-calendar-done-toggle] input') as HTMLInputElement | null
    expect(checkbox).toBeTruthy()
    await act(async () => { checkbox?.click() })
    expect(dispatched).toContainEqual({ kind: 'setDone', id: 'week-done', done: true })
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('completes a matrix task from its inline checkbox without selecting it', async () => {
    const task = makeTask({ id: 'matrix-done', title: 'Matrix task' })
    const { transport, dispatched } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MatrixPanel controller={controller} />) })

    const checkbox = host.querySelector('[data-dsh-calendar-matrix] [data-dsh-calendar-done-toggle] input') as HTMLInputElement | null
    expect(checkbox).toBeTruthy()
    await act(async () => { checkbox?.click() })
    expect(dispatched).toContainEqual({ kind: 'setDone', id: 'matrix-done', done: true })
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('completes an agenda task from its inline checkbox without selecting it', async () => {
    const task = makeTask({ id: 'agenda-done', title: 'Agenda task' })
    const { transport, dispatched } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<AgendaPanel controller={controller} />) })

    const checkbox = host.querySelector('[data-dsh-calendar-agenda] [data-dsh-calendar-done-toggle] input') as HTMLInputElement | null
    expect(checkbox).toBeTruthy()
    await act(async () => { checkbox?.click() })
    expect(dispatched).toContainEqual({ kind: 'setDone', id: 'agenda-done', done: true })
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('ExecutionSettings', () => {
  it('emits permission change through onChange', async () => {
    const emitted: Partial<ExecutionSettingsValue>[] = []
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ExecutionSettings value={{}} onChange={(p) => emitted.push(p)} />) })
    const sel = host.querySelector('select') as HTMLSelectElement
    await act(async () => {
      sel.value = 'workspace-write'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(emitted.some(p => p.permission === 'workspace-write')).toBe(true)
    await act(async () => { root.unmount(); host.remove() })
  })
})
