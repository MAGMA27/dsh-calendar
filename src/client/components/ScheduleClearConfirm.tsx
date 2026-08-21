/**
 * Confirmation when clearing the schedule of a repeat-series task (template or
 * bound copy): canceling must not silently nuke the whole series — the user may
 * only want to cancel ONE day's scheduled run. On a copy that still carries its
 * own trigger one-shot, "this day" clears just that copy's schedule (it stays
 * on the calendar as a plain task); on the template, it records the template
 * date as skipped while retaining the repeat rule. "All" cancels the whole
 * series. Rendered by CalendarView while the controller holds a pendingScheduleClear.
 */
import type { calendarClientController } from '../controller.ts'
import { isRepeatMember } from '../../core/repeat.ts'
import { t } from '../locales.ts'
import { RepeatScopeConfirm } from './RepeatScopeConfirm.tsx'

export function ScheduleClearConfirm({ controller }: { controller: calendarClientController }) {
  const snap = controller.getSnapshot()
  const pending = snap.pendingScheduleClear
  if (pending === undefined) return null
  const task = snap.snapshot.tasks.find(x => x.id === pending.taskId)
  // "This day" applies to any repeat member: a template records its own date
  // as skipped, a copy that still has its own trigger schedule loses that
  // schedule and stays as a plain task, and a plain copy is removed.
  const canClearDay = task !== undefined && isRepeatMember(task)

  return <RepeatScopeConfirm
    title={t('scheduleClear.title')}
    body={t('scheduleClear.body')}
    task={task}
    instanceLabel={t('scheduleClear.day')}
    seriesLabel={t('scheduleClear.all')}
    instanceEnabled={canClearDay}
    onInstance={() => controller.confirmScheduleClearDay()}
    onSeries={() => controller.confirmScheduleClearAll()}
    onCancel={() => controller.cancelScheduleClear()}
  />
}
