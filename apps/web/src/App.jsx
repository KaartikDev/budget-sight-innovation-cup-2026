import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { useLocation, useNavigate } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { MODELS, PRICING, TOOL_PRICING, planningTokenRange } from "@budgetsight/shared";
import { api } from "./api.js";
import { messageHref } from "./message-format.js";
import { eventItem, eventName, groupTimelineByPrompt, taskOutcome } from "./timeline.js";
import ReportingDashboard from "./ReportingDashboard.jsx";
import AccountsPage from "./AccountsPage.jsx";
import InsightsDashboard from "./InsightsDashboard.jsx";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const integer = new Intl.NumberFormat("en-US");

function displayText(value, fallback = "") {
  if (value == null || value === "") return fallback;
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (typeof value.text === "string") return value.text;
  if (typeof value.message === "string") return value.message;
  if (typeof value.type === "string") return value.type;
  try { return JSON.stringify(value); }
  catch { return fallback; }
}

function Icon({ name }) {
  const paths = {
    threads: "M4 5h16M4 12h16M4 19h10",
    plus: "M12 5v14M5 12h14",
    send: "m4 4 16 8-16 8 3-8-3-8Zm3 8h13",
    stop: "M7 7h10v10H7z",
    file: "M6 2h8l4 4v16H6zM14 2v5h5",
    repo: "M5 3h5l2 3h7v15H5z",
    download: "M12 3v12m0 0 5-5m-5 5-5-5M4 21h16",
    logout: "M10 17l5-5-5-5m5 5H3m12-9h5v18h-5",
    chevron: "m9 18 6-6-6-6",
    chart: "M4 19V9m6 10V5m6 14v-7m4 7H2",
    insights: "M3 17.5 8.2 12l3.6 3.4L21 5.5M16 5.5h5v5M4 21h16",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87m-3-11a4 4 0 0 1 0 7.75",
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

export function AppHeader({ user, activeView, onThreads, onInsights, onReporting, onAccounts, onLogout }) {
  return <header className="app-header">
    <button className="app-brand" onClick={onThreads} aria-label="Open threads">
      <span className="app-brand-copy"><img className="brand-logo" src="/budgetsight-logo.svg" alt="BudgetSight" /><small>Agent cost control</small></span>
    </button>
    <nav className="primary-nav" aria-label="Primary navigation">
      <button className={activeView === "threads" ? "active" : ""} onClick={onThreads}><Icon name="threads" />Threads</button>
      {user.role === "admin" && <button className={activeView === "insights" ? "active" : ""} onClick={onInsights}><Icon name="insights" />Insights</button>}
      {user.role === "admin" && <button className={activeView === "reporting" ? "active" : ""} onClick={onReporting}><Icon name="chart" />Reporting</button>}
      {user.role === "admin" && <button className={activeView === "accounts" ? "active" : ""} onClick={onAccounts}><Icon name="users" />Accounts</button>}
    </nav>
    <div className="header-account">
      <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
      <span className="header-account-copy"><strong>{user.name}</strong><small>{user.role}</small></span>
      <button className="icon-button" title="Log out" aria-label="Log out" onClick={onLogout}><Icon name="logout" /></button>
    </div>
  </header>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { onLogin((await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) })).user); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-intro">
      <div className="brand-lockup"><img className="brand-logo" src="/budgetsight-logo.svg" alt="BudgetSight" /></div>
      <div><div className="eyebrow">LOCAL AGENT OPERATIONS</div><h1>Know what every run costs.</h1><p>Track execution, budget exposure, and outcomes across your local Codex workspace.</p></div>
      <div className="login-signals"><span><i className="signal-dot healthy" />Budget enforcement</span><span><i className="signal-dot" />Turn intelligence</span><span><i className="signal-dot" />Audit-ready exports</span></div>
    </section>
    <form className="login-card" onSubmit={submit}>
      <div className="eyebrow">SECURE WORKSPACE</div>
      <h2>Sign in</h2>
      <p>Use your local BudgetSight account.</p>
      <label>Username<input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  </main>;
}

function StatusDot({ status }) { return <span className={`status-dot ${status}`} title={status} />; }

function Help({ label, children }) {
  const anchor = useRef(null);
  const [position, setPosition] = useState(null);
  function show() {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 260;
    const placement = rect.top < 150 ? "below" : "above";
    setPosition({
      placement,
      left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)),
      top: placement === "below" ? rect.bottom + 8 : rect.top - 8,
    });
  }
  useEffect(() => {
    if (!position) return undefined;
    const close = () => setPosition(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [position]);
  return <>
    <span className="help-wrap" ref={anchor} onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}><span className="help-icon" tabIndex="0" aria-label={label}>?</span></span>
    {position && createPortal(<span className={`help-portal ${position.placement}`} role="tooltip" style={{ left: position.left, top: position.top }}>{children}</span>, document.body)}
  </>;
}

