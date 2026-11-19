import { dayNumber, isValidDate } from './text';

export type PeriodPreset = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'custom';
export const PERIOD_PRESETS: readonly PeriodPreset[] = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth', 'custom'];

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
}

const dateOfDay = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);

function mondayOf(n: number): number {
  // 1970-01-01 was a Thursday (3 days after Monday).
  return n - ((((n + 3) % 7) + 7) % 7);
}

function monthStart(n: number, offset: number): number {
  const d = new Date(n * 86400000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1) / 86400000;
}

export function periodOf(preset: PeriodPreset, today: string, from?: string, to?: string): Period {
  const t = dayNumber(today);
  const week = (): Period => ({ preset: 'thisWeek', from: dateOfDay(mondayOf(t)), to: today });
  switch (preset) {
    case 'thisWeek':
      return week();
    case 'lastWeek': {
      const m = mondayOf(t);
      return { preset, from: dateOfDay(m - 7), to: dateOfDay(m - 1) };
    }
    case 'thisMonth':
      return { preset, from: dateOfDay(monthStart(t, 0)), to: today };
    case 'lastMonth':
      return { preset, from: dateOfDay(monthStart(t, -1)), to: dateOfDay(monthStart(t, 0) - 1) };
    default: {
      if (!from || !to || !isValidDate(from) || !isValidDate(to)) return week();
      let a = from;
      let b = to;
      if (a > b) [a, b] = [b, a];
      if (a > today) return week();
      if (b > today) b = today;
      return { preset: 'custom', from: a, to: b };
    }
  }
}

export function startDay(p: Period): string {
  return dateOfDay(dayNumber(p.from) - 1);
}

export function curveDays(p: Period): string[] {
  const s = dayNumber(p.from) - 1;
  const e = dayNumber(p.to);
  const span = e - s;
  const out: string[] = [];
  if (span <= 31) {
    for (let n = s; n <= e; n++) out.push(dateOfDay(n));
    return out;
  }
  for (let k = 0; k < 30; k++) out.push(dateOfDay(s + Math.round((k * span) / 29)));
  return out;
}
