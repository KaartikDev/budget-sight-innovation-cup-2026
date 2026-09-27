import contextlib
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest import mock
import xml.etree.ElementTree as ET

import static_site as site


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.out = self.root / "_site"
        (self.root / "content").mkdir(parents=True)
        (self.root / "templates").mkdir()
        (self.root / "site.json").write_text(json.dumps({
            "title": "Test & Site", "description": "Example", "base_url": "https://example.test"
        }), encoding="utf-8")
        (self.root / "templates/page.html").write_text(
            '<title>{{ page.title }}</title><nav>{% for link in site.navigation %}'
            '<a href="{{ link.url }}">{{ link.title }}</a>{% endfor %}</nav>'
            '<main>{{{ content }}}</main><aside>{% for tag in page.tags %}'
            '<a href="{{ tag.url }}">{{ tag.name }}</a>{% endfor %}</aside>', encoding="utf-8")

    def page(self, relative, title="Page", body="Hello", extra=""):
        target = self.root / "content" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"---\ntitle: {title}\n{extra}---\n{body}\n", encoding="utf-8")
        return target

    def test_build_pages_navigation_tags_assets_and_rss(self):
        self.page("index.md", "Home <safe>", "# Hello\n\nA **bold** [link](https://example.test).", "nav_order: 1\n")
        self.page("posts/one.md", "First & note", "A *post*.", "date: 2026-09-26\ntags: Python, News\n")
        (self.root / "content/img.png").write_bytes(b"\x89PNG\r\n")
        result = site.build(self.root, self.out)
        self.assertEqual(result, {"written": 6, "removed": 0, "total": 6})
        home = (self.out / "index.html").read_text()
        self.assertIn("Home &lt;safe&gt;", home)
        self.assertIn('<a href="/index.html">Home &lt;safe&gt;</a>', home)
        self.assertIn("<h1>Hello</h1>", home)
        self.assertIn("<strong>bold</strong>", home)
        post = (self.out / "posts/one.html").read_text()
        self.assertIn('href="/tags/python.html"', post)
        self.assertIn("First &amp; note", (self.out / "tags/python.html").read_text())
        self.assertEqual((self.out / "img.png").read_bytes(), b"\x89PNG\r\n")
        root = ET.fromstring((self.out / "rss.xml").read_bytes())
        self.assertEqual(root.findtext("channel/title"), "Test & Site")
        self.assertEqual(root.findtext("channel/item/link"), "https://example.test/posts/one.html")

    def test_incremental_build_and_stale_cleanup(self):
        path = self.page("index.md", "Home", "First")
        site.build(self.root, self.out)
        generated = self.out / "index.html"
        first_mtime = generated.stat().st_mtime_ns
        manifest_mtime = (self.out / ".site-manifest.json").stat().st_mtime_ns
        self.assertEqual(site.build(self.root, self.out)["written"], 0)
        self.assertEqual(generated.stat().st_mtime_ns, first_mtime)
        self.assertEqual((self.out / ".site-manifest.json").stat().st_mtime_ns, manifest_mtime)
        path.write_text("---\ntitle: Home\n---\nSecond\n", encoding="utf-8")
        self.assertEqual(site.build(self.root, self.out)["written"], 1)
        self.assertIn("Second", generated.read_text())
        path.unlink()
        result = site.build(self.root, self.out)
        self.assertEqual(result["removed"], 1)
        self.assertFalse(generated.exists())

    def test_template_edit_rebuilds_page(self):
        self.page("index.md")
        site.build(self.root, self.out)
        template = self.root / "templates/page.html"
        template.write_text(template.read_text() + "<!-- changed -->", encoding="utf-8")
        self.assertEqual(site.build(self.root, self.out)["written"], 1)

    def test_markdown_escapes_html_and_unsafe_links(self):
        rendered = site.markdown("<script>alert(1)</script>\n\n[x](javascript:alert)\n\n![a](//evil.test)\n\n```py\n<a>\n```")
        self.assertIn("&lt;script&gt;", rendered)
        self.assertIn('href="#"', rendered)
        self.assertIn('src="#"', rendered)
        self.assertIn('<code class="language-py">&lt;a&gt;</code>', rendered)

    def test_template_loops_escape_values_and_report_errors(self):
        rendered = site.render_template("{% for x in rows %}{{ x.name }}{% endfor %}", {"rows": [{"name": "<x>"}]})
        self.assertEqual(rendered, "&lt;x&gt;")
        for template in ("{{ missing }}", "{% endfor %}", "{% for x in rows %}x", "{{ bad-tag }}"):
            with self.subTest(template=template), self.assertRaises(site.SiteError):
                site.render_template(template, {"rows": []})

    def test_invalid_metadata_and_collision_are_errors(self):
        self.page("bad.md", extra="date: tomorrow\n")
        with self.assertRaisesRegex(site.SiteError, "date must be"):
            site.build(self.root, self.out)
        (self.root / "content/bad.md").unlink()
        self.page("tags/python.md", "Collision", "body")
        self.page("post.md", "Post", "body", "tags: Python\n")
        with self.assertRaisesRegex(site.SiteError, "collision"):
            site.build(self.root, self.out)

    def test_invalid_config_and_missing_template(self):
        self.page("index.md", extra="template: missing.html\n")
        with self.assertRaisesRegex(site.SiteError, "unknown template"):
            site.build(self.root, self.out)
        (self.root / "site.json").write_text("{broken", encoding="utf-8")
        with self.assertRaisesRegex(site.SiteError, "invalid JSON"):
            site.build(self.root, self.out)

    def test_cli_build(self):
        self.page("index.md")
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = site.main(["build", "--site", str(self.root)])
        self.assertEqual(code, 0)
        self.assertIn("Built 2 files", stdout.getvalue())
        self.assertEqual(stderr.getvalue(), "")

    def test_server_rebuilds_changed_page(self):
        page = self.page("index.md", body="Original")
        started = threading.Event()
        release = threading.Event()
        servers = []

        class FakeServer:
            server_port = 8000

            def __init__(self, address, handler):
                self.address = address
                self.handler = handler
                servers.append(self)
                started.set()

            def serve_forever(self):
                release.wait(3)

            def server_close(self):
                pass

        with mock.patch.object(site, "ThreadingHTTPServer", FakeServer):
            worker = threading.Thread(target=site.serve, args=(self.root, self.out, "127.0.0.1", 0), daemon=True)
            worker.start()
            self.assertTrue(started.wait(3))
            try:
                self.assertEqual(servers[0].address, ("127.0.0.1", 0))
                self.assertIn("Original", (self.out / "index.html").read_text())
                page.write_text("---\ntitle: Page\n---\nUpdated\n", encoding="utf-8")
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    if b"Updated" in (self.out / "index.html").read_bytes():
                        break
                    time.sleep(0.1)
                else:
                    self.fail("development server did not rebuild the page")
            finally:
                release.set()
                worker.join(timeout=3)
                self.assertFalse(worker.is_alive())


if __name__ == "__main__":
    unittest.main()
