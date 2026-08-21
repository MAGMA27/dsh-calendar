/** Confirmation for deleting a repeat member: remove this occurrence only,
 * or remove the template and every still-bound occurrence in the series.
 */
import type { calendarClientController } from '../controller.ts'
import { t } from '../locales.ts'
import { RepeatScopeConfirm } from './RepeatScopeConfirm.tsx'

export function RepeatDeleteConfirm({ controller }: { controller: calendarClientController }): JSX.Element | null {
  const snap = controller.getSnapshot()
  const pending = snap.pendingRepeatDelete
  if (pending === undefined) return null
  const task = snap.snapshot.tasks.find(x => x.id === pending.taskId)

  return <RepeatScopeConfirm
    title={t('repeatDelete.title')}
    body={t('repeatDelete.body')}
    task={task}
    instanceLabel={t('repeatDelete.this')}
    seriesLabel={t('repeatDelete.all')}
    onInstance={() => controller.confirmRepeatDeleteThis()}
    onSeries={() => controller.confirmRepeatDeleteAll()}
    onCancel={() => controller.cancelRepeatDelete()}
  />
}
