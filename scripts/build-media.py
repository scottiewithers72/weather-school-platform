#!/usr/bin/env python3
"""Build companion-app media from Scott's course folders (frames from Weather Word videos,
story panels, Class Open start frame). Usage: build-media.py <course-root> <out-root>"""
import os, re, sys, glob, json, subprocess
from PIL import Image
ROOT, OUT = sys.argv[1], sys.argv[2]
CLASSES = {"Cane's Weather Academy": ("cw-weather-academy", "Academy"),
           "Storms 101": ("cw-storms-101", "Storms101"), "Hurricane Hunters": ("cw-hurricane-hunters", "HH")}
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
def save(im, path, w):
    im = im.convert("RGB"); h = int(im.size[1] * w / im.size[0])
    im.resize((w, h), Image.LANCZOS).save(path, "JPEG", quality=80, optimize=True, progressive=True)
def frame(src, t):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", src, "-frames:v", "1", "-q:v", "2", "/tmp/_bm.jpg"], check=True)
    return Image.open("/tmp/_bm.jpg")
def dur(src):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).strip())
opens = glob.glob(ROOT + "/Class Video Opens/*.mp4")
manifest = {}
for cname, (cid, tag) in CLASSES.items():
    for wdir in sorted(glob.glob(f"{ROOT}/{cname}/Week *")):
        wk = int(re.search(r"Week (\d+)", wdir).group(1))
        od = f"{OUT}/{cid}/w{wk}"; os.makedirs(od, exist_ok=True)
        info = {"words": [], "stories": []}
        for v in sorted(glob.glob(wdir + "/Weather Word Videos/*.mp4")):
            word = os.path.splitext(os.path.basename(v))[0]
            p = f"{od}/pic-{slug(word)}.jpg"
            if not os.path.exists(p):
                im = frame(v, max(0, dur(v) - 0.6)); W, H = im.size
                save(im.crop((int(W * .40), int(H * .29), W, H)), p, 760)
            info["words"].append(word)
        for s in sorted(glob.glob(wdir + "/*.jpg") + glob.glob(wdir + "/*.png")):
            b = os.path.splitext(os.path.basename(s))[0]
            if not os.path.exists(f"{od}/{b}.jpg"): save(Image.open(s), f"{od}/{b}.jpg", 1000)
            info["stories"].append(b)
        op = [o for o in opens if f"-{tag}-W{wk}-" in os.path.basename(o)]
        if op and not os.path.exists(f"{od}/start.jpg"): save(frame(op[0], 1), f"{od}/start.jpg", 1100)
        info["start"] = bool(op)
        manifest[f"{cid}/w{wk}"] = info
        print(cid, wk, len(info["words"]), "words", len(info["stories"]), "stories", "start" if op else "NO START", flush=True)
json.dump(manifest, open(f"{OUT}/manifest.json", "w"), indent=1)
