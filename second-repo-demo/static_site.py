"""Small standard-library static site generator. See README.md for the file formats."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from functools import partial
import hashlib
from html import escape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
import threading
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET


class SiteError(Exception):
    """An actionable site configuration or source error."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise SiteError(f"Cannot read {path}: {exc}") from exc


def safe_url(url: str) -> str:
    """Block executable and scheme-relative URLs in generated attributes."""
    value = url.strip()
    parsed = urlsplit(value)
    if value.startswith("//") or parsed.scheme.lower() not in ("", "http", "https", "mailto"):
        return "#"
    if parsed.scheme == "" and ":" in parsed.path.split("/")[0]:
        return "#"
    return value


INLINE = re.compile(r"(`[^`\n]+`|!\[[^\]\n]*\]\([^()\n]*\)|\[[^\]\n]+\]\([^()\n]*\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)")


def inline(value: str) -> str:
    parts = []
    for item in INLINE.split(value):
        if not item:
            continue
        if item.startswith("`") and item.endswith("`"):
            parts.append(f"<code>{escape(item[1:-1])}</code>")
        elif item.startswith("!["):
            label, url = item[2:-1].split("](", 1)
            parts.append(f'<img src="{escape(safe_url(url), quote=True)}" alt="{escape(label, quote=True)}">')
        elif item.startswith("["):
            label, url = item[1:-1].split("](", 1)
            parts.append(f'<a href="{escape(safe_url(url), quote=True)}">{escape(label)}</a>')
        elif item.startswith("**"):
            parts.append(f"<strong>{escape(item[2:-2])}</strong>")
        elif item.startswith("*"):
            parts.append(f"<em>{escape(item[1:-1])}</em>")
        else:
            parts.append(escape(item))
    return "".join(parts)


def markdown(source: str) -> str:
    """Render the documented Markdown subset, escaping source HTML by default."""
    lines = source.splitlines()
    result = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        if line.startswith("```"):
            language = line[3:].strip()
            if language and not re.fullmatch(r"[\w+-]+", language):
                raise SiteError(f"Invalid code fence language: {language}")
            index += 1
            code = []
            while index < len(lines) and not lines[index].startswith("```"):
                code.append(lines[index])
                index += 1
            if index == len(lines):
                raise SiteError("Unclosed code fence")
            css = f' class="language-{escape(language)}"' if language else ""
            result.append(f"<pre><code{css}>{escape(chr(10).join(code))}</code></pre>")
            index += 1
            continue
        heading = re.fullmatch(r"(#{1,6})\s+(.+?)\s*#*", line)
        if heading:
            level = len(heading[1])
            result.append(f"<h{level}>{inline(heading[2])}</h{level}>")
            index += 1
            continue
        if re.fullmatch(r"\s*(?:---+|\*\*\*+)\s*", line):
            result.append("<hr>")
            index += 1
            continue
        list_match = re.match(r"^\s*(?:([-*])|(\d+)\.)\s+(.+)$", line)
        if list_match:
            ordered = list_match[2] is not None
            tag = "ol" if ordered else "ul"
            items = []
            while index < len(lines):
                match = re.match(r"^\s*(?:([-*])|(\d+)\.)\s+(.+)$", lines[index])
                if not match or (match[2] is not None) != ordered:
                    break
                items.append(f"<li>{inline(match[3])}</li>")
                index += 1
            result.append(f"<{tag}>" + "".join(items) + f"</{tag}>")
            continue
        if line.startswith("> "):
            quoted = []
            while index < len(lines) and lines[index].startswith("> "):
                quoted.append(lines[index][2:])
                index += 1
            result.append(f"<blockquote><p>{inline(' '.join(quoted))}</p></blockquote>")
            continue
        paragraph = [line.strip()]
        index += 1
        while index < len(lines) and lines[index].strip() and not re.match(
            r"^(?:#{1,6}\s|```|> |\s*[-*]\s|\s*\d+\.\s)", lines[index]
        ):
            paragraph.append(lines[index].strip())
            index += 1
        result.append(f"<p>{inline(' '.join(paragraph))}</p>")
    return "\n".join(result)


