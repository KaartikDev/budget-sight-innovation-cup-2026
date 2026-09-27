import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, now, publicUser, audit } from "./db.js";
import { config } from "./config.js";

const COOKIE = "budgetsight_session";
const SESSION_DAYS = 7;

function tokenHash(token) {
  return crypto.createHash("sha256").update(`${config.sessionSecret}:${token}`).digest("hex");
}

export async function login(username, password, res) {
  const user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare("INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").run(
    tokenHash(token),
    user.id,
    expiresAt,
    createdAt,
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    expires: new Date(expiresAt),
    path: "/",
  });
  audit({ userId: user.id, action: "auth.login" });
  return publicUser(user);
}

export function logout(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash(token));
  res.clearCookie(COOKIE, { path: "/" });
  if (req.user) audit({ userId: req.user.id, action: "auth.logout" });
}

export function authenticate(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  const row = db.prepare(`
    SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?
  `).get(tokenHash(token), now());
  req.user = publicUser(row);
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "authentication_required" });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "authentication_required" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "admin_required" });
  next();
}

export function canAccessTask(user, taskRow) {
  return Boolean(user && taskRow);
}

export function canManageTask(user, taskRow) {
  return Boolean(user && taskRow && (user.role === "admin" || taskRow.user_id === user.id));
}
