#!/usr/bin/env python3
"""
Build the historical-figure dataset for the game from Wikidata.

Strategy (fast + no filler):
  1. Anchor each query on a specific OCCUPATION (a selective property), and take
     the top-N humans in that occupation ranked by `sitelinks` (the number of
     Wikipedia language editions about them) -- an excellent fame proxy.
  2. Require a geocoded birthplace + birth date. Pull death place/date + image
     + Wikipedia link + description in a second, VALUES-anchored pass.
  3. Merge across occupation buckets, dedupe by QID, keep the richest record,
     and tag each person with every domain bucket they showed up in.

Output: data/figures.json  (sorted by fame, descending)

Pure standard library -- no pip installs required.

Usage:
  python build_dataset.py --verify     # sanity-check occupation QIDs only
  python build_dataset.py              # full build
  python build_dataset.py --top 35 --floor 30
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ENDPOINT = "https://query.wikidata.org/sparql"
UA = "Whence/1.0 dataset builder (https://github.com/JunjoSick/whence)"
OUT = Path(__file__).resolve().parent.parent / "data" / "figures.json"

# Occupation QID -> friendly domain label (used as a fame/hint tag).
# Chosen for domain + era diversity. Verify with --verify.
OCCUPATIONS = {
    "Q169470":  "Physicist",
    "Q170790":  "Mathematician",
    "Q593644":  "Chemist",
    "Q11063":   "Astronomer",
    "Q864503":  "Biologist",
    "Q205375":  "Inventor",
    "Q82594":   "Computer scientist",
    "Q81096":   "Engineer",
    "Q212980":  "Psychologist",
    "Q4964182": "Philosopher",
    "Q201788":  "Historian",
    "Q188094":  "Economist",
    "Q2306091": "Sociologist",
    "Q4773904": "Anthropologist",
    "Q36180":   "Writer",
    "Q49757":   "Poet",
    "Q1930187": "Journalist",
    "Q1028181": "Painter",
    "Q1281618": "Sculptor",
    "Q42973":   "Architect",
    "Q33231":   "Photographer",
    "Q36834":   "Composer",
    "Q177220":  "Singer",
    "Q33999":   "Actor",
    "Q2526255": "Film director",
    "Q82955":   "Politician",
    "Q116":     "Monarch",
    "Q189290":  "Military officer",
    "Q193391":  "Diplomat",
    "Q43845":   "Businessperson",
    "Q40348":   "Lawyer",
    "Q1234713": "Theologian",
    "Q11900058":"Explorer",
    "Q11631":   "Astronaut",
    "Q2095549": "Aviator",
    "Q937857":  "Footballer",
    "Q3665646": "Basketball player",
    "Q10833314":"Tennis player",
    "Q378622":  "Racing driver",
    "Q10873124":"Chess player",
}


def sparql(query, retries=4):
    """POST a SPARQL query, return parsed JSON bindings list."""
    data = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    req = urllib.request.Request(
        ENDPOINT, data=data,
        headers={
            "User-Agent": UA,
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=70) as resp:
                payload = json.load(resp)
            return payload["results"]["bindings"]
        except Exception as e:  # noqa: BLE001 - network is flaky, just retry
            last = e
            wait = 2 * (attempt + 1)
            print(f"    ! query failed ({e}); retry in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"SPARQL failed after {retries} tries: {last}")


def verify_occupations():
    qids = " ".join(f"wd:{q}" for q in OCCUPATIONS)
    q = f"""SELECT ?occ ?occLabel WHERE {{
      VALUES ?occ {{ {qids} }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language \"en\". }}
    }}"""
    rows = sparql(q)
    got = {r["occ"]["value"].split("/")[-1]: r["occLabel"]["value"] for r in rows}
    print(f"{'QID':<11} {'expected':<22} actual")
    print("-" * 60)
    ok = True
    for qid, expected in OCCUPATIONS.items():
        actual = got.get(qid, "*** MISSING ***")
        flag = "" if actual.lower() == expected.lower() or qid not in got else ""
        mismatch = "  <-- CHECK" if (qid not in got) else ""
        # loose check: print both so a human can eyeball
        print(f"{qid:<11} {expected:<22} {actual}{mismatch}")
        if qid not in got:
            ok = False
    print("\nOK" if ok else "\nSome QIDs returned no label -- check above.")


def top_people_for_occupation(qid, top):
    """Pass 1: top-N person QIDs in an occupation with geocoded birth + date."""
    q = f"""SELECT ?person ?sitelinks WHERE {{
      ?person wdt:P106 wd:{qid} ;
              wdt:P31 wd:Q5 ;
              wdt:P569 ?b ;
              wdt:P19 ?bp ;
              wikibase:sitelinks ?sitelinks .
      ?bp wdt:P625 ?c .
    }} ORDER BY DESC(?sitelinks) LIMIT {top}"""
    out = []
    for r in sparql(q):
        out.append((r["person"]["value"].split("/")[-1], int(r["sitelinks"]["value"])))
    return out


POINT_RE = re.compile(r"Point\(([-0-9.eE]+)\s+([-0-9.eE]+)\)")


def parse_point(wkt):
    m = POINT_RE.search(wkt)
    if not m:
        return None
    lng, lat = float(m.group(1)), float(m.group(2))
    return lat, lng


def parse_year(iso):
    try:
        neg = iso.startswith("-")
        body = iso[1:] if neg else iso
        yr = int(body.split("-")[0])
        return -yr if neg else yr
    except (ValueError, AttributeError):
        return None  # "unknown value" blank nodes, malformed dates


def fetch_details(qids):
    """Pass 2: rich record for a batch of person QIDs."""
    values = " ".join(f"wd:{q}" for q in qids)
    q = f"""SELECT ?person ?personLabel ?personDescription ?birth ?bpLabel ?bpcoord
                   ?death ?dpLabel ?dpcoord ?img ?article ?genderLabel WHERE {{
      VALUES ?person {{ {values} }}
      ?person wdt:P569 ?birth ; wdt:P19 ?bp .
      ?bp wdt:P625 ?bpcoord .
      OPTIONAL {{ ?person wdt:P570 ?death. }}
      OPTIONAL {{ ?person wdt:P20 ?dp. ?dp wdt:P625 ?dpcoord. }}
      OPTIONAL {{ ?person wdt:P18 ?img. }}
      OPTIONAL {{ ?person wdt:P21 ?gender. }}
      OPTIONAL {{ ?article schema:about ?person ; schema:isPartOf <https://en.wikipedia.org/>. }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language \"en\". }}
    }}"""
    rows = sparql(q)
    merged = {}
    for r in rows:
        qid = r["person"]["value"].split("/")[-1]
        rec = merged.get(qid)
        if rec is None:
            rec = merged[qid] = {"id": qid}
        # First-write-wins for single-valued fields.
        if "name" not in rec and "personLabel" in r:
            rec["name"] = r["personLabel"]["value"]
        if "desc" not in rec and "personDescription" in r:
            rec["desc"] = r["personDescription"]["value"]
        if "birthYear" not in rec and r.get("birth", {}).get("type") == "literal":
            y = parse_year(r["birth"]["value"])
            if y is not None:
                rec["birthYear"] = y
        if "birthPlace" not in rec and "bpLabel" in r:
            rec["birthPlace"] = r["bpLabel"]["value"]
        if "bcoord" not in rec and "bpcoord" in r:
            p = parse_point(r["bpcoord"]["value"])
            if p:
                rec["birthLat"], rec["birthLng"] = p
                rec["bcoord"] = True
        if "deathYear" not in rec and r.get("death", {}).get("type") == "literal":
            y = parse_year(r["death"]["value"])
            if y is not None:
                rec["deathYear"] = y
        if "deathPlace" not in rec and "dpLabel" in r:
            rec["deathPlace"] = r["dpLabel"]["value"]
        if "dcoord" not in rec and "dpcoord" in r:
            p = parse_point(r["dpcoord"]["value"])
            if p:
                rec["deathLat"], rec["deathLng"] = p
                rec["dcoord"] = True
        if "image" not in rec and "img" in r:
            url = r["img"]["value"].replace("http://", "https://")
            rec["image"] = url + ("&" if "?" in url else "?") + "width=600"
        if "gender" not in rec and "genderLabel" in r:
            g = r["genderLabel"]["value"].lower()
            rec["gender"] = "F" if "female" in g or g == "trans woman" else ("M" if "male" in g else "?")
        if "wiki" not in rec and "article" in r:
            rec["wiki"] = r["article"]["value"]
    return merged


# ---- recognizability: English Wikipedia pageviews -------------------------
# sitelinks measure academic breadth; pageviews measure who people actually look
# up. We rank the default pools by views so household names lead and regional
# academic notables (e.g. Russian poets) sink to a "deep cuts" tail.
PV_BASE = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
           "en.wikipedia/all-access/all-agents/{title}/monthly/{start}/{end}")
PV_START, PV_END = "20250501", "20260501"  # trailing 12 months


def fetch_pageviews(title):
    url = PV_BASE.format(title=title, start=PV_START, end=PV_END)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            return sum(it.get("views", 0) for it in data.get("items", []))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 0  # article has no pageview record
            if e.code == 429:
                time.sleep(1.5 * (attempt + 1))  # throttled — back off
                continue
            return 0
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    return 0


def enrich_pageviews(figures):
    import concurrent.futures
    todo = [(f, f["wiki"].split("/wiki/")[-1]) for f in figures if f.get("wiki")]
    print(f"Pageviews: fetching trailing-12mo views for {len(todo)} articles")
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(fetch_pageviews, title): f for f, title in todo}
        for fut in concurrent.futures.as_completed(futs):
            futs[fut]["views"] = fut.result()
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(todo)}")
    for f in figures:
        f.setdefault("views", 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true", help="check occupation QIDs and exit")
    ap.add_argument("--enrich", action="store_true", help="add pageviews to existing figures.json and re-sort")
    ap.add_argument("--top", type=int, default=40, help="top-N people per occupation")
    ap.add_argument("--floor", type=int, default=28, help="minimum sitelinks to keep")
    ap.add_argument("--batch", type=int, default=50, help="QIDs per detail query")
    args = ap.parse_args()

    if args.verify:
        verify_occupations()
        return

    if args.enrich:
        figures = json.loads(OUT.read_text(encoding="utf-8"))
        enrich_pageviews(figures)
        figures.sort(key=lambda f: (f.get("views", 0), f.get("fame", 0)), reverse=True)
        OUT.write_text(json.dumps(figures, ensure_ascii=False, indent=0), encoding="utf-8")
        nz = sum(1 for f in figures if f.get("views", 0) > 0)
        print(f"\nEnriched {len(figures)} figures ({nz} with views) -> {OUT}")
        print("Top 12 by pageviews:")
        for f in figures[:12]:
            print(f"  {f.get('views', 0):>9,} | {f['name']}")
        return

    # Pass 1: collect top people per occupation, tag domains, track best fame.
    fame = {}
    domains = {}
    print(f"Pass 1: top {args.top} per occupation across {len(OCCUPATIONS)} domains")
    for qid, label in OCCUPATIONS.items():
        try:
            people = top_people_for_occupation(qid, args.top)
        except Exception as e:  # noqa: BLE001
            print(f"  {label:<20} FAILED: {e}", file=sys.stderr)
            continue
        for pid, sl in people:
            fame[pid] = max(fame.get(pid, 0), sl)
            domains.setdefault(pid, set()).add(label)
        print(f"  {label:<20} {len(people):>3} people")
        time.sleep(0.4)

    all_ids = [pid for pid, sl in fame.items() if sl >= args.floor]
    print(f"\nUnique people (sitelinks >= {args.floor}): {len(all_ids)}")

    # Pass 2: fetch details in batches.
    print(f"Pass 2: details in batches of {args.batch}")
    records = {}
    for i in range(0, len(all_ids), args.batch):
        batch = all_ids[i:i + args.batch]
        try:
            recs = fetch_details(batch)
        except Exception as e:  # noqa: BLE001
            print(f"  batch {i//args.batch} FAILED: {e}", file=sys.stderr)
            continue
        records.update(recs)
        print(f"  batch {i//args.batch + 1}: +{len(recs)} (total {len(records)})")
        time.sleep(0.5)

    # Assemble final list: must have birth coords + year + name.
    figures = []
    for pid, rec in records.items():
        if not rec.get("bcoord") or "birthYear" not in rec or "name" not in rec:
            continue
        if rec["name"].startswith("Q") and rec["name"][1:].isdigit():
            continue  # no English label -> skip
        out = {
            "id": pid,
            "name": rec["name"],
            "birthYear": rec["birthYear"],
            "birthPlace": rec.get("birthPlace"),
            "birthLat": round(rec["birthLat"], 4),
            "birthLng": round(rec["birthLng"], 4),
            "occupations": sorted(domains.get(pid, [])),
            "fame": fame.get(pid, 0),
        }
        if rec.get("dcoord") and "deathYear" in rec:
            out["deathYear"] = rec["deathYear"]
            out["deathPlace"] = rec.get("deathPlace")
            out["deathLat"] = round(rec["deathLat"], 4)
            out["deathLng"] = round(rec["deathLng"], 4)
        elif "deathYear" in rec:
            out["deathYear"] = rec["deathYear"]  # known dead, place unknown
        for k in ("image", "wiki", "desc", "gender"):
            if rec.get(k):
                out[k] = rec[k]
        figures.append(out)

    enrich_pageviews(figures)
    figures.sort(key=lambda f: (f.get("views", 0), f["fame"]), reverse=True)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(figures, ensure_ascii=False, indent=0), encoding="utf-8")

    with_death = sum(1 for f in figures if "deathLat" in f)
    with_img = sum(1 for f in figures if "image" in f)
    print(f"\nWrote {len(figures)} figures -> {OUT}")
    print(f"  with death location: {with_death}")
    print(f"  with image:         {with_img}")
    print("  fame range:", figures[-1]["fame"], "..", figures[0]["fame"])
    print("\nTop 12:")
    for f in figures[:12]:
        d = f.get("deathYear", "alive")
        print(f"  {f['fame']:>3} | {f['name']} ({f['birthYear']}-{d}) {'/'.join(f['occupations'][:2])}")


if __name__ == "__main__":
    main()
