// Card Vault: weekly TCDB check. Paste into a www.tcdb.com tab (after its security check has passed).
// It reads the live set list and checklists from the Card Vault site, then for every set:
//   - reads the set's checklist on TCDB (all pages) and its Inserts & Parallels list
//   - notes base cards and insert/parallel sets that Card Vault does not have yet
// Runs in the background: progress in window.cvScan.state; the result in window.cvScan.result
// (also downloaded as cv-tcdb-scan.json when window.cvScan.download is true).
(() => {
  const SITE = 'https://jpantonello.github.io/card-vault/';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const st = {done: 0, total: 0, set: '', error: '', finished: false, blocked: false};
  async function page(url){
    for (let i = 0; i < 6; i++) {
      const r = await fetch(url, {credentials: 'include'});
      const h = await r.text();
      if (r.ok && !/<title>(Um momento|Just a moment)/i.test(h)) { await sleep(1200); return new DOMParser().parseFromString(h, 'text/html'); }
      await sleep(5000 * (i + 1));
    }
    st.blocked = true; throw new Error('TCDB security check or block on ' + url);
  }
  const txt = e => (e ? e.textContent : '').replace(/\s+/g, ' ').trim();
  async function rows(sid, slug){
    const out = [], seen = new Set();
    for (let p = 1; p < 60; p++) {
      const d = await page(`/Checklist.cfm/sid/${sid}/${slug}?PageIndex=${p}`);
      const trs = [...new Set([...d.querySelectorAll(`a[href*="/ViewCard.cfm/sid/${sid}/"]`)].map(a => a.closest('tr')))].filter(Boolean);
      let added = 0;
      for (const tr of trs) {
        const cid = ((tr.querySelector(`a[href*="/ViewCard.cfm/sid/${sid}/cid/"]`) || {}).getAttribute?.('href') || '').match(/cid\/(\d+)/);
        if (!cid || seen.has(cid[1])) continue;
        const cells = [...tr.cells].map(txt).filter(Boolean);
        if (cells.length < 2) continue;
        const team = tr.querySelector('a[href*="/Team.cfm"]') ? cells[cells.length - 1] : '';
        const player = team ? cells.slice(1, -1).join(' ') : cells.slice(1).join(' ');
        seen.add(cid[1]); added++;
        out.push(`${cells[0]}|${player.replace(/\|/g, ' ')}|${team.replace(/\|/g, ' ')}|${cid[1]}`);
      }
      const more = [...d.querySelectorAll('a[href*="PageIndex="]')].some(a => +((a.getAttribute('href') || '').match(/PageIndex=(\d+)/) || [])[1] > p);
      if (!added || !more) break;
    }
    return out.join('\n');
  }
  async function inserts(sid, slug){
    const d = await page(`/Inserts.cfm/sid/${sid}/${slug}`), out = new Map();
    for (const a of d.querySelectorAll('a[href*="/Checklist.cfm/sid/"]')) {
      const m = (a.getAttribute('href') || '').match(/\/Checklist\.cfm\/sid\/(\d+)\/([^/?#]+)/); if (!m || m[1] == sid) continue;
      const tr = a.closest('tr'); if (!tr || !txt(a)) continue;
      const cells = [...tr.cells].map(txt).filter(Boolean);
      const name = txt(a), tags = cells.slice(cells.indexOf(name) + 1).join(' ').replace(new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*'), '')
        .replace(/Serial numbered to (\d+)/ig, 'SN$1').replace(/Serial numbered 1\/1/ig, 'SN1');
      out.set(m[1], `${m[1]}|${name}|${tags}|${m[2]}`);
    }
    return [...out.values()];
  }
  async function run(only){
    const sets = await (await fetch(SITE + 'library/sets.json', {cache: 'no-store'})).json();
    const list = sets.filter(s => /tcdb\.com\/ViewSet\.cfm\/sid\/\d+\/[^/]+/.test(s.url || '') && (!only || only.includes(s.id)));
    st.total = list.length; const result = {made: new Date().toISOString(), sets: []};
    for (const s of list) {
      st.set = s.name; const [, main, slug] = s.url.match(/sid\/(\d+)\/([^/?#]+)/);
      try {
        const cat = await (await fetch(SITE + `library/catalog/${s.id}.json`, {cache: 'no-store'})).json();
        const knownSid = new Set([...cat.cards.map(c => String((c.tcdb || [])[0])), ...(cat.parallels || []).map(p => String(p.sid))]);
        const knownCid = new Set(cat.cards.filter(c => c.tcdb).map(c => String(c.tcdb[1])));
        const ins = await inserts(main, slug);
        const base = await rows(main, slug);
        const newBase = base.split('\n').filter(l => l && !knownCid.has(l.split('|').pop()));
        // TCDB keeps empty placeholder sets for inserts it has not listed yet: only ones with cards count
        const C = {}, newIns = [];
        for (const r of ins) { const [sid, name, , sl] = r.split('|'); if (knownSid.has(sid)) continue;
          const t = await rows(sid, sl); if (t) { C[sid] = t; newIns.push(name); } }
        if (newBase.length || newIns.length) {
          C[main] = base;
          // the inserts the new ones may be colour versions of, so they are grouped under them
          for (const r of ins) { const [sid, name, , sl] = r.split('|'); if (C[sid]) continue;
            if (newIns.some(n => n.startsWith(name + ' '))) C[sid] = await rows(sid, sl); }
          result.sets.push({id: s.id, name: `${s.year} ${s.name}`, main, slug, year: s.year, newBase: newBase.length, newIns, ins, C});
        }
      } catch (e) { st.error += `${s.name}: ${e.message}\n`; if (st.blocked) break; }
      st.done++;
    }
    st.finished = true; window.cvScan.result = result;
    if (window.cvScan.download) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(result)], {type: 'application/json'})); a.download = 'cv-tcdb-scan.json'; a.click(); }
    return result;
  }
  window.cvScan = {state: st, result: null, download: true, run, summary: () => JSON.stringify({...st, found: (window.cvScan.result || {sets: []}).sets.map(s => `${s.name}: +${s.newBase} base, new: ${s.newIns.join(', ')}`)})};
})();
