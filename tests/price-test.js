// Price matching test: every saved sale title must still be matched to its card, and every
// sale the app did not count must still be left out. Run before each deploy:
//   node tests/price-test.js            (exit code 1 when a saved sale stops matching)
// Cases come from the real collection (tests/price-cases.json); add hand cases to tests/extra-cases.json.
const { chromium } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), FAKE = path.join(__dirname, 'fake-supabase.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'price-cases.json'), 'utf8'));
const extraF = path.join(__dirname, 'extra-cases.json');
if (fs.existsSync(extraF)) data.cases.push(...JSON.parse(fs.readFileSync(extraF, 'utf8')).map(c => ({...c, hand: true})));
let DB = JSON.stringify({profiles: [{id: 'u1', name: 'Test'}], docs: [], library: []});
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.addInitScript(() => { localStorage.setItem('fakeUser', JSON.stringify({id: 'u1', email: 'a@b.c'})); });
  await ctx.route('**/*', async r => { const u = new URL(r.request().url());
    if (u.hostname === 'cdn.jsdelivr.net') return r.fulfill({body: fs.readFileSync(FAKE), contentType: 'text/javascript'});
    if (u.pathname === '/__db') { if (r.request().method() === 'POST') { DB = r.request().postData(); return r.fulfill({body: 'ok'}); } return r.fulfill({body: DB, contentType: 'application/json'}); }
    if (u.hostname === 'cv.test') { const f = path.join(ROOT, decodeURIComponent(u.pathname.replace(/^\/card-vault\//, '/')).replace(/\/$/, '/index.html'));
      return fs.existsSync(f) ? r.fulfill({body: fs.readFileSync(f), contentType: f.endsWith('.json') ? 'application/json' : 'text/html'}) : r.fulfill({status: 404, body: 'nf'}); }
    return r.fulfill({status: 404, body: ''}); });
  const p = await ctx.newPage(); p.on('pageerror', e => console.log('PAGE ERROR ' + e.message));
  await p.goto('http://cv.test/card-vault/'); await p.waitForTimeout(2500);
  const res = await p.evaluate(async (data) => {
    const lib = await (await fetch('library/sets.json')).json();
    const words = new Map(data.sets.map(s => [s.id, s]));
    sets = lib.map(s => ({...s, ...(words.has(s.id) ? {allowWords: words.get(s.id).allowWords, blockWords: words.get(s.id).blockWords} : {})}));
    await loadAllCatalogs(); globalVers = null;
    return data.cases.map(k => { const r = cardMatch(k.title, k.card, false); return {got: r >= 0, why: r < 0 ? cardMatch.rej : ''}; });
  }, data);
  await b.close();
  const lost = [], gained = [];
  data.cases.forEach((k, i) => { const r = res[i]; if (k.expect && !r.got && !k.known) lost.push({k, r}); if (!k.expect && r.got) gained.push({k, r}); });
  const pos = data.cases.filter(k => k.expect).length;
  console.log(`Price test: ${data.cases.length} sale titles (${pos} that must match, ${data.cases.length - pos} that must not)`);
  for (const {k, r} of lost) console.log(`  STOPPED MATCHING  ${k.card.player} #${k.card.number} ${k.card.set} ${k.card.parallel || ''}\n      "${k.title}"  -> ${r.why}`);
  for (const {k} of gained) console.log(`  NOW MATCHES (was left out: ${k.why})  ${k.card.player} #${k.card.number} ${k.card.set} ${k.card.parallel || ''}\n      "${k.title}"`);
  console.log(lost.length || gained.length ? `${lost.length} stopped matching, ${gained.length} now match` : 'All pass');
  process.exit(lost.length ? 1 : 0);
})();
