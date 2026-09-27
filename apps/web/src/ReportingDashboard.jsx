import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const integer = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const WORKLOADS = ["code_generation", "debugging", "testing", "repo_exploration", "web_research", "artifact_generation", "environment_setup", "deployment_operations", "analysis_planning", "other", "unknown"];
const OUTCOMES = ["completed", "partial_completion", "failed", "unknown"];

function titleCase(value) {
  return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortId(value) {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-5)}` : value;
}

function formatDate(value) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function duration(value) {
  if (value == null) return "—";
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function Stat({ label, value, note }) {
  return <article className="report-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function Pill({ value, tone = value }) {
  return <span className={`report-pill ${tone || "unknown"}`}>{titleCase(value)}</span>;
}

function RowDetails({ item, retry, onRetry }) {
  const row = item.row;
  const observation = !Array.isArray(row.semantic?.observations) ? row.semantic?.observations : null;
  const retryDisabled = retry?.busy || item.semanticStatus === "ready" || ["queued", "running"].includes(retry?.state);
  const retryLabel = retry?.busy ? "Queueing…" : retry?.state ? titleCase(retry.state) : "Retry extraction";
  return <div className="report-row-details">
    <div className="report-detail-grid">
      <section><span>Identity</span><dl><dt>Turn</dt><dd>{row.identity.turnId}</dd><dt>Task</dt><dd>{row.identity.taskId}</dd><dt>Actor</dt><dd>{row.actor.name} · {row.actor.role}</dd><dt>Environment</dt><dd>{row.environment.platform} · {row.environment.architecture}</dd></dl></section>
      <section><span>Execution</span><dl><dt>Runtime</dt><dd>{titleCase(row.thread.runtimeStatus)}</dd><dt>Duration</dt><dd>{duration(row.timing.durationMs)}</dd><dt>Commands</dt><dd>{integer.format(row.metrics.commandCount)}</dd><dt>Validation</dt><dd>{titleCase(row.semantic.outcome.validation)}</dd><dt>Secondary workload</dt><dd>{row.semantic.workload.secondary.map(titleCase).join(", ") || "None"}</dd></dl></section>
      <section><span>Repository impact</span><dl><dt>Repository</dt><dd>{row.repository.name || "No repository"}</dd><dt>Branch</dt><dd>{row.repository.branchAfter || row.repository.branchBefore || "—"}</dd><dt>Lines</dt><dd><b className="added">+{integer.format(row.metrics.linesAdded)}</b> <b className="deleted">−{integer.format(row.metrics.linesDeleted)}</b></dd><dt>Deliverables</dt><dd>{row.metrics.deliverablePaths.length || "None"}</dd></dl></section>
    </div>
    <div className="report-observations"><span>Most repeated tool-call intent</span><div className="report-intent-answer"><Pill value={observation?.mostRepeatedToolIntent || "unknown"} tone="workload" /><strong>{integer.format(observation?.toolCallCount || 0)} matching call{observation?.toolCallCount === 1 ? "" : "s"}</strong><small>{observation?.isRepeated ? "Repeated during this turn" : "No repeated intent"} · {titleCase(observation?.confidence || "low")} confidence</small></div></div>
    <div className="report-retry-extraction">
      <div><span>Feature extraction</span><small>Retry is available when semantic extraction is pending or failed.</small></div>
      <button onClick={onRetry} disabled={retryDisabled}>{retryLabel}</button>
      {retry?.error && <p>{retry.error}</p>}
      {!retry?.error && retry?.state && <p>Extraction retry is {titleCase(retry.state).toLowerCase()}.</p>}
    </div>
    <details className="report-json"><summary>View normalized row JSON</summary><pre>{JSON.stringify(row, null, 2)}</pre></details>
  </div>;
}

export default function ReportingDashboard({ tasks = [] }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [workload, setWorkload] = useState("");
  const [outcome, setOutcome] = useState("");
  const [semanticStatus, setSemanticStatus] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [retryByTurn, setRetryByTurn] = useState({});

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async ({ cursor = null, append = false } = {}) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search) params.set("q", search);
      if (workload) params.set("workload", workload);
      if (outcome) params.set("outcome", outcome);
      if (semanticStatus) params.set("semanticStatus", semanticStatus);
      if (cursor) params.set("cursor", cursor);
      const data = await api(`/admin/reporting/turns?${params}`);
      setRows((current) => append ? [...current, ...data.rows] : data.rows);
      setNextCursor(data.nextCursor);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, workload, outcome, semanticStatus]);

  useEffect(() => { load(); }, [load]);

  const toggleRow = useCallback((item) => {
    const turnId = item.row.identity.turnId;
    if (expanded === turnId) return setExpanded(null);
    setExpanded(turnId);
  }, [expanded]);

  const retryExtraction = useCallback(async (turnId) => {
    setRetryByTurn((current) => ({ ...current, [turnId]: { busy: true, error: "", state: null } }));
    try {
      const data = await api(`/admin/reporting/turns/${encodeURIComponent(turnId)}/retry`, { method: "POST" });
      setRetryByTurn((current) => ({ ...current, [turnId]: { busy: false, error: "", state: data.job.state } }));
    } catch (caught) {
      setRetryByTurn((current) => ({ ...current, [turnId]: { busy: false, error: caught.message, state: null } }));
    }
  }, []);

  const summary = useMemo(() => {
    const tokens = tasks.reduce((sum, task) => sum + (task.usage?.totalTokens || 0), 0);
    const cost = tasks.reduce((sum, task) => sum + (task.budget?.estimatedUsd || 0), 0);
    const completed = tasks.filter((task) => task.status === "idle_completed").length;
    return { tokens, cost, completed };
  }, [tasks]);

  const filtered = Boolean(search || workload || outcome || semanticStatus);
  return <main className="reporting-page">
    <header className="reporting-header">
      <div><div className="eyebrow">REPORTING.DB / CURRENT ROWS</div><h1>Turn intelligence</h1><p>Search and inspect privacy-safe features extracted from every completed Codex turn.</p></div>
      <div className="reporting-live"><span /> SQLite · local</div>
    </header>

    <section className="report-stats" aria-label="Loaded row summary">
      <Stat label="Reporting rows" value={integer.format(rows.length)} note={nextCursor ? "More rows available" : "Current result set"} />
      <Stat label="Estimated spend" value={money.format(summary.cost)} note={`Across ${integer.format(tasks.length)} stored thread${tasks.length === 1 ? "" : "s"}`} />
      <Stat label="Thread tokens" value={integer.format(summary.tokens)} note="Authoritative task totals" />
      <Stat label="Completed threads" value={integer.format(summary.completed)} note={`Of ${integer.format(tasks.length)} stored`} />
    </section>

    <section className="report-table-card">
      <div className="report-toolbar">
        <label className="report-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search turns, people, repos, models…" aria-label="Search reporting rows" />{query && <button onClick={() => setQuery("")} aria-label="Clear search">×</button>}</label>
        <div className="report-filters">
          <select value={workload} onChange={(event) => setWorkload(event.target.value)} aria-label="Filter by workload"><option value="">All workloads</option>{WORKLOADS.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Filter by outcome"><option value="">All outcomes</option>{OUTCOMES.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select>
          <select value={semanticStatus} onChange={(event) => setSemanticStatus(event.target.value)} aria-label="Filter by extraction status"><option value="">Any extraction</option><option value="ready">Ready</option><option value="pending">Pending</option><option value="failed">Failed</option></select>
          <button className="report-refresh" onClick={() => load()} disabled={loading} title="Refresh rows">↻</button>
        </div>
      </div>

      {error && <div className="report-error"><strong>Couldn’t load reporting rows.</strong><span>{error}</span><button onClick={() => load()}>Try again</button></div>}
      {!error && loading ? <div className="report-loading"><span /><p>Reading reporting.db…</p></div> : !error && rows.length === 0 ? <div className="report-empty"><div>⌁</div><h2>{filtered ? "No rows match these filters" : "No reporting rows yet"}</h2><p>{filtered ? "Try a broader search or clear one of the filters." : "Complete a Codex turn or run the feature backfill. New normalized rows will appear here."}</p>{filtered && <button onClick={() => { setQuery(""); setWorkload(""); setOutcome(""); setSemanticStatus(""); }}>Clear filters</button>}</div> : !error && <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Turn</th><th>Started</th><th>Workload</th><th>Repeated intent</th><th>Outcome</th><th className="number">Usage</th><th className="number">Cost</th><th className="number">Files</th><th>Extraction</th><th aria-label="Expand row" /></tr></thead><tbody>{rows.map((item) => {
        const row = item.row;
        const turnId = row.identity.turnId;
        const open = expanded === turnId;
        const intent = !Array.isArray(row.semantic?.observations) ? row.semantic?.observations?.mostRepeatedToolIntent : "unknown";
        return <Fragment key={item.rowId}><tr className={open ? "open" : ""} onClick={() => toggleRow(item)} tabIndex="0" onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleRow(item); } }} aria-expanded={open}>
          <td><strong>{row.thread.title}</strong><small title={row.identity.turnId}>{shortId(row.identity.turnId)} · {row.repository.name || "No repo"}</small></td>
          <td><span>{formatDate(row.timing.startedAt)}</span><small>{duration(row.timing.durationMs)}</small></td>
          <td><Pill value={row.semantic.workload.primary} tone="workload" /></td>
          <td><Pill value={intent || "none"} tone="workload" /></td>
          <td><Pill value={row.semantic.outcome.status} /></td>
          <td className="number"><strong>{row.usage.totalTokens == null ? "—" : integer.format(row.usage.totalTokens)}</strong><small>{integer.format(row.metrics.toolCount)} tools</small></td>
          <td className="number"><strong>{row.usage.estimatedCostMicros == null ? "—" : money.format(row.usage.estimatedCostMicros / 1_000_000)}</strong></td>
          <td className="number"><strong>{integer.format(row.metrics.changedFileCount)}</strong></td>
          <td><Pill value={item.semanticStatus} /></td>
          <td className="expand-cell"><span>{open ? "−" : "+"}</span></td>
        </tr>{open && <tr className="details-row"><td colSpan="10"><RowDetails item={item} retry={retryByTurn[turnId]} onRetry={() => retryExtraction(turnId)} /></td></tr>}</Fragment>;
      })}</tbody></table></div>}
      {!loading && !error && rows.length > 0 && <footer className="report-table-footer"><span>Showing {integer.format(rows.length)} row{rows.length === 1 ? "" : "s"}</span>{nextCursor ? <button onClick={() => load({ cursor: nextCursor, append: true })} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load 50 more"}</button> : <small>End of results</small>}</footer>}
    </section>
  </main>;
}