export function Sidebar({ repos, tasks, selectedRepo, setSelectedRepo, activeId, onSelect, onNew, onNewRepo }) {
  const repositoryOptions = [...new Map([
    ...tasks.filter((task) => task.repository?.id).map((task) => [task.repository.id, { ...task.repository, historical: !repos.some((repo) => repo.id === task.repository.id) }]),
    ...repos.map((repo) => [repo.id, repo]),
  ]).values()].sort((a, b) => a.name.localeCompare(b.name));
  const shown = selectedRepo ? tasks.filter((task) => task.repository?.id === selectedRepo) : tasks;
  return <aside className="sidebar">
    <div className="rail-heading"><div><span>Workspace</span><strong>Threads</strong></div><span className="thread-count">{shown.length}</span></div>
    <div className="create-actions"><button className="new-task" onClick={onNew}><Icon name="plus" /> New thread</button><button className="new-repo" onClick={onNewRepo} title="Create repository"><Icon name="repo" /></button></div>
    <label className="repo-picker"><span>Repository</span><div className="select-wrap"><Icon name="repo" /><select value={selectedRepo} onChange={(event) => setSelectedRepo(event.target.value)}><option value="">All repositories</option>{repositoryOptions.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}{repo.busy ? " · busy" : repo.historical ? " · history" : ""}</option>)}</select></div></label>
    <div className="task-list"><div className="section-label">RECENT RUNS</div>{shown.length === 0 && <div className="empty-small">No threads yet</div>}{shown.map((task) => <button key={task.id} className={`task-row ${activeId === task.id ? "active" : ""}`} onClick={() => onSelect(task.id)}><StatusDot status={task.status} /><span><strong>{task.title}</strong><small>{task.repository?.name} · {task.model.replace("gpt-6-", "")}</small></span></button>)}</div>
  </aside>;
}

