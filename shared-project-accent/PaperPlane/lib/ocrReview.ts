import type { LogEntry } from "@/types/logbook";

export type OcrRecord = Partial<Omit<LogEntry, "id" | "route">>;
export type ReviewRow = { number: number; entry: Omit<LogEntry, "id">; status: "pending" | "saved" | "discarded"; error?: string };

export function reviewEntry(record: OcrRecord): Omit<LogEntry, "id"> {
  const srcIcao = String(record.srcIcao ?? "").trim().toUpperCase();
  const destIcao = String(record.destIcao ?? "").trim().toUpperCase();
  const rawDate = String(record.date ?? "").trim();
  const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawDate);
  const date = usDate
    ? `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}`
    : rawDate;
  return {
    date,
    tailNumber: String(record.tailNumber ?? "").trim().toUpperCase(),
    srcIcao, destIcao,
    route: srcIcao && destIcao ? `${srcIcao} → ${destIcao}` : null,
    totalFlightTime: Number(record.totalFlightTime ?? 0),
    picTime: Number(record.picTime ?? 0),
    dualReceivedTime: Number(record.dualReceivedTime ?? 0),
    instrumentTime: Number(record.instrumentTime ?? 0),
    crossCountry: Boolean(record.crossCountry), night: Boolean(record.night), solo: Boolean(record.solo),
    dayLandings: Number(record.dayLandings ?? 0), nightLandings: Number(record.nightLandings ?? 0),
    remarks: record.remarks ?? null,
  };
}

export function reviewErrors(entry: Omit<LogEntry, "id">): string[] {
  const errors: string[] = [];
  const date = new Date(`${entry.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== entry.date) errors.push("Enter a real date (YYYY-MM-DD)");
  if (!entry.tailNumber.trim()) errors.push("Tail number is required");
  if (!/^[A-Z]{4}$/.test(entry.srcIcao)) errors.push("From must be a four-letter ICAO code");
  if (!/^[A-Z]{4}$/.test(entry.destIcao)) errors.push("To must be a four-letter ICAO code");
  for (const field of ["totalFlightTime", "picTime", "dualReceivedTime", "instrumentTime", "dayLandings", "nightLandings"] as const) {
    const value = entry[field];
    if (!Number.isFinite(value) || value < 0 || (field.endsWith("Landings") && !Number.isInteger(value))) errors.push(`${field} must be a nonnegative ${field.endsWith("Landings") ? "whole number" : "number"}`);
  }
  return errors;
}

export function duplicateKey(entry: Pick<LogEntry, "date" | "tailNumber" | "srcIcao" | "destIcao" | "totalFlightTime">): string {
  return [entry.date, entry.tailNumber.trim().toUpperCase(), entry.srcIcao.trim().toUpperCase(), entry.destIcao.trim().toUpperCase(), Number(entry.totalFlightTime)].join("|");
}

export async function saveReviewRows(rows: ReviewRow[], save: (entry: Omit<LogEntry, "id">) => Promise<unknown>, onUpdate: (row: ReviewRow) => void): Promise<{ saved: number; failed: number }> {
  let saved = 0;
  let failed = 0;
  for (const row of rows.filter(row => row.status === "pending")) {
    try {
      await save(row.entry);
      saved++;
      onUpdate({ ...row, status: "saved", error: undefined });
    } catch (cause) {
      failed++;
      onUpdate({ ...row, error: cause instanceof Error ? cause.message : "Could not save this row" });
    }
  }
  return { saved, failed };
}
