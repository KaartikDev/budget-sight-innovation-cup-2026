import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, now } from "./db.js";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const name = argument("name");
const username = argument("username");
const password = argument("password");
const role = argument("role", "user");

if (!name || !username || !password || !["user", "admin"].includes(role)) {
  console.error('Usage: npm run seed-user -- --name "Name" --username name --password secret --role user|admin');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const existing = db.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE").get(username);
if (existing) {
  db.prepare("UPDATE users SET display_name=?,password_hash=?,role=? WHERE id=?").run(name, hash, role, existing.id);
  console.log(`Updated ${username}`);
} else {
  db.prepare("INSERT INTO users(id,display_name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(
    crypto.randomUUID(), name, username, hash, role, now(),
  );
  console.log(`Created ${username}`);
}