def parse_page(path: Path) -> tuple[dict, str]:
    source = read_text(path)
    if not source.startswith("---\n"):
        raise SiteError(f"{path}: expected front matter beginning with ---")
    end = source.find("\n---\n", 4)
    if end < 0:
        raise SiteError(f"{path}: front matter has no closing ---")
    metadata = {}
    for line in source[4:end].splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"([a-z_]+):\s*(.*)", line)
        if not match or match[1] in metadata:
            raise SiteError(f"{path}: invalid or duplicate front matter line: {line}")
        metadata[match[1]] = match[2].strip()
    if not metadata.get("title"):
        raise SiteError(f"{path}: title is required")
    if "date" in metadata:
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", metadata["date"]):
                raise ValueError("wrong format")
            date.fromisoformat(metadata["date"])
        except ValueError as exc:
            raise SiteError(f"{path}: date must be YYYY-MM-DD") from exc
    metadata["tags"] = [tag.strip() for tag in metadata.get("tags", "").split(",") if tag.strip()]
    if "nav_order" in metadata:
        try:
            metadata["nav_order"] = int(metadata["nav_order"])
        except ValueError as exc:
            raise SiteError(f"{path}: nav_order must be an integer") from exc
    return metadata, source[end + 5:]


TOKEN = re.compile(r"(\{\{\{\s*[\w.]+\s*\}\}\}|\{\{\s*[\w.]+\s*\}\}|\{%\s*(?:for\s+\w+\s+in\s+[\w.]+|endfor)\s*%\})")


def lookup(context: dict, name: str):
    value = context
    for part in name.split("."):
        if not isinstance(value, dict) or part not in value:
            raise SiteError(f"Unknown template variable: {name}")
        value = value[part]
    return value


def render_template(source: str, context: dict) -> str:
    tokens = TOKEN.split(source)

    def section(start: int, nested: bool = False) -> tuple[str, int]:
        output = []
        i = start
        while i < len(tokens):
            token = tokens[i]
            if token.startswith("{%"):
                statement = token[2:-2].strip()
                if statement == "endfor":
                    if not nested:
                        raise SiteError("Unexpected endfor in template")
                    return "".join(output), i + 1
                match = re.fullmatch(r"for (\w+) in ([\w.]+)", statement)
                if not match:
                    raise SiteError(f"Invalid template statement: {statement}")
                # Find the matching endfor, allowing nested loops.
                depth, end = 1, i + 1
                while end < len(tokens) and depth:
                    if tokens[end].startswith("{%"):
                        depth += tokens[end][2:-2].strip().startswith("for ")
                        depth -= tokens[end][2:-2].strip() == "endfor"
                    end += 1
                if depth:
                    raise SiteError("Unclosed for loop in template")
                values = lookup(context, match[2])
                if not isinstance(values, list):
                    raise SiteError(f"Template loop requires a list: {match[2]}")
                body = "".join(tokens[i + 1:end - 1])
                for value in values:
                    output.append(render_template(body, {**context, match[1]: value}))
                i = end
                continue
            if token.startswith("{{{"):
                output.append(str(lookup(context, token[3:-3].strip())))
            elif token.startswith("{{"):
                output.append(escape(str(lookup(context, token[2:-2].strip()))))
            else:
                if "{{" in token or "{%" in token:
                    raise SiteError("Malformed template tag")
                output.append(token)
            i += 1
        if nested:
            raise SiteError("Unclosed for loop in template")
        return "".join(output), i

    return section(0)[0]


def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not result:
        raise SiteError(f"Tag has no URL-safe characters: {value!r}")
    return result


