import { Request, Response } from "express";
import { prisma } from "../config";
import { duplicateKey, exportCsv, parseCsv } from "../csv";
import type { CsvIssue } from "../csv";

async function review(csv: string, userId: string) {
  const { entries, errors } = parseCsv(csv);
  const existing = await prisma.flightEntry.findMany({ where: { userId }, select: {
    date: true, tailNumber: true, srcIcao: true, destIcao: true, totalFlightTime: true,
  } });
  const keys = new Set(existing.map(entry => duplicateKey({ ...entry, totalFlightTime: Number(entry.totalFlightTime) })));
  const duplicates: CsvIssue[] = [];
  const newEntries = [];
  for (const item of entries) {
    const key = duplicateKey(item.entry);
    if (keys.has(key)) duplicates.push({ row: item.row, field: "duplicate", message: "A flight with the same date, aircraft, airports and total time already exists or appears earlier in this file" });
    else { keys.add(key); newEntries.push(item); }
  }
  return { entries, errors, duplicates, newEntries };
}

export const downloadCsv = async (req: Request, res: Response) => {
  const entries = await prisma.flightEntry.findMany({
    where: { userId: req.user!.id }, orderBy: [{ date: "desc" }, { id: "asc" }],
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="paperplane-logbook.csv"');
  res.send(exportCsv(entries));
};

export const previewCsv = async (req: Request, res: Response) => {
  const result = await review(req.body.csv, req.user!.id);
  res.json({
    rows: result.entries.map(({ row, entry }) => ({ row, ...entry, date: entry.date.toISOString().slice(0, 10) })),
    errors: result.errors, duplicates: result.duplicates,
    importableCount: result.newEntries.length,
  });
};

export const importCsv = async (req: Request, res: Response) => {
  const result = await review(req.body.csv, req.user!.id);
  if (result.errors.length) {
    res.status(400).json({ error: "Correct CSV errors before importing", errors: result.errors });
    return;
  }
  if (result.newEntries.length) {
    await prisma.flightEntry.createMany({ data: result.newEntries.map(({ entry }) => ({ ...entry, userId: req.user!.id })) });
  }
  res.status(201).json({ imported: result.newEntries.length, skippedDuplicates: result.duplicates });
};
