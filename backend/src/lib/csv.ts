import { Transform } from 'node:stream';

/**
 * Escapes one CSV field (RFC 4180): fields containing a comma, quote or newline are
 * wrapped in quotes, with inner quotes doubled. Text starting with = + - @ (or tab/CR) is
 * prefixed with ' so spreadsheet apps don't execute it as a formula ("CSV injection").
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(',') + '\r\n';
}

/**
 * [Node concept: streams] An object-mode Transform: rows (objects) go in, CSV text comes
 * out. The header is written before the first row (or at the end, if there are no rows).
 */
export function toCsvTransform<T>(
  columns: readonly { header: string; value: (row: T) => unknown }[],
) {
  let headerWritten = false;
  const header = csvRow(columns.map((c) => c.header));
  return new Transform({
    writableObjectMode: true,
    transform(row: T, _encoding, callback) {
      const prefix = headerWritten ? '' : header;
      headerWritten = true;
      callback(null, prefix + csvRow(columns.map((c) => c.value(row))));
    },
    flush(callback) {
      callback(null, headerWritten ? '' : header);
    },
  });
}
