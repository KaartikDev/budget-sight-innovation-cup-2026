"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { previewCsv, importCsv } from "@/lib/api/logbook";
import type { CsvPreview } from "@/lib/api/logbook";

export default function CsvImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => Promise<void> }) {
  const { user } = useAuth();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const selectFile = async (file?: File) => {
    setPreview(null); setMessage(""); setCsv("");
    if (!file) return;
    setFileName(file.name);
    if (file.size > 1_000_000) { setMessage("CSV files must be 1 MB or smaller."); return; }
    setCsv(await file.text());
  };

  const runPreview = async () => {
    if (!user || !csv) return;
    setBusy(true); setMessage("");
    try { setPreview(await previewCsv(csv, await user.getIdToken())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Preview failed"); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!user || !preview || preview.errors.length) return;
    setBusy(true); setMessage("");
    try {
      const result = await importCsv(csv, await user.getIdToken());
      await onImported();
      setMessage(`Imported ${result.imported} flights; skipped ${result.skippedDuplicates.length} duplicate candidates.`);
      setCsv(""); setPreview(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Import CSV">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 text-slate-200 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div><h2 className="text-xl font-semibold text-white">Import CSV</h2><p className="mt-1 text-sm text-slate-400">Preview is a dry run. Existing flight candidates are skipped when you confirm.</p></div>
        <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close import">✕</button>
      </div>
      <p className="mt-4 text-sm text-slate-400">Use the <a className="text-blue-400 underline" href="/CSV_FORMAT.md" target="_blank" rel="noreferrer">CSV format guide</a> or export your logbook as a template.</p>
      <label className="mt-4 block text-sm font-medium">CSV file
        <input type="file" accept=".csv,text/csv" onChange={event => selectFile(event.target.files?.[0])} className="mt-2 block w-full text-sm text-slate-300" />
      </label>
      {fileName && <p className="mt-2 text-xs text-slate-400">{fileName}</p>}
      <button disabled={!csv || busy} onClick={runPreview} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Working..." : "Preview (dry run)"}</button>
      {message && <p className="mt-4 text-sm" role="status">{message}</p>}
      {preview && <div className="mt-5 space-y-4">
        <p className="text-sm">{preview.rows.length} valid rows · {preview.importableCount} to import · {preview.duplicates.length} duplicate candidates · {preview.errors.length} errors</p>
        {(preview.errors.length > 0 || preview.duplicates.length > 0) && <div className="max-h-40 overflow-y-auto rounded border border-slate-700 p-3 text-sm">
          {preview.errors.map((issue, i) => <p className="text-red-300" key={`error-${i}`}>Row {issue.row}, {issue.field}: {issue.message}</p>)}
          {preview.duplicates.map((issue, i) => <p className="text-amber-300" key={`duplicate-${i}`}>Row {issue.row}: {issue.message}</p>)}
        </div>}
        <div className="max-h-64 overflow-auto rounded border border-slate-700">
          <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-800"><tr><th className="p-2">Row</th><th className="p-2">Date</th><th className="p-2">Aircraft</th><th className="p-2">Route</th><th className="p-2">Hours</th><th className="p-2">Status</th></tr></thead>
            <tbody>{preview.rows.map(row => <tr className="border-t border-slate-800" key={row.row}><td className="p-2">{row.row}</td><td className="p-2">{row.date}</td><td className="p-2">{row.tailNumber}</td><td className="p-2">{row.srcIcao} → {row.destIcao}</td><td className="p-2">{row.totalFlightTime}</td><td className="p-2">{preview.duplicates.some(issue => issue.row === row.row) ? "Skip duplicate" : "Ready"}</td></tr>)}</tbody>
          </table>
        </div>
        <button disabled={busy || preview.errors.length > 0 || preview.importableCount === 0} onClick={confirm} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Confirm import ({preview.importableCount})</button>
      </div>}
    </div>
  </div>;
}