export function NewTask({ repos, defaultRepo, onClose, onCreated }) {
  const [repositoryId, setRepositoryId] = useState(repos.some((repo) => repo.id === defaultRepo) ? defaultRepo : repos[0]?.id || "");
  const [title, setTitle] = useState("");
  const [model, setModel] = useState("gpt-6-sol");
  const [budgetUsd, setBudget] = useState("2.00");
  const [error, setError] = useState("");
  const planningRange = Number(budgetUsd) > 0 ? planningTokenRange(model, Number(budgetUsd) * 1_000_000) : null;
  async function submit(event) {
    event.preventDefault(); setError("");
    try { onCreated((await api("/tasks", { method: "POST", body: JSON.stringify({ repositoryId, title: title || undefined, model, budgetUsd }) })).task); }
    catch (caught) { setError(caught.message); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" role="dialog" aria-modal="true" aria-labelledby="new-thread-title" onSubmit={submit}><div className="eyebrow">NEW CODEX THREAD</div><h2 id="new-thread-title">Start with a boundary</h2><p>Choose the repository, model, and maximum estimated spend before sending work.</p>{repos.length ? <><label>Repository<select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)} required>{repos.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label><label>Thread name<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Fix checkout validation" /></label><div className="form-grid"><label>Model<select value={model} onChange={(event) => setModel(event.target.value)}>{MODELS.map((item) => <option key={item}>{item}</option>)}</select></label><label><span className="field-label">Budget cap (USD)<Help label="How the dollar cap works">The agent stops when estimated Standard API-key spend—including model tokens and completed hosted-tool fees—reaches this amount. Web search costs {money.format(TOOL_PRICING.webSearch / 1_000_000)} per call and file search costs {money.format(TOOL_PRICING.fileSearch / 1_000_000)} per call. Usage can arrive late, so a small overrun remains possible.</Help></span><input type="number" min="0.01" step="0.01" value={budgetUsd} onChange={(event) => setBudget(event.target.value)} />{planningRange && <span className="field-hint">Standard token-only planning range: {integer.format(planningRange.outputHeavy)}–{integer.format(planningRange.uncachedInput)} tokens. Cache hits can increase it; hosted-tool fees reduce it.</span>}</label></div></> : <div className="form-error neutral">Create a repository before starting a thread.</div>}{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!repos.length}>Create thread</button></div></form></div>;
}

function NewRepository({ roots, onClose, onCreated }) {
  const [rootId, setRootId] = useState(roots[0]?.id || "");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { onCreated((await api("/repositories", { method: "POST", body: JSON.stringify({ rootId, name }) })).repository); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" role="dialog" aria-modal="true" aria-labelledby="new-repository-title" onSubmit={submit}><div className="eyebrow">NEW LOCAL REPOSITORY</div><h2 id="new-repository-title">Create a workspace</h2><p>BudgetSight creates a Git repository with a main branch and starter README inside an allowed repository root.</p><label>Location<select value={rootId} onChange={(event) => setRootId(event.target.value)} required>{roots.map((root) => <option key={root.id} value={root.id}>{root.name} — {root.path}</option>)}</select></label><label>Repository name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="my-new-project" required /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !roots.length}>{busy ? "Creating…" : "Create repository"}</button></div></form></div>;
}

function MessageContent({ text, taskId }) {
  return <div className="markdown-body"><ReactMarkdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    urlTransform={(url) => messageHref(url, taskId)?.href || ""}
    components={{
      a({ node: _node, href, children, ...props }) {
        const external = /^https?:\/\//i.test(href || "");
        return <a {...props} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} download={external ? undefined : ""}>{children}</a>;
      },
      pre({ node: _node, children, ...props }) {
        const language = children?.props?.className?.match(/language-([\w-]+)/)?.[1];
        return <div className="code-block">{language && <div className="code-language">{language}</div>}<pre {...props}>{children}</pre></div>;
      },
    }}
  >{text}</ReactMarkdown></div>;
}

export function TimelineItem({ item, taskId }) {
  const eventType = item.type || item.event_type || "event";
  const isUser = item.role === "user";
  if (isUser) return <article className="message user-message"><div className="message-label"><span>Prompt</span><small>Operator input</small></div><div>{displayText(item.text, "Prompt recorded")}</div></article>;
  if (item.role === "assistant") return <article className="message agent-message"><div className="message-label"><span>Work note</span><small>Codex</small></div><MessageContent text={displayText(item.text, "Response recorded")} taskId={taskId} /></article>;
  if (/output_text\.done/.test(eventType) && (item.text || item.raw_json?.text)) return <article className="message agent-message"><div className="message-label"><span>Work note</span><small>Codex</small></div><MessageContent text={displayText(item.text || item.raw_json.text, "Response recorded")} taskId={taskId} /></article>;
  return null;
}

function activityStatusLabel(status) {
  const labels = {
    connecting: "Connecting",
    running: "Running",
    idle_completed: "Completed",
    user_interrupted: "Interrupted",
    budget_interrupted: "Budget interrupted",
    failed: "Failed",
  };
  return labels[status] || displayText(status, "Recorded").replaceAll("_", " ");
}

export function ActivityGroup({ events, taskStatus }) {
  const activity = useMemo(() => {
    const commands = new Map();
    const fileChanges = new Map();
    const alerts = [];

    for (const event of events) {
      const type = eventName(event);
      const item = eventItem(event);
      const order = Number(event.seq || event.localCreatedAt || 0);
      if (item?.type === "commandExecution") {
        const key = item.id || `${type}-${order}`;
        const previous = commands.get(key) || {};
        commands.set(key, { ...previous, ...item, order: previous.order ?? order });
      } else if (item?.type === "fileChange") {
        const key = item.id || `${type}-${order}`;
        const previous = fileChanges.get(key) || {};
        fileChanges.set(key, { ...previous, ...item, order: previous.order ?? order });
      }

      const error = event.error?.message || event.turn?.error?.message || event.raw_json?.error?.message || event.message;
      if (/error|failed/.test(type) && error) alerts.push({ type, message: error, order });
      if (/budgetsight\.budget\.exhausted/.test(type)) alerts.push({ type, message: "Budget cap reached; Codex was interrupted.", order });
    }

    return {
      commands: [...commands.values()].sort((a, b) => a.order - b.order),
      fileChanges: [...fileChanges.values()].sort((a, b) => a.order - b.order),
      alerts: alerts.sort((a, b) => a.order - b.order),
    };
  }, [events]);

  const changeCount = activity.fileChanges.reduce((count, item) => count + Math.max(1, item.changes?.length || 0), 0);
  const running = activity.commands.some((item) => item.status === "inProgress" || item.status === "running");
  const failedCommands = activity.commands.filter((item) => item.status === "failed" || (item.exitCode != null && item.exitCode !== 0));
  const turnFailed = taskStatus === "failed" || activity.alerts.some((alert) => /error|failed/.test(displayText(alert.type)));
  const recoveredCommandErrors = failedCommands.length > 0 && !turnFailed && taskStatus === "idle_completed";
  const counts = [
    activity.commands.length && `${activity.commands.length} command${activity.commands.length === 1 ? "" : "s"}`,
    changeCount && `${changeCount} file change${changeCount === 1 ? "" : "s"}`,
    activity.alerts.length && `${activity.alerts.length} alert${activity.alerts.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const terminalWithoutActivity = {
    user_interrupted: "Run interrupted. No agent activity was recorded after this prompt.",
    budget_interrupted: "Run stopped at the budget limit before agent activity was recorded.",
    failed: "Run failed before agent activity was recorded.",
  }[taskStatus];
  if (!counts.length) return terminalWithoutActivity ? <div className={`turn-state ${taskStatus}`} role="status"><StatusDot status={taskStatus} /><strong>{activityStatusLabel(taskStatus)}</strong><span>{terminalWithoutActivity}</span></div> : null;

  const terminalStatus = ["user_interrupted", "budget_interrupted", "failed"].includes(taskStatus);
  const status = turnFailed ? "failed" : terminalStatus ? taskStatus : running || taskStatus === "running" ? "running" : taskStatus;
  return <details className={`activity-card ${turnFailed ? "error" : recoveredCommandErrors ? "warning" : ""}`}>
    <summary><StatusDot status={status} /><span>Agent activity</span><small><b>{activityStatusLabel(status)}</b> · {counts.join(" · ")}</small><Icon name="chevron" /></summary>
    <div className="activity-body">
      {recoveredCommandErrors && <div className="activity-warning">{failedCommands.length} command {failedCommands.length === 1 ? "attempt failed" : "attempts failed"}, but Codex recovered and completed the turn.</div>}
      {activity.commands.map((item, index) => <section className={`command-entry ${item.status === "failed" || (item.exitCode != null && item.exitCode !== 0) ? "failed" : ""}`} key={item.id || index}>
        <div className="command-heading"><span>COMMAND {index + 1}</span><small>{displayText(item.status, "recorded")}{item.exitCode != null ? ` · exit ${displayText(item.exitCode)}` : ""}</small></div>
        <code>{displayText(item.command || item.commandActions?.[0]?.command, "Command details unavailable")}</code>
        {item.cwd && <div className="command-cwd">in {displayText(item.cwd)}</div>}
        {item.aggregatedOutput && (item.status === "failed" || (item.exitCode != null && item.exitCode !== 0)) && <pre>{displayText(item.aggregatedOutput)}</pre>}
      </section>)}
      {activity.fileChanges.map((item, index) => <section className="file-change-entry" key={item.id || index}>
        <div className="command-heading"><span>FILE CHANGES</span><small>{displayText(item.status, "recorded")}</small></div>
        {(item.changes || []).length ? <ul>{item.changes.map((change, changeIndex) => <li key={`${displayText(change.path, changeIndex)}-${changeIndex}`}><code>{displayText(change.path || change.file, "Unknown file")}</code>{change.kind || change.type ? <span>{displayText(change.kind || change.type)}</span> : null}</li>)}</ul> : <div className="activity-note">Codex reported a file change.</div>}
      </section>)}
      {activity.alerts.map((alert, index) => <div className="activity-alert" key={`${displayText(alert.type, "alert")}-${index}`}>{displayText(alert.message, "Agent activity reported an error.")}</div>)}
      <div className="activity-footnote">Complete raw event JSON remains available in the session export.</div>
    </div>
  </details>;
}

function pendingFileKey(file) {
  return [file.webkitRelativePath || file.name, file.size, file.lastModified, file.type].join(":");
}

function pendingFileName(file) {
  return file.webkitRelativePath || file.name;
}

export function Conversation({ task, detail, onRefresh, onSend, onCancel, readOnly = false }) {
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef();
  const directoryInput = useRef();
  const endRef = useRef();
  const events = detail?.events || [];
  const timeline = useMemo(() => groupTimelineByPrompt(detail?.messages || [], events), [detail, events]);
  const hasActivity = events.some((event) => ["commandExecution", "fileChange"].includes(eventItem(event)?.type) || /budget\.exhausted|error|failed/.test(eventName(event)));
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [detail?.messages?.length, events.length]);
  function resetAttachmentInputs() {
    if (fileInput.current) fileInput.current.value = "";
    if (directoryInput.current) directoryInput.current.value = "";
  }
  function addFiles(list) {
    const additions = Array.from(list || []);
    setPendingFiles((current) => {
      const files = new Map(current.map((file) => [pendingFileKey(file), file]));
      additions.forEach((file) => files.set(pendingFileKey(file), file));
      return Array.from(files.values());
    });
    resetAttachmentInputs();
  }
  function removeFile(key) {
    setPendingFiles((current) => current.filter((file) => pendingFileKey(file) !== key));
  }
  async function submit(event) {
    event.preventDefault(); if (!text.trim() || busy) return; setBusy(true); setError("");
    try {
      const attachmentIds = [];
      if (pendingFiles.length) {
        const form = new FormData();
        for (const file of pendingFiles) { form.append("files", file, file.name); form.append("relativePaths", file.webkitRelativePath || file.name); }
        const uploaded = await api(`/tasks/${task.id}/uploads`, { method: "POST", body: form });
        attachmentIds.push(...uploaded.uploads.map((file) => file.id));
      }
      await onSend(text.trim(), attachmentIds); setText(""); setPendingFiles([]); resetAttachmentInputs();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }
  if (!task) return <section className="conversation welcome"><div className="orb">B</div><h1>Give every agent a budget.</h1><p>Select a repository and start a task to see every token, command, and outcome.</p></section>;
  const agentActive = ["running", "connecting"].includes(task.status);
  const activityLabel = busy && !agentActive ? "Sending" : task.status === "connecting" ? "Connecting" : "Codex is thinking";
  return <section className="conversation">
    <header className="conversation-header"><div><div className="conversation-kicker">Thread workspace</div><div className="breadcrumb">{task.repository?.name} <span>/</span> {task.repoSnapshot?.branch || "workspace"}</div><h1>{task.title}</h1></div><div className="header-state"><StatusDot status={task.status} /> {task.status.replaceAll("_", " ")}</div></header>
    <div className={`host-warning ${readOnly ? "shared" : ""}`}><strong>{readOnly ? `Shared by ${task.user.name}.` : "Local Codex app-server."}</strong> {readOnly ? "You can review this thread; only its owner or an administrator can continue it." : "Commands run in a workspace-write sandbox and may edit the selected repository directly."}</div>
    <div className="timeline" aria-busy={agentActive || busy}>{timeline.groups.length === 0 && timeline.orphan.responses.length === 0 && !hasActivity && <div className="task-empty"><div className="orb small">B</div><h2>What should Codex work on?</h2><p>The selected repository is edited directly. Git state and every Codex event will be recorded.</p></div>}{timeline.orphan.responses.map((item, index) => <TimelineItem key={item.id || item.seq || `orphan-${index}`} item={item} taskId={task.id} />)}<ActivityGroup events={timeline.orphan.events} taskStatus="idle_completed" />{timeline.groups.map((group, groupIndex) => <section className="prompt-turn" key={group.id}><TimelineItem item={group.prompt} taskId={task.id} />{group.responses.map((item, index) => <TimelineItem key={item.id || item.seq || `${group.id}-response-${index}`} item={item} taskId={task.id} />)}<ActivityGroup events={group.events} taskStatus={groupIndex === timeline.groups.length - 1 ? task.status : "idle_completed"} /></section>)}<div ref={endRef} /></div>
    {readOnly ? <div className="shared-thread-note">Read-only shared thread</div> : <form className="composer" onSubmit={submit}>
      <textarea aria-label="Message Codex" value={text} onChange={(event) => setText(event.target.value)} placeholder={task.status === "running" ? "Steer the active turn…" : "Ask Codex to work in this repository…"} rows="3" />
      {pendingFiles.length > 0 && <div className="attachment-tray" aria-label="Pending attachments">
        <div className="attachment-tray-header"><span>{pendingFiles.length} {pendingFiles.length === 1 ? "attachment" : "attachments"}</span>{pendingFiles.length > 1 && <button type="button" onClick={() => { setPendingFiles([]); resetAttachmentInputs(); }}>Clear all</button>}</div>
        <div className="attachment-list">{pendingFiles.map((file) => { const key = pendingFileKey(file); const name = pendingFileName(file); return <div className="attachment-chip" key={key}><Icon name="file" /><span className="attachment-name" title={name}>{name}</span><button type="button" className="attachment-remove" aria-label={`Remove ${name}`} onClick={() => removeFile(key)}>×</button></div>; })}</div>
      </div>}
      <div className="composer-bottom"><div className="attach-actions"><button type="button" onClick={() => fileInput.current.click()}><Icon name="file" /> Files</button><button type="button" onClick={() => directoryInput.current.click()}><Icon name="repo" /> Folder</button><input ref={fileInput} aria-label="Attach files" hidden type="file" multiple onChange={(event) => addFiles(event.target.files)} /><input ref={directoryInput} aria-label="Attach folder" hidden type="file" multiple webkitdirectory="" onChange={(event) => addFiles(event.target.files)} /></div><div className="send-actions">{(agentActive || busy) && <span className="thinking-indicator" role="status"><span className="thinking-spinner" aria-hidden="true" />{activityLabel}</span>}{agentActive && <button type="button" className="stop" onClick={onCancel}><Icon name="stop" /> Stop</button>}<button className="send" disabled={busy || !text.trim()} title="Send" aria-label="Send message"><Icon name="send" /></button></div></div>
      {error && <div className="composer-error">{error}</div>}
    </form>}
  </section>;
}

function Metric({ label, value, muted, help }) { return <div className={`metric ${muted ? "muted" : ""}`}><span className="metric-label">{label}{help && <Help label={`How ${label} is calculated`}>{help}</Help>}</span><strong>{value ?? "—"}</strong></div>; }

function Inspector({ task, detail, onBudgetChanged, readOnly = false }) {
  const [budget, setBudget] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  if (!task) return <aside className="inspector blank"><div className="section-label">THREAD MONITOR</div><p>Budget and usage details appear here.</p></aside>;
  const used = task.budget.estimatedUsd || 0;
  const tokenCost = task.budget.estimatedTokenUsd || 0;
  const toolCost = task.budget.estimatedToolUsd || 0;
  const toolUsage = task.budget.toolUsage || {};
  const cap = task.budget.requestedUsd;
  const percent = Math.min(100, cap ? used / cap * 100 : 0);
  const pricing = PRICING[task.model];
  const uncachedRate = Math.max(pricing.input, pricing.cacheWrite);
  const preRunRange = task.budget.planningTokenRange || planningTokenRange(task.model, cap * 1_000_000);
  const budgetHelp = `Estimated Standard API-key spend includes model tokens plus separately billed hosted tools. Token cost = uncached input × $${pricing.input}/1M + cached input × $${pricing.cachedInput}/1M + cache writes × $${pricing.cacheWrite}/1M + output × $${pricing.output}/1M. Calls above 272K input use long-context rates, and reasoning is already included in output. Web search is $${TOOL_PRICING.webSearch / 1_000_000}/call and file search is $${TOOL_PRICING.fileSearch / 1_000_000}/call. Local shell, browser-control, and MCP calls have no API tool fee.`;
  async function increase() { try { setError(""); const value = Number(budget); if (value <= cap) throw new Error("Enter a value above the current cap"); const result = await api(`/tasks/${task.id}/budget`, { method: "PATCH", body: JSON.stringify({ budgetUsd: value, reason: "Increased from thread monitor" }) }); onBudgetChanged(result.task); setBudget(""); } catch (caught) { setError(caught.message); } }
  function exportSession() {
    setExporting(true); setError("");
    const anchor = document.createElement("a");
    anchor.href = `/api/v1/tasks/${encodeURIComponent(task.id)}/session?download=1`;
    anchor.download = `budgetsight-${task.id}.json`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => setExporting(false), 1_500);
  }
  const limits = detail?.latestRateLimits || {};
  const snapshot = limits.rateLimits || limits;
  const primary = snapshot.primary;
  const secondary = snapshot.secondary;
  const remaining = (window) => window ? `${Math.max(0, 100 - window.usedPercent)}%` : null;
  const reset = (window) => window?.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString() : null;
  const outcome = taskOutcome(task);
  return <aside className="inspector"><div className="inspector-scroll"><div className="section-label">THREAD MONITOR</div><div className="identity-block"><div className="avatar large">{task.user.name.slice(0, 1)}</div><div><strong>{task.user.name}</strong><small>{task.repository?.name}</small></div></div><section className="panel-section"><div className="panel-title"><span className="label-with-help">Budget<Help label="Budget equation">{budgetHelp}</Help></span><strong>{money.format(cap)}</strong></div><div className="budget-bar"><span style={{ width: `${percent}%` }} /></div><div className="budget-row"><span>{task.budget.estimatedUsd == null ? "Usage pending" : `${money.format(used)} estimated`}</span><span>{percent.toFixed(1)}%</span></div>{task.budget.estimatedUsd != null && <div className="budget-row"><small>Tokens {money.format(tokenCost)}</small><small>Tools {money.format(toolCost)}</small></div>}{task.budget.overrunUsd > 0 && <div className="overrun">Over by {money.format(task.budget.overrunUsd)}</div>}<div className="increase-row"><input type="number" step="0.01" min={cap + 0.01} placeholder={`>${cap}`} value={budget} onChange={(event) => setBudget(event.target.value)} /><button onClick={increase}>Increase</button></div></section><section className="panel-section"><div className="panel-title"><span className="label-with-help">Token and tool usage<Help label="About usage estimates">Token counts and costs are best-effort because Codex reports usage asynchronously. Cached and cache-write tokens are included in input; reasoning tokens are included in output. Completed hosted searches add their per-call fee; result content is already represented in model input tokens. Local shell, browser-control, and MCP calls do not add API tool fees.</Help></span><small>best-effort</small></div><div className="metric-grid"><Metric label="Input" value={task.usage ? integer.format(task.usage.inputTokens) : null} /><Metric label="Cached" value={task.usage ? integer.format(task.usage.cachedInputTokens) : null} /><Metric label="Cache write" value={task.usage ? integer.format(task.usage.cacheWriteInputTokens || 0) : null} /><Metric label="Output" value={task.usage ? integer.format(task.usage.outputTokens) : null} /><Metric label="Reasoning" value={task.usage ? integer.format(task.usage.reasoningTokens) : null} /><Metric label="Web searches" value={integer.format(toolUsage.webSearchCalls || 0)} help={`Completed billable search actions × ${money.format(TOOL_PRICING.webSearch / 1_000_000)} per call. Open-page and find-in-page actions are not counted as search calls.`} /><Metric label="File searches" value={integer.format(toolUsage.fileSearchCalls || 0)} help={`Completed hosted file-search calls × ${money.format(TOOL_PRICING.fileSearch / 1_000_000)} per call. Local file reads and repository search commands are not charged.`} /></div><Metric label="Est. token capacity" value={task.budget.estimatedTokenCapacity == null ? null : integer.format(task.budget.estimatedTokenCapacity)} help="Estimated capacity = tokens used × dollar cap ÷ estimated spend. It projects the observed input, cache, cache-write, output, and hosted-tool mix across the full budget." /><Metric label="Est. tokens remaining" value={task.budget.estimatedRemainingTokens == null ? null : integer.format(task.budget.estimatedRemainingTokens)} muted help="Estimated remaining = estimated token capacity − tokens already used. This changes as the token and tool mix changes." /><Metric label="Standard planning range" value={`${integer.format(preRunRange.outputHeavy)}–${integer.format(preRunRange.uncachedInput)}`} muted help={`This pre-run range is token-only. Lower bound = dollar cap × 1,000,000 ÷ $${pricing.output} output rate. Upper bound = dollar cap × 1,000,000 ÷ $${uncachedRate} cache-write rate. Cache hits can increase capacity; long-context and hosted-tool charges can reduce it.`} /></section><section className="panel-section"><div className="panel-title"><span>Context</span></div><Metric label="Runtime" value="Codex app-server" /><Metric label="Pricing" value="Standard API key" help="Uses Standard OpenAI API-key list prices regardless of app-server authentication. The estimate includes supported hosted-tool call fees and does not use the Codex credit rate card." /><Metric label="Model" value={task.model.replace("gpt-", "GPT ")} /><Metric label="Branch" value={task.repoSnapshot?.branch || "—"} /><Metric label="Commit" value={task.repoSnapshot?.commit?.slice(0, 8) || "—"} /><Metric label="Outcome" value={outcome} /></section><section className="panel-section"><div className="panel-title"><span className="label-with-help">Codex rate limits<Help label="Rate-limit scope">These limits belong to the connected Codex account or project. They are not calculated per BudgetSight user and do not change the Standard API-key spend estimate.</Help></span><small>account scoped</small></div><Metric label="Primary remaining" value={remaining(primary)} /><Metric label="Primary reset" value={reset(primary)} /><Metric label="Secondary remaining" value={remaining(secondary)} /><Metric label="Secondary reset" value={reset(secondary)} /></section>{error && <div className="form-error compact-error">{error}</div>}</div><button className="export-button" onClick={exportSession} disabled={exporting}><Icon name="download" /> {exporting ? "Building export…" : "Export complete session"}</button></aside>;
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState([]);
  const [roots, setRoots] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showNewRepo, setShowNewRepo] = useState(false);
  const active = tasks.find((task) => task.id === activeId) || null;
  const activeReadOnly = Boolean(active && user && user.role !== "admin" && active.user?.id !== user.id);
  const reporting = location.pathname === "/reporting";
  const insights = location.pathname === "/insights";
  const accounts = location.pathname === "/accounts";
  const adminView = user?.role === "admin" && (insights || reporting || accounts);

  async function bootstrap(nextUser = user) {
    if (!nextUser) return;
    const [repoData, taskData] = await Promise.all([api("/repositories"), api(`/tasks${nextUser.role === "admin" ? "?all=true" : ""}`)]);
    setRepos(repoData.repositories); setRoots(repoData.roots || []); setTasks(taskData.tasks);
    if (!activeId && taskData.tasks[0]) setActiveId(taskData.tasks[0].id);
  }
  async function refreshDetail(id = activeId) {
    if (!id) return;
    const data = await api(`/tasks/${id}`); setDetail(data);
    setTasks((current) => current.map((task) => task.id === id ? data.task : task));
  }
  useEffect(() => { api("/auth/me").then(({ user: found }) => { setUser(found); return bootstrap(found); }).catch(() => null).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("shared-task-readonly", activeReadOnly);
    return () => document.documentElement.classList.remove("shared-task-readonly");
  }, [activeReadOnly]);
  useEffect(() => { if (!activeId || !user || adminView) { setDetail(null); return; } let source; let cancelled = false; const receive = (event) => { const value = JSON.parse(event.data); setDetail((current) => current ? { ...current, events: [...(current.events || []), value] } : current); if (/usage|completed|cancelled|failed|exhausted/.test(value.type || "")) refreshDetail(activeId).catch(() => null); }; api(`/tasks/${activeId}`).then((data) => { if (cancelled) return; setDetail(data); const after = data.events?.at(-1)?.seq || 0; source = new EventSource(`/api/v1/tasks/${activeId}/events?after=${after}`); source.onmessage = receive; source.addEventListener("update", receive); }); return () => { cancelled = true; source?.close(); }; }, [activeId, user, adminView]);
  async function doLogout() { await api("/auth/logout", { method: "POST" }); setUser(null); setTasks([]); setDetail(null); }
  async function created(task) { setTasks((current) => [task, ...current]); setSelectedRepo(task.repository.id); setActiveId(task.id); setShowNew(false); }
  async function repositoryCreated(repository) { setRepos((current) => [...current, repository].sort((a, b) => a.name.localeCompare(b.name))); setSelectedRepo(repository.id); setShowNewRepo(false); setShowNew(true); }
  async function send(text, attachmentIds) { await api(`/tasks/${activeId}/messages`, { method: "POST", body: JSON.stringify({ text, attachmentIds }) }); await refreshDetail(); }
  async function cancel() { await api(`/tasks/${activeId}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Stopped from UI" }) }); await refreshDetail(); }
  if (loading) return <div className="loading-screen"><img className="loading-logo pulse" src="/budgetsight-logo.svg" alt="BudgetSight" /></div>;
  if (!user) return <Login onLogin={(next) => { setUser(next); bootstrap(next); }} />;
  function selectTask(id) { setActiveId(id); navigate("/"); }
  const activeView = insights && user.role === "admin" ? "insights" : reporting && user.role === "admin" ? "reporting" : accounts && user.role === "admin" ? "accounts" : "threads";
  return <div className={`app-shell ${activeView === "threads" ? "thread-view" : "admin-view"}`}>
    <AppHeader user={user} activeView={activeView} onThreads={() => navigate("/")} onInsights={() => navigate("/insights")} onReporting={() => navigate("/reporting")} onAccounts={() => navigate("/accounts")} onLogout={doLogout} />
    {activeView === "insights" ? <InsightsDashboard /> : activeView === "reporting" ? <ReportingDashboard tasks={tasks} /> : activeView === "accounts" ? <AccountsPage /> : <div className="thread-workspace"><Sidebar repos={repos} tasks={tasks} selectedRepo={selectedRepo} setSelectedRepo={setSelectedRepo} activeId={activeId} onSelect={selectTask} onNew={() => { navigate("/"); setShowNew(true); }} onNewRepo={() => setShowNewRepo(true)} /><Conversation task={active} detail={detail} onRefresh={refreshDetail} onSend={send} onCancel={cancel} readOnly={activeReadOnly} /><Inspector task={detail?.task || active} detail={detail} onBudgetChanged={(task) => { setTasks((current) => current.map((item) => item.id === task.id ? task : item)); refreshDetail(task.id); }} readOnly={activeReadOnly} /></div>}
    {showNew && <NewTask repos={repos} defaultRepo={selectedRepo} onClose={() => setShowNew(false)} onCreated={created} />}
    {showNewRepo && <NewRepository roots={roots} onClose={() => setShowNewRepo(false)} onCreated={repositoryCreated} />}
  </div>;
}