def load_config(root: Path) -> dict:
    path = root / "site.json"
    try:
        config = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise SiteError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(config, dict) or not isinstance(config.get("title"), str) or not config["title"].strip():
        raise SiteError(f"{path}: nonempty title is required")
    base = config.get("base_url")
    if not isinstance(base, str) or urlsplit(base).scheme not in ("http", "https") or not urlsplit(base).netloc or urlsplit(base).query or urlsplit(base).fragment:
        raise SiteError(f"{path}: base_url must be an absolute HTTP(S) URL")
    config.setdefault("description", "")
    if not isinstance(config["description"], str):
        raise SiteError(f"{path}: description must be a string")
    config["base_url"] = base.rstrip("/")
    return config


def rss(config: dict, pages: list[dict]) -> bytes:
    channel = ET.Element("channel")
    ET.SubElement(channel, "title").text = config["title"]
    ET.SubElement(channel, "link").text = config["base_url"] + "/"
    ET.SubElement(channel, "description").text = config["description"]
    for page in sorted((p for p in pages if p.get("date")), key=lambda p: p["date"], reverse=True):
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = page["title"]
        ET.SubElement(item, "link").text = config["base_url"] + page["url"]
        ET.SubElement(item, "guid").text = config["base_url"] + page["url"]
        ET.SubElement(item, "pubDate").text = datetime.fromisoformat(page["date"]).replace(tzinfo=timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    return b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(_rss_root(channel), encoding="utf-8")


def _rss_root(channel: ET.Element) -> ET.Element:
    root = ET.Element("rss", version="2.0")
    root.append(channel)
    return root


def build(root: Path, output: Path) -> dict:
    root, output = root.resolve(), output.resolve()
    content, templates = root / "content", root / "templates"
    if not content.is_dir() or not templates.is_dir():
        raise SiteError("Site requires content/ and templates/ directories")
    if output == root or root.is_relative_to(output) or output.is_relative_to(content):
        raise SiteError("Output must be outside content/ and cannot contain the source site")
    config = load_config(root)
    template_files = {p.name: read_text(p) for p in templates.glob("*.html") if p.is_file()}
    if "page.html" not in template_files:
        raise SiteError("templates/page.html is required")
    pages = []
    files = sorted(p for p in content.rglob("*") if p.is_file())
    for path in files:
        if path.is_symlink():
            raise SiteError(f"Symlinks are not supported in content: {path}")
        if path.suffix.lower() != ".md":
            continue
        metadata, body = parse_page(path)
        relative = path.relative_to(content).with_suffix(".html")
        pages.append({**metadata, "body": body, "url": "/" + relative.as_posix(), "path": relative.as_posix()})
    navigation = [{"title": p["title"], "url": p["url"]} for p in sorted(
        (p for p in pages if "nav_order" in p), key=lambda p: (p["nav_order"], p["title"])
    )]
    tags = {}
    for page in pages:
        for tag in page["tags"]:
            key = slug(tag)
            if key in tags and tags[key]["name"] != tag:
                raise SiteError(f"Tags {tags[key]['name']!r} and {tag!r} share URL slug {key!r}")
            tags.setdefault(key, {"name": tag, "slug": key, "url": f"/tags/{key}.html", "pages": []})["pages"].append(page)
    for page in pages:
        page["tags"] = [{"name": tag, "url": tags[slug(tag)]["url"]} for tag in page["tags"]]
    site = {**config, "navigation": navigation, "tags": [{"name": t["name"], "url": t["url"]} for t in tags.values()]}
    planned: dict[str, tuple[bytes, str]] = {}

    def add(path: str, data: bytes, dependency: str) -> None:
        if path in planned or path == ".site-manifest.json":
            raise SiteError(f"Output path collision: {path}")
        planned[path] = data, dependency

    common = digest(json.dumps({"site": site, "pages": [(p["title"], p["url"], p["tags"]) for p in pages]}, sort_keys=True).encode())
    for page in pages:
        template_name = page.get("template", "page.html")
        if template_name not in template_files or Path(template_name).name != template_name:
            raise SiteError(f"{page['path']}: unknown template {template_name}")
        context = {"site": site, "page": page, "content": markdown(page["body"])}
        rendered = render_template(template_files[template_name], context).encode("utf-8")
        dependency = digest((common + page["body"] + template_files[template_name] + json.dumps(page, sort_keys=True)).encode())
        add(page["path"], rendered, dependency)
    tag_template = template_files.get("tag.html", template_files["page.html"])
    for tag in tags.values():
        entries = [{"title": p["title"], "url": p["url"]} for p in tag["pages"]]
        tag_page = {"title": f"Tag: {tag['name']}", "url": tag["url"], "path": f"tags/{tag['slug']}.html", "tags": [], "entries": entries}
        content_html = "<ul>" + "".join(f'<li><a href="{escape(p["url"], quote=True)}">{escape(p["title"])}</a></li>' for p in entries) + "</ul>"
        add(f"tags/{tag['slug']}.html", render_template(tag_template, {"site": site, "page": tag_page, "content": content_html}).encode(), digest((common + tag_template + tag["name"]).encode()))
    add("rss.xml", rss(config, pages), digest((common + json.dumps([(p["title"], p.get("date"), p["url"]) for p in pages])).encode()))
    for path in files:
        if path.suffix.lower() == ".md":
            continue
        relative = path.relative_to(content).as_posix()
        data = path.read_bytes()
        add(relative, data, digest(data))

    manifest_path = output / ".site-manifest.json"
    old = {}
    if manifest_path.exists():
        try:
            old = json.loads(read_text(manifest_path))
            if not isinstance(old, dict) or old.get("version") != 1 or not isinstance(old.get("outputs"), dict):
                old = {}
        except (SiteError, json.JSONDecodeError):
            old = {}
    previous = old.get("outputs", {})
    changed = 0
    for relative, (data, dependency) in planned.items():
        target = output / relative
        old_entry = previous.get(relative)
        if not (isinstance(old_entry, dict) and old_entry.get("dependency") == dependency and target.is_file() and digest(target.read_bytes()) == digest(data)):
            write_atomic(target, data)
            changed += 1
    removed = 0
    for relative in previous.keys() - planned.keys():
        safe = PurePosixPath(relative)
        if safe.is_absolute() or ".." in safe.parts or relative == ".site-manifest.json":
            continue
        target = output / relative
        if target.is_file():
            target.unlink()
            removed += 1
    record = {"version": 1, "outputs": {path: {"dependency": dep} for path, (_, dep) in planned.items()}}
    manifest_data = (json.dumps(record, indent=2, sort_keys=True) + "\n").encode()
    if not manifest_path.exists() or manifest_path.read_bytes() != manifest_data:
        write_atomic(manifest_path, manifest_data)
    return {"written": changed, "removed": removed, "total": len(planned)}


def serve(root: Path, output: Path, host: str, port: int) -> None:
    result = build(root, output)
    print(f"Built {result['total']} files ({result['written']} written)")
    stop = threading.Event()

    def watcher() -> None:
        while not stop.wait(0.5):
            try:
                result = build(root, output)
                if result["written"] or result["removed"]:
                    print(f"Rebuilt: {result['written']} written, {result['removed']} removed")
            except (SiteError, OSError) as exc:
                print(f"Build error: {exc}", file=sys.stderr)

    server = ThreadingHTTPServer((host, port), partial(SimpleHTTPRequestHandler, directory=str(output.resolve())))
    thread = threading.Thread(target=watcher, daemon=True)
    thread.start()
    print(f"Serving http://{host}:{server.server_port}/ (Ctrl-C to stop)")
    try:
        server.serve_forever()
    finally:
        stop.set()
        server.server_close()
        thread.join(timeout=2)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Zero-dependency static site generator")
    parser.add_argument("command", choices=("build", "serve"))
    parser.add_argument("--site", type=Path, default=Path("example_site"))
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)
    output = args.output or args.site / "_site"
    try:
        if args.command == "serve":
            serve(args.site, output, args.host, args.port)
        else:
            result = build(args.site, output)
            print(f"Built {result['total']} files: {result['written']} written, {result['removed']} removed")
    except (SiteError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
