// Table export for offline analysis: CSV (RFC 4180 quoting) and JSON
// (array of row objects keyed by column key).
//
// Columns are [{key, label}]; rows are objects keyed by column key. Cells that
// are null/undefined export as empty CSV fields and are omitted from JSON rows,
// so optional columns (measured data, Monte Carlo) don't produce fake zeros.

export function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(columns, rows) {
  const header = columns.map(c => csvCell(c.label)).join(',');
  const lines = rows.map(row => columns.map(c => csvCell(row[c.key])).join(','));
  return [header, ...lines].join('\n') + '\n';
}

export function toJson(columns, rows) {
  const objects = rows.map(row => {
    const obj = {};
    columns.forEach(c => {
      if (row[c.key] != null) obj[c.key] = row[c.key];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2) + '\n';
}

export function downloadTable(format, baseName, columns, rows) {
  const isCsv = format === 'csv';
  const text = isCsv ? toCsv(columns, rows) : toJson(columns, rows);
  const blob = new Blob([text], { type: isCsv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
