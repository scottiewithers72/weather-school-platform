#!/usr/bin/env python3
"""Turn Scott's course markdown (02-Reading, 05-Student-Handout, 06-Quiz) + media manifest into
content/<classId>/w<N>.json. Text is used word for word. Usage: parse-course.py <course-root> <media-root>"""
import os, re, sys, glob, json
ROOT, MEDIA = sys.argv[1], sys.argv[2]
CLASSES = {"Cane's Weather Academy": "cw-weather-academy", "Storms 101": "cw-storms-101", "Hurricane Hunters": "cw-hurricane-hunters"}
man = json.load(open(f"{MEDIA}/manifest.json"))
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower().replace("&", "and")).strip("-")
def md(t):  # markdown inline -> html
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t.strip())
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", t)
    return t
plain = lambda t: re.sub(r"<[^>]+>", "", md(t)).strip()
ASK = re.compile(r"\*\*\(ask!\)\*\*|^>\s*\*\*Ask together\s*—\*\*", re.M)

def reading(path, n_imgs, img_names=None):
    txt = open(path).read()
    parts = txt.split("\n---\n")
    body = parts[1] if len(parts) > 2 else txt
    title = re.search(r'Reading\s*—\s*"(.+?)"', txt)
    rule = re.search(r"\n###\s+(.+)", txt) or re.search(r"Cane's Safety Rule:\*\*\s*(.+)", txt)
    paras = [p.strip() for p in body.split("\n\n") if p.strip()]
    units = []  # (text, ask)
    for p in paras:
        if ASK.search(p):
            before, after = ASK.split(p, 1)
            if before.strip(): units.append([md(before), None])
            a = plain(after)
            if units and units[-1][1] is None: units[-1][1] = a
            else: units.append(["", a])
        else: units.append([md(p), None])
    k = max(1, min(n_imgs, len(units)))
    starts = [round(i * len(units) / k) for i in range(k)]
    if img_names:  # snap each page start to the paragraph that mentions its picture
        SYN = {"evap": ["evapor"], "collect": ["collect"], "goearly": ["go early"], "tv": ["tv", "televis", "news"],
               "rainbands": ["rain band"], "eyewall": ["eyewall"], "dropsonde": ["dropsonde"], "lookup": ["look"],
               "feelsun": ["feel"], "sunsafe": ["sunscreen", "sun hat", "safe"], "whoosh": ["whoosh", "wind"], "storm cloud": ["tall and dark"], "cloud": ["cloud"]}
        for i in range(1, k):
            name = re.sub(r"^(story-\d+-|pic-)", "", img_names[i]).replace("-", " ") if i < len(img_names) else ""
            keys = SYN.get(name, [name[:5]]) if name else []
            lo = starts[i - 1] + 1; hi = len(units) - (k - i - 1)
            hit = next((j for j in range(lo, hi) for kw in keys if kw and kw.lower() in plain(units[j][0] + " " + (units[j][1] or "")).lower()), None)
            starts[i] = hit if hit is not None else max(lo, min(starts[i], hi - 1))
    bounds = starts + [len(units)]
    pages = []
    for i in range(k):
        chunk = units[bounds[i]:bounds[i + 1]]
        pages.append({"text": " ".join(c[0] for c in chunk if c[0]).strip(),
                      "ask": " ".join(c[1] for c in chunk if c[1]) or None})
    return (title.group(1) if title else ""), pages, (plain(rule.group(1)) if rule else None)

def words(path):
    out = {}
    for line in open(path):
        m = re.match(r"^\|\s*\S*\s*\*\*(.+?)\*\*\s*\|\s*—?\s*\|\s*(.+?)\s*\|\s*$", line)
        if m: out[slug(m.group(1))] = (plain(m.group(1)), plain(m.group(2)))
    return out

CH = re.compile(r"(?:^|\s{2,}|\n)\s*([a-d])\)\s*")
def quiz(path):
    txt = open(path).read()
    main, _, key = txt.partition("Answer Key")
    keylines = {int(m.group(1)): m.group(2) for m in re.finditer(r"^(\d+)\.\s*(.+)$", key, re.M)}
    qs = []
    for m in re.finditer(r"^\*\*(\d+)\.\s*(.+?)\*\*(.*?)(?=^\*\*\d+\.|^###|\Z)", main, re.M | re.S):
        n, q, rest = int(m.group(1)), plain(m.group(2)), m.group(3)
        rest = re.sub(r"\n---\s*$", "", rest.strip()).strip()
        note = re.match(r"^\((.+?)\)\s*", rest)
        if note: rest = rest[note.end():]
        kl = keylines.get(n, "")
        if re.search(r"(^|\s)a\)", rest):
            choices = [plain(c) for c in re.split(r"\s*(?:^|\s{2,}|\n)\s*[a-d]\)\s*", " " + rest) if plain(c)]
            km = re.search(r"\b([a-d])\)", kl)
            if not km: continue
            qs.append({"q": q, "choices": choices, "answer": "abcd".index(km.group(1))})
        else:
            choices = [c.strip() for c in re.split(r"\s{2,}", rest.strip()) if c.strip()]
            klp = plain(kl).lower()
            items = [re.sub(r"^\W+", "", x).strip(" .!").lower() for x in re.split(r",|\band\b", re.sub(r"\(.*?\)", "", klp))]
            items = [x for x in items if x]
            ans = [i for i, c in enumerate(choices) if any(re.sub(r"^\W+", "", c).lower().startswith(x) for x in items)]
            if choices and ans: qs.append({"q": q, "multi": True, "choices": choices, "answers": ans})
    # graduation review table
    gr = re.search(r"GRADUATION REVIEW.*?\n(\|.*?)\n\n", main, re.S)
    if gr:
        rows = [r for r in gr.group(1).splitlines() if r.startswith("|") and "---" not in r][1:]
        storms = [plain(r.split("|")[1]) for r in rows]; rules = [plain(r.split("|")[2]) for r in rows]
        km = re.search(r"Graduation Review:\*?\*?\s*(.+)", key)
        if km:
            for pair in km.group(1).split("·"):
                if "→" not in pair: continue
                s, r = [plain(x).strip(" .") for x in pair.split("→")]
                st = next((x for x in storms if s.lower() in x.lower()), s)
                opts = sorted(rules, key=lambda x: x != r)  # correct first; app shuffles
                if r in rules: qs.append({"q": f"🎓 What's the rule for a {st}?", "choices": opts, "answer": 0})
    bonus = None
    bm = re.search(r"###\s*Say-It-Out-Loud Bonus.*?\n+(.+?)\n", main)
    if bm:
        prompt = re.sub(r"\s*\*?\([^)]*\)\*?\s*$", "", bm.group(1)).strip()
        ka = re.search(r"Bonus:\s*(.+)", key)
        ans = plain(ka.group(1)).strip('"“” ') if ka else None
        if not ans:
            pm = re.search(r"\(([^)]*)\)\*?\s*$", bm.group(1)); ans = plain(pm.group(1)) if pm else None
        bonus = {"prompt": plain(prompt), "answer": ans}
    title = re.search(r'Quiz\s*—\s*"(.+?)"', txt)
    return (title.group(1) if title else "What Did You Learn?"), qs, bonus

