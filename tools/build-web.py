#!/usr/bin/env python3
"""Builds the single-file UI (build/web/index.html) used by both apps: inlines style.css and the scripts and bundles
the MYSUITE app list. The list is refreshed from /workspace/mysuite/mysuite-apps.json when that exists (copy kept in
tools/brand/mysuite-apps.json), so every build carries the current central list."""
import datetime, json, os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
CENTRAL = "/workspace/mysuite/mysuite-apps.json"
COPY = os.path.join(ROOT, "tools", "brand", "mysuite-apps.json")

def main():
    if os.path.exists(CENTRAL):
        shutil.copyfile(CENTRAL, COPY)
    apps = json.load(open(COPY, encoding="utf-8"))
    apps["bundled"] = datetime.date.today().strftime("%d.%m.%Y")
    js = "window.MYSUITE_APPS = " + json.dumps(apps, ensure_ascii=False) + ";\n"
    open(os.path.join(WEB, "suite-apps.js"), "w", encoding="utf-8").write(js)
    html = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
    css = open(os.path.join(WEB, "style.css"), encoding="utf-8").read()
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "</style>")
    for name in ("suite-apps.js", "core.js", "sync.js", "native.js", "app.js"):
        src = open(os.path.join(WEB, name), encoding="utf-8").read()
        assert "</script" not in src, name
        html = html.replace('<script src="%s"></script>' % name, "<script>\n" + src + "</script>")
    assert 'src="' not in html and 'href="style' not in html
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "build", "web", "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(html)
    print("web ui:", out, len(html), "bytes,", len(apps["apps"]), "suite apps")

if __name__ == "__main__":
    main()
