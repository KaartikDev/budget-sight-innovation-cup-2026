import type { FlightEntry } from "@prisma/client";

export const CSV_COLUMNS = [
  "date", "tailNumber", "srcIcao", "destIcao", "route", "totalFlightTime",
  "picTime", "dualReceivedTime", "crossCountry", "night", "solo",
  "instrumentTime", "dayLandings", "nightLandings", "remarks", "logbookUrl",
] as const;

export type CsvEntry = {
  date: Date; tailNumber: string; srcIcao: string; destIcao: string;
  route: string | null; totalFlightTime: number; picTime: number;
  dualReceivedTime: number; crossCountry: boolean; night: boolean;
  solo: boolean; instrumentTime: number; dayLandings: number;
  nightLandings: number; remarks: string | null; logbookURL: string | null;
};

export type CsvIssue = { row: number; field: string; message: string };

const escapeCell = (value: unknown) => {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function exportCsv(entries: FlightEntry[]): string {
  const lines = entries.map(entry => [
    entry.date.toISOString().slice(0, 10), entry.tailNumber, entry.srcIcao,
    entry.destIcao, entry.route, entry.totalFlightTime, entry.picTime,
    entry.dualReceivedTime, entry.crossCountry, entry.night, entry.solo,
    entry.instrumentTime, entry.dayLandings, entry.nightLandings,
    entry.remarks, entry.logbookURL,
  ].map(escapeCell).join(","));
  return [CSV_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}

// Parses quoted commas, quotes and line breaks while retaining physical row numbers.
function parseRows(csv: string): { rows: { row: number; cells: string[] }[]; error?: CsvIssue } {
  const rows: { row: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = "", quoted = false, closed = false;
  let line = 1, row = 1;
  const source = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else { cell += char; if (char === "\n") line++; }
    } else if (char === '"' && cell === "" && !closed) {
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      cells.push(cell); cell = ""; closed = false;
      if (char !== ",") {
        rows.push({ row, cells }); cells = [];
        if (char === "\r" && source[i + 1] === "\n") i++;
        line++; row = line;
      }
    } else if (closed || char === '"') {
      return { rows, error: { row, field: "csv", message: "Unexpected character after a quoted value" } };
    } else { cell += char; }
  }
  if (quoted) return { rows, error: { row, field: "csv", message: "Unclosed quoted value" } };
  if (cell !== "" || cells.length) rows.push({ row, cells: [...cells, cell] });
  return { rows };
}

export function parseCsv(csv: string): { entries: { row: number; entry: CsvEntry }[]; errors: CsvIssue[] } {
  const parsed = parseRows(csv);
  if (parsed.error) return { entries: [], errors: [parsed.error] };
  const [header, ...data] = parsed.rows;
  if (!header) return { entries: [], errors: [{ row: 1, field: "csv", message: "CSV is empty" }] };
  const names = header.cells.map(value => value.trim());
  const missing = CSV_COLUMNS.filter(column => !names.includes(column));
  if (missing.length || names.length !== CSV_COLUMNS.length || new Set(names).size !== names.length) {
    return { entries: [], errors: [{ row: header.row, field: "header", message: `Expected exactly these columns: ${CSV_COLUMNS.join(", ")}` }] };
  }
  const entries: { row: number; entry: CsvEntry }[] = [], errors: CsvIssue[] = [];
  if (data.length > 1000) return { entries, errors: [{ row: 1, field: "csv", message: "Maximum 1000 data rows per import" }] };
  for (const record of data) {
    if (record.cells.length === 1 && record.cells[0] === "") continue;
    if (record.cells.length !== names.length) {
      errors.push({ row: record.row, field: "csv", message: `Expected ${names.length} columns, found ${record.cells.length}` });
      continue;
    }
    const value = (field: string) => record.cells[names.indexOf(field)];
    const issue = (field: string, message: string) => errors.push({ row: record.row, field, message });
    const dateText = value("date");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? new Date(`${dateText}T00:00:00.000Z`) : new Date(NaN);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) issue("date", "Use a real date in YYYY-MM-DD format");
    const tailNumber = value("tailNumber").trim().toUpperCase();
    if (!tailNumber) issue("tailNumber", "Required");
    const srcIcao = value("srcIcao").trim().toUpperCase();
    const destIcao = value("destIcao").trim().toUpperCase();
    for (const [field, code] of [["srcIcao", srcIcao], ["destIcao", destIcao]]) {
      if (!/^[A-Z]{4}$/.test(code)) issue(field, "Use a four-letter ICAO code");
    }
    const number = (field: string, integer = false) => {
      const raw = value(field).trim();
      if (raw === "") return 0;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
        issue(field, integer ? "Use a nonnegative whole number" : "Use a nonnegative number");
        return 0;
      }
      return n;
    };
    const bool = (field: string) => {
      const raw = value(field).trim().toLowerCase();
      if (raw === "" || raw === "false") return false;
      if (raw === "true") return true;
      issue(field, "Use true or false"); return false;
    };
    const totalFlightTime = number("totalFlightTime"), picTime = number("picTime");
    const dualReceivedTime = number("dualReceivedTime"), instrumentTime = number("instrumentTime");
    const dayLandings = number("dayLandings", true), nightLandings = number("nightLandings", true);
    const crossCountry = bool("crossCountry"), night = bool("night"), solo = bool("solo");
    const logbookUrl = value("logbookUrl").trim();
    if (logbookUrl) {
      try { if (!/^https?:$/.test(new URL(logbookUrl).protocol)) throw new Error(); }
      catch { issue("logbookUrl", "Use an http or https URL"); }
    }
    if (!errors.some(error => error.row === record.row)) entries.push({ row: record.row, entry: {
      date, tailNumber, srcIcao, destIcao, route: value("route") || null,
      totalFlightTime, picTime, dualReceivedTime, crossCountry, night, solo,
      instrumentTime, dayLandings, nightLandings,
      remarks: value("remarks") || null, logbookURL: logbookUrl || null,
    } });
  }
  return { entries, errors };
}

export const duplicateKey = (entry: Pick<CsvEntry, "date" | "tailNumber" | "srcIcao" | "destIcao" | "totalFlightTime">) =>
  [entry.date.toISOString().slice(0, 10), entry.tailNumber.toUpperCase(), entry.srcIcao.toUpperCase(), entry.destIcao.toUpperCase(), String(entry.totalFlightTime)].join("|");
