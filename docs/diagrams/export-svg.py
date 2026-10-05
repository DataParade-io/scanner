#!/usr/bin/env python3
"""Export an archify diagram HTML to light/dark README-ready SVGs and a light PNG.

Usage: export-svg.py docs/diagrams/<name>.html docs/images
Needs Google Chrome (macOS path below). Uses the viewer's own serializeSvg()
export, then drops the embedded fonts (GitHub strips them; the stack falls back
to system monospace) and adds an explicit opaque background.
"""
import html, json, os, re, subprocess, sys, tempfile

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
src, outdir = sys.argv[1:3]
name = os.path.splitext(os.path.basename(src))[0]
h = open(src).read()
h = h.replace("function serializeSvg(", "window.__ser=serializeSvg; function serializeSvg(", 1)
h = h.replace("</body>", """<script>window.addEventListener('load',function(){setTimeout(function(){var o={};try{['light','dark'].forEach(function(t){o[t]=window.__ser(1,{theme:t}).svgString});}catch(e){o.err=String(e)}
var p=document.createElement('pre');p.id='OUT';p.textContent=JSON.stringify(o);document.body.appendChild(p);},1500)});</script></body>""", 1)
tmp = tempfile.mkdtemp()
page = os.path.join(tmp, name + ".html")
open(page, "w").write(h)
r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=6000", "--dump-dom", "file://" + page], capture_output=True, text=True)
m = re.search(r'<pre id="OUT">(.*?)</pre>', r.stdout, re.S)
o = json.loads(html.unescape(m.group(1)))
assert "err" not in o, o
os.makedirs(outdir, exist_ok=True)
for t in ("light", "dark"):
    s = re.sub(r"@font-face\s*\{[^}]*\}", "", o[t])
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"\n\s*\n+", "\n", s)
    s = s.replace('<rect width="100%" height="100%" fill="url(#grid)"/>', '<rect width="100%" height="100%" fill="var(--bg)"/><rect width="100%" height="100%" fill="url(#grid)"/>', 1)
    assert 'fill="var(--bg)"' in s
    path = os.path.join(outdir, f"{name}-{t}.svg")
    open(path, "w").write(s)
    w, hh = re.search(r'width="(\d+)" height="(\d+)"', s).groups()
    if t == "light":
        png = os.path.join(outdir, f"{name}.png")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1.5", f"--window-size={w},{hh}", f"--screenshot={png}", "file://" + os.path.abspath(path)], capture_output=True)
    print(path, len(s))
