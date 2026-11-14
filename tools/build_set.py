# Builds a Card Vault catalog from a TCDB export: build_set.py export.json out.json '{"key": ["setId", "sid/slug"]}'
import json, re, sys, unicodedata
src = json.load(open(sys.argv[1]))
INS, C = src['ins'], src['C']
SETS = {k: tuple(v) for k, v in json.loads(sys.argv[3]).items()}
def normNum(s):
  s = re.sub(r'[^A-Z0-9]', '', str(s).upper())
  return re.sub(r'(^|[A-Z])0+(?=\d)', r'\1', s)
def pn(s):
  s = unicodedata.normalize('NFD', s); s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
  return re.sub(r'[^a-z]', '', s.lower())
TAG = re.compile(r'^(RC|AU|SP|SSP|VAR|SN\d+|[A-Z]{2,4}\d*)$')
def parse(line):
  n, ptxt, team, cid = line.split('|')
  note = ''
  m = re.search(r'\b(?:VAR)+:\s*(.*)$', ptxt)
  if m: note = 'Variation: ' + m.group(1).strip(); ptxt = ptxt[:m.start()].rstrip(' ,') + (', VAR' if re.search(r'\s(?:[A-Z]{2,4}\d*|SN\d+)$', ptxt[:m.start()].rstrip(' ,')) else ' VAR')
  tags = []; label = ''
  m = re.search(r'\s((?:[A-Z]{2,4}\d*|SN\d+)(?:,\s*(?:[A-Z]{2,4}\d*|SN\d+))*)([A-Z][a-z].*)?$', ptxt)
  if m and m.group(2) and m.group(1)[-1:].isdigit(): label = m.group(2).strip()
  if m: tags = [t.strip() for t in m.group(1).split(',')]; ptxt = ptxt[:m.start()]
  for L in LABELS:
    if ptxt.endswith(' ' + L): ptxt = ptxt[:-len(L)-1]; label = L
  if label: LABELS.add(label); note = (note + ' · ' if note else '') + label
  return dict(n=n.strip(), player=ptxt.strip(), team=team, tags=tags, note=note, cid=int(cid))
LABELS = set()
# subset labels TCDB glues after the serial tag (e.g. 'SN5Snapshots'); learnt before parsing
for _txt in C.values():
  for _l in _txt.split('\n'):
    _p = _l.split('|')
    if len(_p) > 1:
      _m = re.search(r'SN\d+([A-Z][a-z][A-Za-z ]*)$', _p[1])
      if _m: LABELS.add(_m.group(1).strip())
NOTPAR = re.compile(r'autograph|\bauto|relic|patch|memorabilia|signature|variation|swatch|jersey|booklet|dual|triple|quad|insert|topper|jumbo', re.I)
out = {}
for k, (sid_app, path) in SETS.items():
  main = int(path.split('/')[0])
  subs = []
  for r in INS[k]:
    sid, name, tags, slug = r.split('|')
    # printing plates are kept: they become 1/1 parallels of their insert
    rows = [parse(l) for l in C.get(sid, '').split('\n') if l.strip()]
    if rows: subs.append(dict(sid=int(sid), name=name, tags=tags, rows=rows))
  base = dict(sid=main, name='Base', tags='', rows=[parse(l) for l in C[str(main)].split('\n') if l.strip()])
  def keyset(s): return {(normNum(r['n']), pn(r['player'])) for r in s['rows']}
  base['keys'] = keyset(base)
  inserts, parallels = [base], []
  for s in sorted(subs, key=lambda s: len(s['name'])):
    s['keys'] = keyset(s)
    cands = [p for p in inserts if p is not base and s['name'].startswith(p['name'] + ' ')] + [base]
    parent = None
    for p in sorted(cands, key=lambda p: -len(p['name']) if p is not base else 0):
      suffix = s['name'][len(p['name']):].strip() if p is not base else s['name']
      if NOTPAR.search(suffix): continue
      if len(s['keys'] & p['keys']) >= 0.9 * len(s['keys']):
        parent = p; s['pname'] = suffix; break
    (parallels if parent else inserts).append(s)
    if parent: s['parent'] = parent['name']
  # families that only exist as colour versions (no plain insert on TCDB): group under a virtual parent
  left = [s for s in inserts if s is not base]
  def prefixes(s):
    w = s['name'].split()
    for i in range(2, len(w)):
      P, suf = ' '.join(w[:i]), ' '.join(w[i:])
      if not NOTPAR.search(suf): yield P, suf
  cnt = {}
  for s in left:
    for P, _ in prefixes(s): cnt[P] = cnt.get(P, 0) + 1
  groups = {}
  for s in left:
    best = max(((cnt[P], len(P), P, suf) for P, suf in prefixes(s) if cnt[P] >= 2 and not any(x['name'] == P for x in inserts)), default=None)
    if best: groups.setdefault(best[2], []).append((s, best[3]))
  virt = []
  for P, mem in groups.items():
    if len(mem) < 2: continue
    big = max(mem, key=lambda m: len(m[0]['rows']))[0]
    mem = [(s, suf) for s, suf in mem if len(s['keys'] & big['keys']) >= 0.8 * len(s['keys'])]
    if len(mem) < 2: continue
    rows = {}
    for s, suf in mem:
      for r in s['rows']: rows.setdefault(normNum(r['n']), r)
    virt.append(dict(sid=0, name=P, virt=True, rows=list(rows.values())))
    for s, suf in mem:
      inserts.remove(s); s['parent'] = P; s['pname'] = suf; parallels.append(s)
  inserts += virt
  cards = []
  for s in inserts:
    for r in s['rows']:
      e = dict(n=r['n'], player=r['player'], team=r['team'], rc=('RC' in r['tags'] or 'RR' in r['tags']), sub=s['name'])
      t = [x for x in r['tags'] if not x.startswith('SN')]
      if t: e['tags'] = t
      sn = [x[2:] for x in r['tags'] if x.startswith('SN')]
      notes = [r['note']] if r['note'] else []
      if sn: notes.append('Print run /' + sn[0])
      if notes: e['note'] = ' · '.join(notes)
      if s.get('virt'): e['virt'] = True; e.pop('note', None)
      else: e['tcdb'] = [s['sid'], r['cid']]
      cards.append(e)
  pars = []
  for s in parallels:
    m = re.search(r'SN(\d+)', s['tags'])
    sns = {x for r in s['rows'] for x in r['tags'] if x.startswith('SN')}
    serial = m.group(1) if m else (next(iter(sns))[2:] if len(sns) == 1 else '')
    if m and re.search(r'SN\d+\s+or less', s['tags']): serial += ' or less'   # each card numbered differently (e.g. Aspirations)
    pars.append(dict(sid=s['sid'], parent=s['parent'], name=s['pname'], serial=serial, cards=[[r['n'], r['cid']] for r in s['rows']]))
  out[k] = dict(setId=sid_app, source='TCDB', url='https://www.tcdb.com/ViewSet.cfm/sid/' + path, cards=cards, parallels=pars)
  print(k, 'cards', len(cards), 'inserts', len(inserts), 'parallels', len(pars), 'par cards', sum(len(p['cards']) for p in pars))
  print('  inserts:', ' | '.join(f"{s['name']}{'*' if s.get('virt') else ''} ({len(s['rows'])})" for s in inserts))
  print('  parallels:', ' | '.join(f"{p['parent']}>{p['name']}/{p['serial']}" for p in pars[:400]))
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False)
