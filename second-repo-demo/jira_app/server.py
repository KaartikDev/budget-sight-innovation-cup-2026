"""A self-contained issue tracker backed by SQLite. Run with python3 jira_app/server.py."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parent
STATUSES = ("To Do", "In Progress", "In Review", "Done")
PRIORITIES = ("Highest", "High", "Medium", "Low", "Lowest")
TYPES = ("Task", "Bug", "Story", "Epic")


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message, self.status = message, status


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def row_dict(row):
    return dict(row) if row is not None else None


def database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, project_key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '', owner_id INTEGER NOT NULL REFERENCES users(id),
      next_issue INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('admin','member')),
      PRIMARY KEY(project_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS sprints (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', start_date TEXT, end_date TEXT,
      state TEXT NOT NULL DEFAULT 'future' CHECK(state IN ('future','active','closed')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      issue_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'Task', status TEXT NOT NULL DEFAULT 'To Do',
      priority TEXT NOT NULL DEFAULT 'Medium', assignee_id INTEGER REFERENCES users(id),
      reporter_id INTEGER NOT NULL REFERENCES users(id), sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
      estimate INTEGER, due_date TEXT, labels TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id), text TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS issues_project_status ON issues(project_id,status,position);
    CREATE INDEX IF NOT EXISTS issues_project_sprint ON issues(project_id,sprint_id);
    CREATE INDEX IF NOT EXISTS comments_issue ON comments(issue_id,id);
    """)
    return db


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{salt.hex()}:{digest.hex()}"


