// Card Vault: export a whole TCDB set (checklist + every insert/parallel) for tools/build_set.py.
// Paste in a www.tcdb.com tab, then: __exp(sid, slug, key); poll __st until finished; it downloads cv<key>-export.json
(() => { const sleep = ms => new Promise(r => setTimeout(r, ms)); const st = window.__st = {done:0,total:0,blocked:false,finished:false,err:''};
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

  window.__exp = async (sid, slug, key) => { const ins = await inserts(sid, slug); st.total = ins.length + 1; const C = {};
    C[sid] = await rows(sid, slug); st.done++;
    for (const r of ins) { const [s2,, , sl] = r.split('|'); try { C[s2] = await rows(s2, sl); } catch(e) { st.err += e.message + '\n'; if (st.blocked) break; } st.done++; }
    const out = {ins: {[key]: ins}, C}; window.__out = out; st.finished = true;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], {type: 'application/json'})); a.download = 'cv' + key + '-export.json'; document.body.appendChild(a); a.click(); };
})();
