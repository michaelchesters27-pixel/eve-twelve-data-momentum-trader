export const nowIso = () => new Date().toISOString();
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const integer = (value, fallback = 0) => Math.trunc(finite(value, fallback));
export const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};
export const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
export const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
export const normalizeTimestamp = value => {
  let timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return Date.now();
  if (timestamp < 10_000_000_000) timestamp *= 1000;
  return Math.trunc(timestamp);
};
export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function toCsv(rows) {
  if (!rows.length) return 'No data\n';
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return `${keys.map(csvEscape).join(',')}\n${rows.map(row => keys.map(key => csvEscape(row[key])).join(',')).join('\n')}\n`;
}
export function sessionForTimestamp(timestamp, timezone = 'Europe/London') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date(timestamp));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const minute = Number(map.hour) * 60 + Number(map.minute);
  if (minute >= 12 * 60 && minute < 17 * 60) return 'NEW_YORK_ACTIVE';
  if (minute >= 7 * 60 && minute < 12 * 60) return 'LONDON';
  if (minute >= 17 * 60 && minute < 21 * 60) return 'NEW_YORK_LATE';
  if (minute >= 0 && minute < 7 * 60) return 'ASIA_OVERNIGHT';
  return 'OFF_HOURS';
}
