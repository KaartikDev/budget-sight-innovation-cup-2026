# Static site generator

`static_site.py` builds a Markdown site with Python 3.10+ and no third-party packages. The bundled example is ready to build:

```sh
python3 static_site.py build --site example_site
python3 static_site.py serve --site example_site --port 8000
```

The build writes `example_site/_site`; open `http://127.0.0.1:8000/` while the server runs. The server rebuilds after source changes (polling every half second) and serves the last successful build if an edit has an error. Use `--output PATH` to choose another output directory and `--host` to change the bind address. Run `python3 static_site.py --help` for CLI options.

## Site layout

```text
site.json                  Site title, description, and public base_url
content/                   Markdown pages and copied assets
templates/page.html        Required page template
templates/tag.html         Optional tag archive template
_site/                     Generated output (do not edit)
```

`site.json` needs `title` and an absolute HTTP(S) `base_url`, which supplies links in `rss.xml`. `description` is optional. Each `.md` file in `content/` becomes an `.html` file at the same relative path. Other files are copied byte for byte. Markdown files need front matter:

```markdown
---
title: A sample post
date: 2026-09-26
tags: Python, Notes
nav_order: 2
template: page.html
---
# Heading

Page text goes here.
```

`title` is required. `date` is optional (`YYYY-MM-DD`) and adds the page to RSS. `tags` is an optional comma-separated list; each tag creates `/tags/<slug>.html`. `nav_order` is an optional integer; only pages with it appear in navigation, sorted by order and title. `template` selects a `.html` file in `templates/`, defaulting to `page.html`. Use `.html` paths for links to other pages.

Supported Markdown: headings, paragraphs, ordered and unordered lists, blockquotes, horizontal rules, fenced code blocks, inline code, emphasis, strong text, links, and images. Inline HTML is escaped. This intentionally small subset does not support full CommonMark syntax or nested lists.

Templates support escaped `{{ page.title }}` variables, raw `{{{ content }}}` output, and `{% for item in site.navigation %}...{% endfor %}` loops (including nested loops). Available objects are `site` (`title`, `description`, `base_url`, `navigation`, `tags`), `page` (front matter plus `url`, `path`, and `tags`), and `content` (rendered HTML). Navigation items have `title` and `url`; tag items have `name` and `url`. Use triple braces only for trusted HTML, such as `content`. A tag archive receives `page.entries` and its generated list in `content`.

The build stores a manifest in the output directory. Unchanged outputs keep their modification times, changed files are replaced atomically, and outputs for deleted source pages or tags are removed. Delete the output directory for a clean rebuild. Build errors include the relevant file where possible and return a nonzero exit code.

Run all tests, including the existing expense tracker tests:

```sh
python3 -m unittest discover -s tests -v
```

## Architecture

`parse_page` validates front matter, `markdown` renders the supported syntax, and `render_template` expands template variables and loops. `build` plans page, tag, RSS, and asset outputs, checks collisions, compares them with the manifest, then writes changes. `serve` uses the standard library HTTP server and a background rebuild loop. These functions can also be imported directly for small integrations or tests.

---

# Expense tracker

A zero-dependency Python CLI for recording expenses in a local JSON file. Requires Python 3.10 or newer.

Run commands from this directory with `python3 expense_tracker.py`. Data defaults to `~/.expense_tracker.json`. Put `--file PATH` before the command to use another JSON file.

```sh
python3 expense_tracker.py add 12.50 Food --date 2026-09-26 --description "Lunch"
python3 expense_tracker.py add 4.25 Transit
python3 expense_tracker.py list
python3 expense_tracker.py list --month 2026-09 --category Food
python3 expense_tracker.py summary monthly
python3 expense_tracker.py summary monthly --year 2026
python3 expense_tracker.py summary category --month 2026-09
python3 expense_tracker.py export expenses.csv
python3 expense_tracker.py delete 1
python3 expense_tracker.py --file ./other-expenses.json list
```

Dates use `YYYY-MM-DD` and default to today when adding an expense. Month filters use `YYYY-MM`. Amounts must be positive with no more than two decimal places. Categories match exactly when filtering. IDs are assigned once and never reused. List and summary commands print `No expenses found.` when no records match. CSV export includes a header even when there are no expenses.

The JSON file is created on the first add. Amounts are stored as decimal strings. Updates and CSV exports are written to temporary files in the destination directory and then atomically replaced. Invalid input or damaged JSON produces an error and leaves the existing data file intact.

Run the test suite:

```sh
python3 -m unittest discover -s tests -v
```
