#!/usr/bin/env python3
"""Render the weekend reel from a data file.

Usage:
  python render.py reel_data.json [OUT_DIR] [--fps 30] [--silent]

OUT_DIR defaults to the week folder for the data's "friday" (see paths.py).

Writes to OUT_DIR:
  reel.mp4         1080x1920 H.264 + AAC (original score from make_music.py; --silent skips it)
  score.wav        the soundtrack on its own (swap it or drop it at upload if you prefer)
  thumb_9x16.png   custom thumbnail (frame at thumb_time)
  thumb_4x5.png    same frame cropped to the 4:5 feed window
  qa_phone.png     every scene at real phone size with safe-zone guides
  reel.html        the filled template (silent playable page)
Needs: playwright (chromium), ffmpeg, Pillow, numpy, scipy.
"""
import argparse, json, shutil, subprocess, sys, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE.parent / "assets" / "reel.html"
FEED_TOP, FEED_BOTTOM = 285, 1635     # 4:5 center window of a 1080x1920 frame
REELS_UI_TOP = 1536                    # below this, Reels captions/buttons can cover content
sys.path.insert(0, str(HERE))
from paths import week_dir


def fill_template(data):
    html = TEMPLATE.read_text()
    a, b = html.index("/*REEL_DATA*/"), html.index("/*END_REEL_DATA*/")
    return html[:a] + "/*REEL_DATA*/" + json.dumps(data, ensure_ascii=False) + html[b:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("out", nargs="?")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--silent", action="store_true")
    a = ap.parse_args()
    data = json.loads(Path(a.data).read_text())
    out = Path(a.out) if a.out else week_dir(data.get("friday", "draft")); out.mkdir(parents=True, exist_ok=True)
    if Path(a.data).resolve() != (out / "reel_data.json").resolve():
        (out / "reel_data.json").write_text(json.dumps(data, indent=2, ensure_ascii=False))
    page_path = out / "reel.html"; page_path.write_text(fill_template(data))
    frames = Path(tempfile.mkdtemp(prefix="hwy4_reel_frames_"))

    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1080, "height": 1920})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(page_path.as_uri() + "?export=1"); pg.wait_for_function("window.__ready===true", timeout=30000)
        T = pg.evaluate("window.__duration")
        timing = {"duration": T, "scenes": pg.evaluate("window.__scenes"), "end": pg.evaluate("window.__end")}
        qa_times = pg.evaluate("window.__qaTimes")
        n = round(T * a.fps)
        for i in range(n):
            pg.evaluate(f"window.__seek({i / a.fps})")
            pg.screenshot(path=str(frames / f"f{i:05d}.jpg"), type="jpeg", quality=92)
        pg.evaluate(f"window.__seek({data.get('thumb_time', 3.0)})"); pg.screenshot(path=str(out / "thumb_9x16.png"))
        qa = []
        for t in qa_times:
            pg.evaluate(f"window.__seek({t})"); fp = frames / f"qa_{t:.2f}.png"; pg.screenshot(path=str(fp)); qa.append(fp)
        b.close()
    if errs:
        sys.exit("Page errors:\n" + "\n".join(errs))

    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(a.fps), "-i", str(frames / "f%05d.jpg")]
    if not a.silent:
        import make_music
        wav = out / "score.wav"; make_music.write_wav(wav, make_music.compose(timing))
        cmd += ["-i", str(wav), "-c:a", "aac", "-b:a", "192k", "-shortest"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "slow", "-movflags", "+faststart", str(out / "reel.mp4")]
    subprocess.run(cmd, check=True)
    Image.open(out / "thumb_9x16.png").crop((0, FEED_TOP, 1080, FEED_BOTTOM)).save(out / "thumb_4x5.png")

    # QA sheet: scenes at ~300px phone width in a grid, 4:5 feed window (blue) and Reels UI line (red)
    W = 300; H = round(1920 * W / 1080); s = W / 1080; gap = 14; cols = min(6, len(qa)); rows = -(-len(qa) // cols)
    sheet = Image.new("RGB", (cols * (W + gap) + gap, rows * (H + gap) + gap), "white"); d = ImageDraw.Draw(sheet)
    for k, fp in enumerate(qa):
        x = gap + (k % cols) * (W + gap); y0 = gap + (k // cols) * (H + gap)
        sheet.paste(Image.open(fp).convert("RGB").resize((W, H), Image.LANCZOS), (x, y0))
        for y, c in ((FEED_TOP, "#5a8fa8"), (FEED_BOTTOM, "#5a8fa8"), (REELS_UI_TOP, "#e40014")):
            d.line([(x, y0 + y * s), (x + W, y0 + y * s)], fill=c, width=2)
    sheet.save(out / "qa_phone.png")
    shutil.rmtree(frames, ignore_errors=True)
    print(f"Rendered {T:.1f}s at {a.fps}fps{'' if a.silent else ' with original score'} -> {out}/reel.mp4")


if __name__ == "__main__":
    main()
