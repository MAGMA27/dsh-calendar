import { useState } from 'react'
import type { ReactNode } from 'react'
import css from '../calendar.module.css'

export type DetailSectionKey = 'content' | 'time' | 'subtasks' | 'schedule' | 'execution' | 'executions'

interface DetailDisclosureProps {
  section: DetailSectionKey
  title: string
  meta?: string
  /** Controlled state for an existing task detail panel. */
  open?: boolean
  /** Initial state for a create form that owns the native disclosure state. */
  defaultOpen?: boolean
  onToggle?: (open: boolean) => void
  children: ReactNode
}

export function DetailDisclosure(props: DetailDisclosureProps): JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(props.defaultOpen ?? false)
  const controlled = props.open !== undefined
  const open = controlled ? props.open : uncontrolledOpen
  return (
    <details className={css.detailDisclosure} data-dsh-calendar-disclosure={props.section}
      open={open} onToggle={event => {
        const next = event.currentTarget.open
        if (!controlled) setUncontrolledOpen(next)
        props.onToggle?.(next)
      }}>
      <summary className={css.detailDisclosureSummary}>
        <span className={css.detailDisclosureTitle}>{props.title}</span>
        {props.meta !== undefined && <span className={css.detailDisclosureMeta}>{props.meta}</span>}
      </summary>
      <div className={css.detailDisclosureBody}>{props.children}</div>
    </details>
  )
}
