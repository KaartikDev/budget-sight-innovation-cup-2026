import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

function initials(name) {
  return String(name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function suggestedPassword() {
  const words = ["Cedar", "Harbor", "Maple", "Nova", "Quartz", "River", "Summit", "Willow"];
  const first = words[Math.floor(Math.random() * words.length)];
  let second = first;
  while (second === first) second = words[Math.floor(Math.random() * words.length)];
  return `${first}!${second}${Math.floor(10 + Math.random() * 90)}`;
}

export default function AccountsPage() {
  const [users, setUsers] = useState([]);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(suggestedPassword);
  const [role, setRole] = useState("user");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setUsers((await api("/admin/users")).users); }
    catch (caught) { setError(caught.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => ({
    threads: users.reduce((sum, user) => sum + user.threadCount, 0),
    spend: users.reduce((sum, user) => sum + user.estimatedSpendUsd, 0),
  }), [users]);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(""); setCreated(null);
    try {
      const result = await api("/admin/users", { method: "POST", body: JSON.stringify({ name, username, password, role }) });
      setUsers((current) => [...current, result.user].sort((a, b) => a.name.localeCompare(b.name)));
      setCreated({ ...result.user, password });
      setName(""); setUsername(""); setPassword(suggestedPassword()); setRole("user");
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }

  return <main className="accounts-page">
    <header className="accounts-header"><div><div className="eyebrow">ADMIN / ACCESS</div><h1>Accounts</h1><p>Create local BudgetSight accounts and review who has access to the workspace.</p></div><div className="account-total"><strong>{users.length}</strong><span>active accounts</span></div></header>
    <div className="accounts-layout">
      <section className="accounts-list-card">
        <div className="accounts-list-head"><div><h2>Workspace members</h2><p>{totals.threads} threads · {money.format(totals.spend)} estimated spend</p></div><button onClick={load} disabled={loading}>↻</button></div>
        {loading ? <div className="accounts-state">Loading accounts…</div> : <div className="accounts-list">{users.map((user) => <article className="account-row" key={user.id}><div className="account-avatar">{initials(user.name)}</div><div className="account-identity"><strong>{user.name}</strong><span>@{user.username}</span></div><span className={`account-role ${user.role}`}>{user.role}</span><div className="account-usage"><strong>{user.threadCount}</strong><span>threads</span></div><div className="account-usage"><strong>{money.format(user.estimatedSpendUsd)}</strong><span>estimated</span></div></article>)}</div>}
      </section>

      <form className="account-create-card" onSubmit={submit}>
        <div className="account-create-icon">+</div><div><h2>Create an account</h2><p>Set a temporary password and share it directly with the new user.</p></div>
        <label>Full name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Morgan Lee" minLength="2" maxLength="80" required /></label>
        <label>Username<input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/\s+/g, "."))} placeholder="morgan.lee" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" required /></label>
        <label>Role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="user">User</option><option value="admin">Administrator</option></select></label>
        <label>Temporary password<div className="account-password"><input value={password} onChange={(event) => setPassword(event.target.value)} minLength="10" maxLength="128" required /><button type="button" onClick={() => setPassword(suggestedPassword())}>Generate</button></div></label>
        {created && <div className="account-success"><strong>{created.name} is ready.</strong><span>Username <code>{created.username}</code> · temporary password <code>{created.password}</code></span><small>This is the only time the password is shown.</small></div>}
        {error && <div className="form-error">{error}</div>}
        <button className="primary" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
        <div className="account-security-note">Passwords are hashed before storage. Account creation is recorded in the audit log.</div>
      </form>
    </div>
  </main>;
}