# Definitions as printed in each Weather Word video (Scott: cards match the videos).
VIDEO_DEFS = {
  "sun": "a star in the sky that emits light and heat energy",
  "cloud": "where rain and storms come from",
  "rain": "water that falls from clouds",
  "snow": "soft white frozen flakes that fall from clouds",
  "wind": "moving air you can feel",
  "precipitation": "water falling as rain, snow, sleet, or hail",
  "forecast": "what the weather will do next",
  "moist-air": "warm air full of water vapor",
  "thunderstorm": "heavy rain and strong wind, with thunder and lightning",
  "hurricane-hunter": "a pilot and scientist who flies into a hurricane",
  "warning": None,  # keep per-class handout wording (two different Warning videos)
  "emergency-kit": "a box of things we need to stay safe",
  "family-plan": "what we do and where we go to be safe",
  "go-early": "leave before the storm, not during it",
}
report = []
for cname, cid in CLASSES.items():
    for wdir in sorted(glob.glob(f"{ROOT}/{cname}/Week *")):
        wk = int(re.search(r"Week (\d+)", wdir).group(1))
        key = f"{cid}/w{wk}"; mi = man[key]
        stories = [s for s in mi["stories"] if s.startswith("story-")] or []
        g = lambda pat: (glob.glob(f"{wdir}/{pat}") or [None])[0]
        wl = words(g("05-Student-Handout-*.md"))
        vids = [slug(w) for w in mi["words"]]
        if not stories:  # no story art: use the word pictures in the order the reading mentions them
            rt = open(g("02-Reading-*.md")).read().lower()
            vids_order = sorted(vids, key=lambda v: (rt.find(v.replace("-", " ")) if v.replace("-", " ") in rt else 9999))
        imgs = [f"{s}.jpg" for s in stories] or [f"pic-{v}.jpg" for v in vids_order]
        if key == "cw-weather-academy/w4":  # Clouds: one picture per cloud the reading introduces
            imgs = ["pic-cloud.jpg", "pic-cumulus.jpg", "pic-stratus.jpg", "pic-cirrus.jpg", "pic-storm-cloud.jpg", "pic-cumulus.jpg"]
        rtitle, pages, rule = reading(g("02-Reading-*.md"), len(imgs), [i[:-4] for i in imgs])
        for i, p in enumerate(pages): p["img"] = imgs[min(i, len(imgs) - 1)]
        cards = []
        for v in vids:
            w, d = wl.get(v, (v.replace("-", " ").title(), None))
            if VIDEO_DEFS.get(v): d = VIDEO_DEFS[v]
            if d: d = d[0].lower() + d[1:] if not d[:2].isupper() else d
            cards.append({"word": w, "def": d})
        qt, qs, bonus = quiz(g("06-Quiz-*.md"))
        game = [c["word"] for c in cards][:6]
        out = {"classId": cid, "week": wk, "media": f"/app/media/{cid}/w{wk}/",
               "study_guide": {"title": rtitle, "pages": pages, "rule": rule},
               "flashcards": {"cards": cards},
               "quiz": {"title": qt, "start": "start.jpg", "questions": qs, "bonus": bonus},
               "game": {"words": game}}
        os.makedirs(f"content/{cid}", exist_ok=True)
        dst = f"content/{cid}/w{wk}.json"
        if os.path.exists(dst) and json.load(open(dst)).get("locked"):
            report.append(f"{key}: locked (hand-edited), skipped"); continue
        json.dump(out, open(dst, "w"), indent=2, ensure_ascii=False)
        missing = [c["word"] for c in cards if not c["def"]]
        report.append(f"{key}: {len(pages)} pages, {len(cards)} cards{' MISSING DEF '+str(missing) if missing else ''}, {len(qs)} quiz Qs, bonus={'y' if bonus and bonus['answer'] else 'NO'}, rule={'y' if rule else 'NO'}")
print("\n".join(report))
