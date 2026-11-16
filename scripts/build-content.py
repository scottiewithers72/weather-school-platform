#!/usr/bin/env python3
"""Build lesson_content SQL from content/<classId>/w<N>.json.
Usage: python3 scripts/build-content.py content/cw-storms-101/w1.json [...] > out.sql
Media lives in sites/canes/app/media/<classId>/w<N>/ (pic-<word>.jpg, story-*.jpg, start.jpg)."""
import json, sys

LESSON_COUNT = {"cw-storms-101": 4, "cw-hurricane-hunters": 6, "cw-weather-academy": 8}
COMMON = "/app/media/common/"

def payloads(path):
    d = json.load(open(path))
    m, cid, wk = d["media"], d["classId"], d["week"]
    final = wk == LESSON_COUNT.get(cid)
    finish = COMMON + ("finish-graduation.jpg" if final else "finish-week.jpg")
    start = m + d.get("quiz", {}).get("start", "start.jpg")
    out = {}
    sg = d["study_guide"]
    out["study_guide"] = {"title": sg["title"], "rule": sg.get("rule"),
        "pages": [{**p, "img": m + p["img"]} for p in sg["pages"]]}
    out["flashcards"] = {"cards": [{"word": c["word"], "def": c["def"],
        "front": m + f"pic-{c['word'].lower().replace(' ', '-')}.jpg"} for c in d["flashcards"]["cards"]]}
    q = d["quiz"]
    out["quiz"] = {"title": q["title"], "start": start, "finish": finish, "finalWeek": final,
                   "questions": q["questions"], "bonus": q.get("bonus")}
    defs = {c["word"]: c for c in d["flashcards"]["cards"]}
    out["game"] = {"start": start, "finish": finish, "pairs": [
        {"img": m + f"pic-{w.lower().replace(' ', '-')}.jpg", "word": w} for w in d["game"]["words"] if w in defs]}
    return cid, wk, out

def build(path):
    cid, wk, out = payloads(path)
    rows = []
    for kind, payload in out.items():
        js = json.dumps(payload, ensure_ascii=False).replace("'", "''")
        rows.append(f"('{cid}',{wk},'{kind}','{js}'::jsonb)")
    return rows

if __name__ != '__main__':
    raise SystemExit
rows = [r for p in sys.argv[1:] for r in build(p)]
print("INSERT INTO lesson_content (lesson_id, kind, payload)\nSELECT l.id, v.kind, v.payload FROM (VALUES\n"
      + ",\n".join(rows) + "\n) AS v(c,p,kind,payload)\nJOIN lessons l ON l.class_id=v.c AND l.position=v.p\n"
      "ON CONFLICT (lesson_id, kind) DO UPDATE SET payload=EXCLUDED.payload;")
