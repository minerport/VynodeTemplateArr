import type {
  OverlayIconMapping,
  OverlayVariableSegment,
} from '@vynode/contracts';

import type { OverlayRenderContext } from './conditions.js';

const dateFields = new Set([
  'releaseDate',
  'nextEpisodeAirDate',
  'nextSeasonAirDate',
  'lastPlayed',
  'dateAdded',
]);

const months = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
const fullMonths = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const fullDays = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

export const formatOverlayDate = (
  value: string | Date,
  format = 'MMM DD'
): string | undefined => {
  const dateOnly =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00.000Z`)
      : new Date(value);
  if (Number.isNaN(dateOnly.getTime())) return undefined;
  const year = dateOnly.getUTCFullYear();
  const month = dateOnly.getUTCMonth() + 1;
  const day = dateOnly.getUTCDate();
  const monthShort = months[month - 1]!;
  const monthFull = fullMonths[month - 1]!;
  const dayShort = days[dateOnly.getUTCDay()]!;
  const dayFull = fullDays[dateOnly.getUTCDay()]!;
  const pad = (current: number) => String(current).padStart(2, '0');
  const values: Record<string, string> = {
    'YYYY-MM-DD': `${year}-${pad(month)}-${pad(day)}`,
    'YYYY/MM/DD': `${year}/${pad(month)}/${pad(day)}`,
    'DD-MM-YYYY': `${pad(day)}-${pad(month)}-${year}`,
    'DD/MM/YYYY': `${pad(day)}/${pad(month)}/${year}`,
    'MM/DD/YYYY': `${pad(month)}/${pad(day)}/${year}`,
    'DD/MM': `${pad(day)}/${pad(month)}`,
    'D/M': `${day}/${month}`,
    'MM/DD': `${pad(month)}/${pad(day)}`,
    'M/D': `${month}/${day}`,
    'DDD DD/MM': `${dayShort} ${pad(day)}/${pad(month)}`,
    'DDD D/M': `${dayShort} ${day}/${month}`,
    'DDD MM/DD': `${dayShort} ${pad(month)}/${pad(day)}`,
    'DDD M/D': `${dayShort} ${month}/${day}`,
    DDDD: dayFull,
    DDD: dayShort,
    'MMM DD': `${monthShort} ${pad(day)}`,
    'DD MMM': `${pad(day)} ${monthShort}`,
    'MMM DD, YYYY': `${monthShort} ${pad(day)}, ${year}`,
    'DD MMM YYYY': `${pad(day)} ${monthShort} ${year}`,
    'MMMM DD, YYYY': `${monthFull} ${pad(day)}, ${year}`,
    'DD MMMM YYYY': `${pad(day)} ${monthFull} ${year}`,
  };
  return values[format] ?? values['MMM DD'];
};

export const resolveVariableText = (
  segments: readonly OverlayVariableSegment[],
  context: OverlayRenderContext
): string | undefined => {
  let output = '';
  for (const segment of segments) {
    if (segment.type === 'text') {
      output += segment.value ?? '';
      continue;
    }
    if (!segment.field) return undefined;
    const value = context[segment.field];
    if (value === undefined || value === null || Array.isArray(value))
      return undefined;
    if (
      dateFields.has(segment.field) &&
      (typeof value === 'string' || value instanceof Date)
    ) {
      const formatted = formatOverlayDate(value, segment.format);
      if (formatted === undefined) return undefined;
      output += formatted;
    } else if (typeof value === 'number') {
      output +=
        segment.field === 'imdbRating'
          ? value.toFixed(1)
          : segment.field.includes('Score') ||
              segment.field.includes('Rating')
            ? String(Math.round(value))
            : String(value);
    } else {
      output += String(value);
    }
  }
  return output;
};

export const resolveMappedIcons = (
  value: string | number | readonly (string | number)[],
  savedMappings: readonly OverlayIconMapping[],
  currentMappings: readonly OverlayIconMapping[],
  maxIcons?: number
): readonly OverlayIconMapping[] => {
  const values = Array.isArray(value) ? value.map(String) : [String(value)];
  const find = (entries: readonly OverlayIconMapping[], current: string) =>
    entries.find(
      (mapping) =>
        mapping.value.toLocaleLowerCase('en-US') ===
        current.toLocaleLowerCase('en-US')
    );
  const resolved = values
    .map(
      (current) =>
        find(savedMappings, current) ?? find(currentMappings, current)
    )
    .filter((mapping): mapping is OverlayIconMapping => Boolean(mapping));
  return maxIcons && maxIcons > 0 ? resolved.slice(0, maxIcons) : resolved;
};
