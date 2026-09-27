import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

from jira_app.server import App, ApiError, database


class JiraAppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "app.db"
        self.cookie = None

    def request(self, method, path, data=None, cookie=None):
        handler = App.__new__(App)
        handler.headers = {}
        if data is not None:
            payload = json.dumps(data).encode()
            handler.headers["Content-Type"] = "application/json"
            handler.headers["Content-Length"] = str(len(payload))
            handler.rfile = io.BytesIO(payload)
        if cookie or self.cookie:
            handler.headers["Cookie"] = cookie or self.cookie
        db = database(self.path)
        try:
            try:
                result = handler.route(db, method, urlsplit("/api" + path).path,
                                       parse_qs(urlsplit("/api" + path).query))
                db.commit()
                body, status, cookie = result
                return status, body, cookie
            except ApiError as exc:
                db.rollback()
                return exc.status, {"error": exc.message}, None
        finally:
            db.close()

    def test_project_issue_sprint_and_permissions(self):
        self.assertEqual(self.request("GET", "/projects")[0], 401)
        status, user, cookie = self.request("POST", "/register", {"name": "Alex", "email": "alex@example.com", "password": "strong-pass-123"})
        self.assertEqual(status, 200)
        self.cookie = cookie.split(";", 1)[0]
        status, project, _ = self.request("POST", "/projects", {"name": "Platform", "key": "PLAT"})
        self.assertEqual(status, 201)
        project_id = project["id"]
        status, sprint, _ = self.request("POST", f"/projects/{project_id}/sprints", {"name": "Sprint 1", "goal": "Launch"})
        self.assertEqual(status, 201)
        self.assertEqual(self.request("PATCH", f"/sprints/{sprint['id']}", {"state": "active"})[0], 200)
        status, issue, _ = self.request("POST", f"/projects/{project_id}/issues", {
            "title": "Ship board", "type": "Story", "sprint_id": sprint["id"], "assignee_id": user["id"], "labels": ["frontend"]})
        self.assertEqual(status, 201)
        self.assertEqual(issue["key"], "PLAT-1")
        issue_id = issue["id"]
        self.assertEqual(self.request("PATCH", f"/issues/{issue_id}", {"status": "In Progress"})[0], 200)
        self.assertEqual(self.request("POST", f"/issues/{issue_id}/comments", {"body": "Ready for review"})[0], 201)
        status, issues, _ = self.request("GET", f"/projects/{project_id}/issues?status=In%20Progress")
        self.assertEqual(status, 200)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["labels"], ["frontend"])
        self.assertEqual(len(self.request("GET", f"/issues/{issue_id}/comments")[1]), 1)
        self.assertEqual(self.request("POST", "/register", {"name": "Sam", "email": "sam@example.com", "password": "another-pass-123"})[0], 200)
        _, _, other_cookie = self.request("POST", "/login", {"email": "sam@example.com", "password": "another-pass-123"})
        original_cookie = self.cookie
        self.cookie = other_cookie.split(";", 1)[0]
        self.assertEqual(self.request("GET", f"/projects/{project_id}/issues")[0], 403)
        self.cookie = original_cookie
        self.assertEqual(self.request("POST", f"/projects/{project_id}/members", {"email": "sam@example.com"})[0], 201)
        self.cookie = other_cookie.split(";", 1)[0]
        self.assertEqual(self.request("GET", f"/projects/{project_id}/issues")[0], 200)
        self.assertEqual(self.request("DELETE", f"/issues/{issue_id}")[0], 403)


if __name__ == "__main__":
    unittest.main()
