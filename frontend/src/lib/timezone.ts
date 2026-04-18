export const TIMEZONE = 'America/Los_Angeles';

function ensureUtc(dateStr: string): string {
  if (typeof dateStr === 'string' && !dateStr.endsWith('Z') && !dateStr.includes('+') && !dateStr.includes('-', 10)) {
    return dateStr + 'Z';
  }
  return dateStr;
}

function toDate(dateStr: string | Date): Date {
  if (typeof dateStr === 'string') return new Date(ensureUtc(dateStr));
  return dateStr;
}

export function formatDateTime(dateStr: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return toDate(dateStr).toLocaleString('en-US', { timeZone: TIMEZONE, ...options });
}

export function formatTime(dateStr: string | Date): string {
  return toDate(dateStr).toLocaleTimeString('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(dateStr: string | Date): string {
  return toDate(dateStr).toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatShortDate(dateStr: string | Date): string {
  return toDate(dateStr).toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    month: 'short',
    day: 'numeric',
  });
}

export function nowPacific(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

export function todayPacific(): string {
  const now = nowPacific();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