def password_ok(password: str, stored: str) -> bool:
    try:
        salt, expected = stored.split(":", 1)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 310_000)
        return hmac.compare_digest(actual, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def required_text(value, name, limit=255):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ApiError(f"{name} must be 1–{limit} characters")
    return value.strip()


def optional_text(value, name, limit=10000):
    if not isinstance(value, str) or len(value) > limit:
        raise ApiError(f"{name} must be text up to {limit} characters")
    return value.strip()


def choice(value, name, options):
    if value not in options:
        raise ApiError(f"{name} must be one of: {', '.join(options)}")
    return value


def date_value(value, name):
    if value in (None, ""):
        return None
    try:
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError()
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ApiError(f"{name} must be a valid YYYY-MM-DD date")
    return value


class App(BaseHTTPRequestHandler):
    db_path = ROOT / "jira.sqlite3"
    server_version = "Orbit/1.0"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")

    def send_json(self, data, status=200, cookie=None):
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def send_file(self, filename, content_type):
        payload = (ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            raise ApiError("Expected application/json")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError("Invalid Content-Length")
        if not 0 < length <= 1_000_000:
            raise ApiError("Request body must be 1 byte to 1 MB", 413)
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeError, json.JSONDecodeError):
            raise ApiError("Invalid JSON")
        if not isinstance(value, dict):
            raise ApiError("JSON body must be an object")
        return value

    def current_user(self, db):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            token = cookie["orbit_session"].value
        except Exception:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        return row_dict(db.execute("""SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id
            WHERE s.token_hash=? AND s.expires_at>?""", (token_hash, now())).fetchone())

    def require_user(self, db):
        user = self.current_user(db)
        if not user:
            raise ApiError("Sign in required", 401)
        return user

    def require_member(self, db, project_id, user, admin=False):
        member = db.execute("SELECT role FROM members WHERE project_id=? AND user_id=?", (project_id, user["id"])).fetchone()
        if not member or (admin and member["role"] != "admin"):
            raise ApiError("Project access denied", 403)
        return member["role"]

    def issue(self, db, issue_id, user):
        issue = row_dict(db.execute("SELECT * FROM issues WHERE id=?", (issue_id,)).fetchone())
        if not issue:
            raise ApiError("Issue not found", 404)
        self.require_member(db, issue["project_id"], user)
        return issue

    def activity(self, db, issue_id, user_id, text):
        db.execute("INSERT INTO activity(issue_id,actor_id,text,created_at) VALUES(?,?,?,?)", (issue_id, user_id, text, now()))

    def do_GET(self): self.handle_request("GET")
    def do_POST(self): self.handle_request("POST")
    def do_PATCH(self): self.handle_request("PATCH")
    def do_DELETE(self): self.handle_request("DELETE")

    def handle_request(self, method):
        path = urlsplit(self.path).path
        if method == "GET" and path in ("/", "/index.html", "/app.js", "/styles.css"):
            file, mime = {"/": ("index.html", "text/html; charset=utf-8"), "/index.html": ("index.html", "text/html; charset=utf-8"),
                          "/app.js": ("app.js", "text/javascript; charset=utf-8"), "/styles.css": ("styles.css", "text/css; charset=utf-8")}[path]
            return self.send_file(file, mime)
        if not path.startswith("/api/"):
            return self.send_json({"error": "Not found"}, 404)
        db = None
        try:
            db = database(self.db_path)
            if method != "GET":
                db.execute("BEGIN IMMEDIATE")
            result = self.route(db, method, path, parse_qs(urlsplit(self.path).query))
            db.commit()
            self.send_json(*result)
        except ApiError as exc:
            if db: db.rollback()
            self.send_json({"error": exc.message}, exc.status)
        except sqlite3.IntegrityError:
            if db: db.rollback()
            self.send_json({"error": "Conflict or invalid reference"}, 409)
        except sqlite3.Error:
            if db: db.rollback()
            self.send_json({"error": "Database unavailable"}, 503)
        finally:
            if db: db.close()

    def route(self, db, method, path, query):
        if method == "POST" and path == "/api/register":
            body = self.read_json()
            name = required_text(body.get("name"), "Name", 80)
            email = required_text(body.get("email"), "Email", 254).lower()
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email): raise ApiError("Enter a valid email")
            password = body.get("password")
            if not isinstance(password, str) or len(password) < 10 or len(password) > 256: raise ApiError("Password must be 10–256 characters")
            if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone(): raise ApiError("Email already registered", 409)
            user_id = db.execute("INSERT INTO users(name,email,password_hash,created_at) VALUES(?,?,?,?)",
                                 (name,email,password_hash(password),now())).lastrowid
            return self.new_session(db, user_id)
        if method == "POST" and path == "/api/login":
            body = self.read_json()
            email = str(body.get("email", "")).strip().lower()
            user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
            if not user or not password_ok(str(body.get("password", "")), user["password_hash"]):
                raise ApiError("Invalid email or password", 401)
            return self.new_session(db, user["id"])
        if method == "POST" and path == "/api/logout":
            cookie = SimpleCookie()
            cookie.load(self.headers.get("Cookie", ""))
            if "orbit_session" in cookie:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(cookie["orbit_session"].value.encode()).hexdigest(),))
            return ({"ok": True}, 200, "orbit_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
        user = self.require_user(db)
        if method == "GET" and path == "/api/me": return (user, 200, None)
        if method == "GET" and path == "/api/projects":
            projects = [dict(row) for row in db.execute("""SELECT p.*,m.role,
                (SELECT COUNT(*) FROM issues i WHERE i.project_id=p.id) issue_count
                FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.name""", (user["id"],))]
            return (projects, 200, None)
        if method == "POST" and path == "/api/projects":
            body = self.read_json()
            name = required_text(body.get("name"), "Project name", 100)
            key = required_text(body.get("key"), "Project key", 10).upper()
            if not re.fullmatch(r"[A-Z][A-Z0-9]{1,9}", key): raise ApiError("Project key must be 2–10 letters or digits, starting with a letter")
            description = optional_text(body.get("description", ""), "Description", 500)
            project_id = db.execute("INSERT INTO projects(name,project_key,description,owner_id,created_at) VALUES(?,?,?,?,?)",
                                    (name,key,description,user["id"],now())).lastrowid
            db.execute("INSERT INTO members VALUES(?,?,'admin')", (project_id,user["id"]))
            return ({"id": project_id}, 201, None)
        match = re.fullmatch(r"/api/projects/(\d+)(?:/(members|issues|sprints|stats))?", path)
        if match:
            project_id, action = int(match[1]), match[2]
            role = self.require_member(db, project_id, user)
            if action is None and method == "GET":
                project = row_dict(db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone())
                project["role"] = role
                return (project, 200, None)
            if action == "members":
                if method == "GET":
                    return ([dict(r) for r in db.execute("SELECT u.id,u.name,u.email,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.name", (project_id,))], 200, None)
                if method == "POST":
                    self.require_member(db, project_id, user, True)
                    body = self.read_json()
                    target = db.execute("SELECT id FROM users WHERE email=?", (str(body.get("email", "")).strip().lower(),)).fetchone()
                    if not target: raise ApiError("That user needs to create an account first", 404)
                    db.execute("INSERT INTO members VALUES(?,?,?)", (project_id,target["id"],choice(body.get("role", "member"),"Role",("admin","member"))))
                    return ({"ok": True}, 201, None)
            if action == "issues":
                if method == "GET":
                    clauses, args = ["i.project_id=?"], [project_id]
                    if query.get("status") and query["status"][0] in STATUSES:
                        clauses.append("i.status=?"); args.append(query["status"][0])
                    if query.get("sprint"):
                        sprint = query["sprint"][0]
                        if sprint == "backlog": clauses.append("i.sprint_id IS NULL")
                        elif sprint.isdigit(): clauses.append("i.sprint_id=?"); args.append(int(sprint))
                    if query.get("q"):
                        q = query["q"][0].strip()[:100]
                        clauses.append("(i.title LIKE ? OR i.issue_key LIKE ? OR i.description LIKE ?)")
                        args.extend([f"%{q}%"]*3)
                    if query.get("assignee") and query["assignee"][0].isdigit():
                        clauses.append("i.assignee_id=?"); args.append(int(query["assignee"][0]))
                    sql = """SELECT i.*,a.name assignee_name,r.name reporter_name FROM issues i
                        LEFT JOIN users a ON a.id=i.assignee_id JOIN users r ON r.id=i.reporter_id WHERE """ + " AND ".join(clauses) + " ORDER BY i.position,i.id DESC LIMIT 1000"
                    issues = [dict(r) for r in db.execute(sql,args)]
                    for issue in issues: issue["labels"] = json.loads(issue["labels"])
                    return (issues, 200, None)
                if method == "POST":
                    body = self.read_json()
                    fields = self.issue_fields(db, project_id, body, creating=True)
                    project = db.execute("SELECT project_key,next_issue FROM projects WHERE id=?", (project_id,)).fetchone()
                    key = f"{project['project_key']}-{project['next_issue']}"
                    db.execute("UPDATE projects SET next_issue=next_issue+1 WHERE id=?", (project_id,))
                    timestamp = now()
                    columns = "project_id,issue_key,title,description,type,status,priority,assignee_id,reporter_id,sprint_id,estimate,due_date,labels,position,created_at,updated_at"
                    values = (project_id,key,fields["title"],fields["description"],fields["type"],fields["status"],fields["priority"],fields["assignee_id"],user["id"],fields["sprint_id"],fields["estimate"],fields["due_date"],fields["labels"],timestamp_ms(),timestamp,timestamp)
                    issue_id = db.execute(f"INSERT INTO issues({columns}) VALUES({','.join('?' for _ in values)})",values).lastrowid
                    self.activity(db,issue_id,user["id"],"created this issue")
                    return ({"id": issue_id, "key": key}, 201, None)
            if action == "sprints":
                if method == "GET":
                    return ([dict(r) for r in db.execute("""SELECT s.*,(SELECT COUNT(*) FROM issues i WHERE i.sprint_id=s.id) issue_count
                        FROM sprints s WHERE s.project_id=? ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'future' THEN 1 ELSE 2 END,id DESC""",(project_id,))],200,None)
                if method == "POST":
                    body = self.read_json()
                    sprint_id = db.execute("INSERT INTO sprints(project_id,name,goal,created_at) VALUES(?,?,?,?)",
                        (project_id,required_text(body.get("name"),"Sprint name",100),optional_text(body.get("goal",""),"Goal",500),now())).lastrowid
                    return ({"id":sprint_id},201,None)
            if action == "stats" and method == "GET":
                counts = {r["status"]:r["n"] for r in db.execute("SELECT status,COUNT(*) n FROM issues WHERE project_id=? GROUP BY status",(project_id,))}
                types = {r["type"]:r["n"] for r in db.execute("SELECT type,COUNT(*) n FROM issues WHERE project_id=? GROUP BY type",(project_id,))}
                return ({"statuses":counts,"types":types,"total":sum(counts.values()),"unassigned":db.execute("SELECT COUNT(*) FROM issues WHERE project_id=? AND assignee_id IS NULL",(project_id,)).fetchone()[0]},200,None)
        match = re.fullmatch(r"/api/issues/(\d+)(?:/(comments|activity))?",path)
        if match:
            issue_id, action = int(match[1]),match[2]
            issue = self.issue(db,issue_id,user)
            if action is None:
                if method == "GET":
                    issue["labels"] = json.loads(issue["labels"])
                    return (issue,200,None)
                if method == "PATCH":
                    body = self.read_json()
                    if body.get("sprint_id") == issue["sprint_id"]:
                        body.pop("sprint_id", None)
                    fields = self.issue_fields(db,issue["project_id"],body)
                    if not fields: raise ApiError("No editable fields supplied")
                    assignments = ",".join(f"{key}=?" for key in fields)
                    db.execute(f"UPDATE issues SET {assignments},updated_at=? WHERE id=?",(*fields.values(),now(),issue_id))
                    self.activity(db,issue_id,user["id"],"updated " + ", ".join(fields))
                    return ({"ok":True},200,None)
                if method == "DELETE":
                    self.require_member(db,issue["project_id"],user,True)
                    db.execute("DELETE FROM issues WHERE id=?",(issue_id,))
                    return ({"ok":True},200,None)
            if action == "comments":
                if method == "GET":
                    return ([dict(r) for r in db.execute("SELECT c.*,u.name author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE issue_id=? ORDER BY c.id",(issue_id,))],200,None)
                if method == "POST":
                    body = self.read_json()
                    db.execute("INSERT INTO comments(issue_id,author_id,body,created_at) VALUES(?,?,?,?)",
                        (issue_id,user["id"],required_text(body.get("body"),"Comment",5000),now()))
                    self.activity(db,issue_id,user["id"],"added a comment")
                    return ({"ok":True},201,None)
            if action == "activity" and method == "GET":
                return ([dict(r) for r in db.execute("SELECT a.*,u.name actor_name FROM activity a JOIN users u ON u.id=a.actor_id WHERE issue_id=? ORDER BY a.id DESC LIMIT 100",(issue_id,))],200,None)
        match = re.fullmatch(r"/api/sprints/(\d+)",path)
        if match:
            sprint_id = int(match[1])
            sprint = db.execute("SELECT * FROM sprints WHERE id=?",(sprint_id,)).fetchone()
            if not sprint: raise ApiError("Sprint not found",404)
            self.require_member(db,sprint["project_id"],user)
            if method == "PATCH":
                body = self.read_json()
                fields = {}
                if "name" in body: fields["name"] = required_text(body["name"],"Sprint name",100)
                if "goal" in body: fields["goal"] = optional_text(body["goal"],"Goal",500)
                for key in ("start_date","end_date"):
                    if key in body: fields[key] = date_value(body[key],key)
                if "state" in body:
                    state = choice(body["state"],"State",("future","active","closed"))
                    if sprint["state"] == "closed" and state != "closed": raise ApiError("Closed sprints cannot be reopened")
                    if state == "active" and db.execute("SELECT 1 FROM sprints WHERE project_id=? AND state='active' AND id<>?",(sprint["project_id"],sprint_id)).fetchone():
                        raise ApiError("Only one sprint can be active",409)
                    fields["state"] = state
                if not fields: raise ApiError("No editable fields supplied")
                db.execute("UPDATE sprints SET " + ",".join(f"{k}=?" for k in fields) + " WHERE id=?",(*fields.values(),sprint_id))
                return ({"ok":True},200,None)
        raise ApiError("Not found",404)

    def new_session(self, db, user_id):
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc)+timedelta(days=14)).isoformat(timespec="seconds")
        db.execute("INSERT INTO sessions VALUES(?,?,?)",(hashlib.sha256(token.encode()).hexdigest(),user_id,expires))
        user = row_dict(db.execute("SELECT id,name,email FROM users WHERE id=?",(user_id,)).fetchone())
        secure = "; Secure" if os.environ.get("ORBIT_SECURE_COOKIE") == "1" else ""
        cookie = f"orbit_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600{secure}"
        return (user,200,cookie)

    def issue_fields(self,db,project_id,body,creating=False):
        allowed = {"title","description","type","status","priority","assignee_id","sprint_id","estimate","due_date","labels","position"}
        unknown = set(body)-allowed
        if unknown: raise ApiError("Unknown fields: " + ", ".join(sorted(unknown)))
        fields = {}
        if creating:
            body = {"description":"","type":"Task","status":"To Do","priority":"Medium","assignee_id":None,
                    "sprint_id":None,"estimate":None,"due_date":None,"labels":[],**body}
        if "title" in body: fields["title"] = required_text(body["title"],"Title",255)
        if "description" in body: fields["description"] = optional_text(body["description"],"Description")
        for key,options in (("type",TYPES),("status",STATUSES),("priority",PRIORITIES)):
            if key in body: fields[key] = choice(body[key],key,options)
        if "assignee_id" in body:
            value = body["assignee_id"]
            if value is not None and (type(value) is not int or not db.execute("SELECT 1 FROM members WHERE project_id=? AND user_id=?",(project_id,value)).fetchone()):
                raise ApiError("Assignee must be a project member")
            fields["assignee_id"] = value
        if "sprint_id" in body:
            value = body["sprint_id"]
            if value is not None and (type(value) is not int or not db.execute("SELECT 1 FROM sprints WHERE project_id=? AND id=? AND state<>'closed'",(project_id,value)).fetchone()):
                raise ApiError("Sprint must belong to this project and be open")
            fields["sprint_id"] = value
        if "estimate" in body:
            value = body["estimate"]
            if value is not None and (type(value) is not int or value < 0 or value > 10000): raise ApiError("Estimate must be 0–10000")
            fields["estimate"] = value
        if "due_date" in body: fields["due_date"] = date_value(body["due_date"],"Due date")
        if "labels" in body:
            value = body["labels"]
            if not isinstance(value,list) or len(value)>20 or any(not isinstance(x,str) or not x.strip() or len(x)>30 for x in value):
                raise ApiError("Labels must be a list of up to 20 short names")
            fields["labels"] = json.dumps(list(dict.fromkeys(x.strip() for x in value)))
        if "position" in body:
            value = body["position"]
            if type(value) is not int or value < 0: raise ApiError("Position must be a nonnegative integer")
            fields["position"] = value
        return fields


def timestamp_ms():
    return int(datetime.now(timezone.utc).timestamp()*1000)


def main():
    parser = argparse.ArgumentParser(description="Orbit issue tracker")
    parser.add_argument("--host",default="127.0.0.1")
    parser.add_argument("--port",type=int,default=8080)
    parser.add_argument("--database",type=Path,default=ROOT/"jira.sqlite3")
    args = parser.parse_args()
    App.db_path = args.database
    with database(args.database): pass
    server = ThreadingHTTPServer((args.host,args.port),App)
    print(f"Orbit running at http://{args.host}:{server.server_port}")
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == "__main__": main()
