import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, now } from "./db.js";

const accounts = [
  {
    name: "BudgetSight Admin",
    username: "admin",
    password: "admin12345",
    role: "admin",
  },
  {
    name: "Demo User",
    username: "demo",
    password: "demo12345",
    role: "user",
  },
  {
    name: "Maya Chen",
    username: "maya.chen",
    password: "Cedar!Sky27",
    role: "user",
  },
  {
    name: "Jordan Patel",
    username: "jordan.patel",
    password: "Harbor!Mint42",
    role: "user",
  },
  {
    name: "Sofia Ramirez",
    username: "sofia.ramirez",
    password: "Quartz!Lake56",
    role: "user",
  },
  {
    name: "Liam O'Connor",
    username: "liam.oconnor",
    password: "Maple!River38",
    role: "user",
  },
  {
    name: "Aisha Thompson",
    username: "aisha.thompson",
    password: "Nova!Field64",
    role: "user",
  },
];

for (const account of accounts) {
  const passwordHash = await bcrypt.hash(account.password, 12);
  const existing = db
    .prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE")
    .get(account.username);

  if (existing) {
    db.prepare(
      "UPDATE users SET display_name=?, password_hash=?, role=? WHERE id=?",
    ).run(account.name, passwordHash, account.role, existing.id);
    console.log(`Updated ${account.username}`);
  } else {
    db.prepare(
      "INSERT INTO users(id,display_name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)",
    ).run(
      crypto.randomUUID(),
      account.name,
      account.username,
      passwordHash,
      account.role,
      now(),
    );
    console.log(`Created ${account.username}`);
  }
}

console.log("Default local accounts are ready.");
