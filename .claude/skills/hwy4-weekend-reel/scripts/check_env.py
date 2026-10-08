#!/usr/bin/env python3
"""Check that everything the reel pipeline needs is installed. Prints the fix for anything missing."""
import importlib, shutil, sys

ok = True
def bad(msg, fix):
    global ok; ok = False; print(f"  MISSING  {msg}\n           fix: {fix}")

print("hwy4-weekend-reel environment check")
for mod, pip in (("playwright", "playwright"), ("numpy", "numpy"), ("scipy", "scipy"), ("PIL", "pillow")):
    try: importlib.import_module(mod); print(f"  ok       {mod}")
    except ImportError: bad(mod, f"pip install {pip}")
if shutil.which("ffmpeg"): print("  ok       ffmpeg")
else: bad("ffmpeg", "brew install ffmpeg   (macOS)  |  apt-get install ffmpeg   (Linux)")
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p: p.chromium.launch().close()
    print("  ok       chromium (playwright)")
except Exception as e:
    bad(f"chromium for playwright ({type(e).__name__})", "python -m playwright install chromium")
print("ready" if ok else "fix the items above, then re-run")
sys.exit(0 if ok else 1)
