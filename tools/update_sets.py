# Adds what the weekly TCDB scan found to the library (only additions: nothing is removed or changed).
#   python3 tools/update_sets.py cv-tcdb-scan.json
# Prints one line per set and writes tools/last-update.json with the summary.
import json, re, sys, os, subprocess, collections, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
scan = json.load(open(sys.argv[1]))
ok = re.compile(r'^[^|\s]\S*\|[^|]*\|[^|]*\|\d+$')
S = json.load(open(f'{ROOT}/library/sets.json'))
summary = []
for s in scan['sets']:
    C = {}
    for sid, t in s['C'].items():          # keep only clean checklist rows, once each
        seen, L = set(), []
        for l in t.split('\n'):
            if ok.match(l) and l.rsplit('|', 1)[1] not in seen: seen.add(l.rsplit('|', 1)[1]); L.append(l)
        C[sid] = '\n'.join(L)
    tmp = tempfile.mkdtemp()
    json.dump({'ins': {'k': s['ins']}, 'C': C}, open(f'{tmp}/exp.json', 'w'), ensure_ascii=False)
    r = subprocess.run(['python3', f'{ROOT}/tools/build_set.py', f'{tmp}/exp.json', f'{tmp}/out.json', json.dumps({'k': [s['id'], f"{s['main']}/{s['slug']}"]})], capture_output=True, text=True)
    if r.returncode: print(s['name'], 'BUILD FAILED', r.stderr[-800:]); continue
    built = json.load(open(f'{tmp}/out.json'))['k']
    for p in built['parallels']: p['name'] = re.sub(r'\s+', ' ', p['name'])
    path = f"{ROOT}/library/catalog/{s['id']}.json"; cur = json.load(open(path))
    have = {tuple(c['tcdb']) for c in cur['cards'] if c.get('tcdb')}
    hp = {p.get('sid') for p in cur.get('parallels', [])}
    nc = [c for c in built['cards'] if c.get('tcdb') and tuple(c['tcdb']) not in have]
    np_ = [p for p in built['parallels'] if p.get('sid') and p['sid'] not in hp]
    # a new colour version of an insert Card Vault already has keeps that insert's name
    subs = {c.get('sub') for c in cur['cards']}
    cur['cards'] += nc; cur.setdefault('parallels', []).extend(np_)
    json.dump(cur, open(path, 'w'), ensure_ascii=False)
    for e in S:
        if e['id'] == s['id']: e['count'] = len(cur['cards'])
    line = {'set': s['name'], 'cards': len(nc), 'bySubset': dict(collections.Counter(c['sub'] for c in nc)),
            'parallels': sorted({p['parent'] + ' ' + p['name'] for p in np_}), 'players': [f"#{c['n']} {c['player']}" for c in nc][:30]}
    summary.append(line); print(json.dumps(line, ensure_ascii=False))
json.dump(S, open(f'{ROOT}/library/sets.json', 'w'), ensure_ascii=False, indent=2)
json.dump(summary, open(f'{ROOT}/tools/last-update.json', 'w'), ensure_ascii=False, indent=1)
