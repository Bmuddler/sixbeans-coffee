export const TIMEZONE = 'America/Los_Angeles';

function toDate(dateStr: string | Date): Date {
  if (typeof dateStr === 'string') {
    // Backend timestamps are naive Pacific time (no Z or offset).
    // Parse them as-is — do NOT append Z (that would misinterpret as UTC).
    // Replace T with space so JS Date() treats as local time.
    const cleaned = dateStr.endsWith('Z') ? dateStr : dateStr.replace('T', ' ');
    return new Date(cleaned);
  }
  return dateStr;
}

export function formatDateTime(dateStr: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return toDate(dateStr).toLocaleString('en-US', { ...options });
}

export function formatTime(dateStr: string | Date): string {
  return toDate(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDate(dateStr: string | Date): string {
  return toDate(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatShortDate(dateStr: string | Date): string {
  return toDate(dateStr).toLocaleDateString('en-US', {
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
