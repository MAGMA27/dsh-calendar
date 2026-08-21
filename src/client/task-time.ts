export const QUARTER_HOUR_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const minutes = i * 15
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})

export const MIN_DURATION_MINUTES = 15
export const MAX_DURATION_MINUTES = 24 * 60

export interface StartTimeParts {
  date: string
  time: string
}

/** Format an epoch as a local date plus a fixed 15-minute time slot. */
export function toStartTimeParts(ms: number): StartTimeParts {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** Parse a local date and one of the fixed quarter-hour slots. */
export function fromStartTimeParts(date: string, time: string): number | undefined {
  if (date === '' || !QUARTER_HOUR_OPTIONS.includes(time)) return undefined
  const ms = new Date(`${date}T${time}`).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

/** Snap free-form duration input to the nearest valid quarter-hour range. */
export function snapDurationMinutes(value: string): string {
  if (value.trim() === '') return ''
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return ''
  const snapped = Math.round(minutes / MIN_DURATION_MINUTES) * MIN_DURATION_MINUTES
  return String(Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, snapped)))
}

export function durationMinutes(startAt: number, endAt: number): number {
  return Number(snapDurationMinutes(String(Math.round((endAt - startAt) / 900_000) * MIN_DURATION_MINUTES)))
}
