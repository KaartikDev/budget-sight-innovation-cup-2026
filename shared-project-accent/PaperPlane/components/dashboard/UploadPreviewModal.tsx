"use client";

import { useEffect, useState } from "react";
import type { LogEntry } from "@/types/logbook";
import { duplicateKey, reviewEntry, reviewErrors, saveReviewRows, type OcrRecord, type ReviewRow } from "@/lib/ocrReview";

interface Props {
  imageSrc: string | null;
  isUploading: boolean;
  records: OcrRecord[] | null;
  error: string | null;
  existingEntries: LogEntry[];
  onSave: (entry: Omit<LogEntry, "id">) => Promise<unknown>;
  onSaved: () => Promise<void>;
  onClose: () => void;
}

const numericFields = ["totalFlightTime", "picTime", "dualReceivedTime", "instrumentTime", "dayLandings", "nightLandings"] as const;
const textFields = ["date", "tailNumber", "srcIcao", "destIcao", "remarks"] as const;
const flags = ["crossCountry", "night", "solo"] as const;
const labels: Record<string, string> = { date: "Date", tailNumber: "Tail number", srcIcao: "From (ICAO)", destIcao: "To (ICAO)", totalFlightTime: "Total hours", picTime: "PIC hours", dualReceivedTime: "Dual hours", instrumentTime: "Instrument hours", dayLandings: "Day landings", nightLandings: "Night landings", crossCountry: "Cross country", night: "Night", solo: "Solo", remarks: "Remarks" };

export default function UploadPreviewModal({ imageSrc, isUploading, records, error, existingEntries, onSave, onSaved, onClose }: Props) {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (records) setRows(records.map<ReviewRow>((record, index) => ({ number: index + 1, entry: reviewEntry(record), status: "pending" })));
  }, [records]);

  const update = (number: number, patch: Partial<LogEntry>) => {
    setRows(previous => previous.map(row => {
      if (row.number !== number || row.status !== "pending") return row;
      const entry = { ...row.entry, ...patch };
      if (patch.srcIcao !== undefined || patch.destIcao !== undefined) entry.route = entry.srcIcao && entry.destIcao ? `${entry.srcIcao} → ${entry.destIcao}` : null;
      return { ...row, entry, error: undefined };
    }));
    setSaveMessage(null);
  };

  const discard = (number: number) => setRows(previous => previous.map<ReviewRow>(row => row.number === number ? { ...row, status: row.status === "discarded" ? "pending" : "discarded", error: undefined } : row));
  const pending = rows.filter(row => row.status === "pending");
  const invalid = pending.some(row => reviewErrors(row.entry).length > 0);
  const existingKeys = new Set(existingEntries.map(duplicateKey));

  const confirm = async () => {
    if (saving || invalid || !pending.length) return;
    setSaving(true);
    setSaveMessage(null);
    const { saved, failed } = await saveReviewRows(rows, onSave, updated => {
      setRows(previous => previous.map(current => current.number === updated.number ? updated : current));
    });
    let refreshFailed = false;
    if (saved) {
      try { await onSaved(); } catch { refreshFailed = true; }
    }
    if (refreshFailed) setSaveMessage("Rows were saved, but the logbook could not refresh. Reload the page to see them.");
    else if (failed) setSaveMessage(`${failed} row${failed === 1 ? "" : "s"} failed. Correct and retry the pending rows; saved rows will not be sent again.`);
    else if (saved) setSaveMessage(`${saved} row${saved === 1 ? "" : "s"} saved.`);
    setSaving(false);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Review OCR results" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-200 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 p-4">
          <div><h2 className="text-lg font-semibold text-white">{isUploading ? "Processing Upload" : "Review recognized flights"}</h2><p className="text-sm text-slate-400">No flight is saved until you confirm it.</p></div>
          <button type="button" onClick={onClose} disabled={saving || isUploading} aria-label="Close review" className="rounded px-3 py-1 hover:bg-slate-800 disabled:opacity-50">✕</button>
        </header>
        <div className="grid min-h-0 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.5fr)]">
          <div className="lg:sticky lg:top-0 lg:self-start"><img src={imageSrc ?? ""} alt="Uploaded logbook page" className="max-h-[70vh] w-full rounded border border-slate-700 bg-slate-950 object-contain" /></div>
          <div className="space-y-4">
            {isUploading && <p role="status">Analyzing logbook...</p>}
            {error && <p role="alert" className="rounded border border-red-600 p-3 text-red-300">{error}</p>}
            {!isUploading && !error && rows.length === 0 && <p>No flights were recognized. Try another image.</p>}
            {rows.map(row => {
              const errors = row.status === "pending" ? reviewErrors(row.entry) : [];
              const key = duplicateKey(row.entry);
              const repeated = rows.some(other => other.number < row.number && other.status !== "discarded" && duplicateKey(other.entry) === key);
              return <section key={row.number} aria-label={`Recognized row ${row.number}`} className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Row {row.number} <span className="text-sm font-normal text-slate-400">({row.status})</span></h3>{row.status !== "saved" && <button type="button" disabled={saving} onClick={() => discard(row.number)} className="text-sm text-blue-300 disabled:opacity-50">{row.status === "discarded" ? "Restore" : "Discard row"}</button>}</div>
                {row.status !== "discarded" && <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {textFields.map(field => <label key={field} className="text-xs text-slate-300">{labels[field]}<input aria-label={`Row ${row.number} ${labels[field]}`} type={field === "date" ? "date" : "text"} value={row.entry[field] ?? ""} disabled={saving || row.status === "saved"} onChange={event => update(row.number, { [field]: event.target.value })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-sm text-white disabled:opacity-60" /></label>)}
                    {numericFields.map(field => <label key={field} className="text-xs text-slate-300">{labels[field]}<input aria-label={`Row ${row.number} ${labels[field]}`} type="number" min="0" step={field.endsWith("Landings") ? "1" : "any"} value={row.entry[field]} disabled={saving || row.status === "saved"} onChange={event => update(row.number, { [field]: event.target.value === "" ? NaN : Number(event.target.value) })} className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-sm text-white disabled:opacity-60" /></label>)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4">{flags.map(field => <label key={field} className="text-sm"><input type="checkbox" checked={row.entry[field]} disabled={saving || row.status === "saved"} onChange={event => update(row.number, { [field]: event.target.checked })} className="mr-2" />{labels[field]}</label>)}</div>
                  {errors.map(message => <p key={message} className="mt-2 text-sm text-red-300">{message}</p>)}
                  {row.status === "pending" && (existingKeys.has(key) || repeated) && <p className="mt-2 text-sm text-amber-300">Possible duplicate {existingKeys.has(key) ? "in your logbook" : "on this page"}. Review before saving.</p>}
                  {row.error && <p role="alert" className="mt-2 text-sm text-red-300">Row {row.number}: {row.error}</p>}
                </>}
              </section>;
            })}
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 p-4">
          <span role="status" className="text-sm">{saveMessage ?? `${pending.length} pending, ${rows.filter(row => row.status === "saved").length} saved, ${rows.filter(row => row.status === "discarded").length} discarded`}</span>
          <div className="flex gap-3"><button data-testid="upload-modal-button" type="button" onClick={onClose} disabled={saving || isUploading} className="rounded border border-slate-600 px-4 py-2 disabled:opacity-50">Close</button><button type="button" onClick={confirm} disabled={saving || isUploading || invalid || pending.length === 0} className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">{saving ? "Saving..." : `Confirm ${pending.length} ${pending.length === 1 ? "flight" : "flights"}`}</button></div>
        </footer>
      </div>
    </div>
  );
}
