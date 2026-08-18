/**
 * dsh-calender copy: zh-first dictionaries with an English fallback, selected
 * by the document language. Dependency-free so the DOM-injected entry row and
 * the standalone React tree share one tiny lookup.
 */

/** zh dictionary (key-set source of truth). */
export const zh = {
  'entry.label': '日历',
  'board.title': '日历',
  'board.close': '返回对话',
  'board.new': '新建任务',
  'board.search': '搜索任务…',
  'board.today': '今天',
  'view.week': '周',
  'view.month': '月',
  'view.matrix': '矩阵',
  'view.agenda': '议程',
  'weekday.0': '周一',
  'weekday.1': '周二',
  'weekday.2': '周三',
  'weekday.3': '周四',
  'weekday.4': '周五',
  'weekday.5': '周六',
  'weekday.6': '周日',
  'quadrant.do': '立即做',
  'quadrant.schedule': '排期',
  'quadrant.delegate': '委托',
  'quadrant.eliminate': '丢弃',
  'task.progress': '✓ {done}/{total}',
  'task.provider': '{provider}·{model}',
  'task.scheduled': '定时',
  'empty.noTasks': '这个时段没有任务，拖选或点击新建。',
  'status.loading': '加载中…',
  'status.error': '加载失败：{error}',
  'agenda.overdue': '已过期',
  'agenda.today': '今天',
  'agenda.upcoming': '近期',
  'agenda.empty': '暂无任务',
  'new.title': '标题',
  'new.titlePlaceholder': '要做什么？',
  'new.submit': '创建',
  'new.cancel': '取消',
  'new.start': '开始',
  'new.end': '结束',
  'quadrant.placeholder': '选择紧急/重要',
  'urgency.high': '紧急',
  'urgency.medium': '一般',
  'urgency.low': '不紧急',
  'importance.high': '重要',
  'importance.medium': '一般',
  'importance.low': '不重要',
} satisfies Record<string, string>

/** en dictionary, complete against the zh key set. */
export const en: Record<keyof typeof zh, string> = {
  'entry.label': 'Calendar',
  'board.title': 'Calendar',
  'board.close': 'Back to chat',
  'board.new': 'New Task',
  'board.search': 'Search tasks…',
  'board.today': 'Today',
  'view.week': 'Week',
  'view.month': 'Month',
  'view.matrix': 'Matrix',
  'view.agenda': 'Agenda',
  'weekday.0': 'Mon',
  'weekday.1': 'Tue',
  'weekday.2': 'Wed',
  'weekday.3': 'Thu',
  'weekday.4': 'Fri',
  'weekday.5': 'Sat',
  'weekday.6': 'Sun',
  'quadrant.do': 'Do now',
  'quadrant.schedule': 'Schedule',
  'quadrant.delegate': 'Delegate',
  'quadrant.eliminate': 'Drop',
  'task.progress': '{done}/{total}',
  'task.provider': '{provider}·{model}',
  'task.scheduled': 'scheduled',
  'empty.noTasks': 'No tasks here. Drag or click to create.',
  'status.loading': 'Loading…',
  'status.error': 'Failed to load: {error}',
  'agenda.overdue': 'Overdue',
  'agenda.today': 'Today',
  'agenda.upcoming': 'Upcoming',
  'agenda.empty': 'No tasks',
  'new.title': 'Title',
  'new.titlePlaceholder': 'What to do?',
  'new.submit': 'Create',
  'new.cancel': 'Cancel',
  'new.start': 'Start',
  'new.end': 'End',
  'quadrant.placeholder': 'Pick urgency/importance',
  'urgency.high': 'Urgent',
  'urgency.medium': 'Normal',
  'urgency.low': 'Not urgent',
  'importance.high': 'Important',
  'importance.medium': 'Normal',
  'importance.low': 'Not important',
}

/** The dictionary key union. */
export type CalenderKey = keyof typeof zh

/** Active dictionary, picked by the document language at call time. */
export function dictionary(): Record<CalenderKey, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? en : zh
}

/** Translate a key with optional {name} template params. */
export function t(key: CalenderKey, params?: Record<string, string | number>): string {
  let text: string = dictionary()[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}
