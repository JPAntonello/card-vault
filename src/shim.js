/* Card Vault online: the app's "/api/..." server calls are answered here, from Supabase (data, photos)
   and from this site's library folder (sets and checklists). The app itself is unchanged and starts
   after the person has logged in. */
(()=>{
const SB_URL = "https://xqtzocgsmcnhlqenjefa.supabase.co";
const SB_KEY = "sb_publishable_03txPDqVwKymwIYch8_QVw_io7z-D0X";
const PUB = SB_URL + "/storage/v1/object/public/photos/";
const BUCKET = "photos";
const origFetch = window.fetch.bind(window);
let sb = null, uid = "", email = "", prof = null, started = false;
const $$ = s => document.querySelector(s);
const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- photo addresses ---------- */
function h32(s, seed){ let h = seed >>> 0; for(let i=0;i<s.length;i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h.toString(36); }
const lowP = p => String(p||"").normalize("NFC").replace(/\\/g,"/").replace(/^\/+/,"").toLowerCase();
const pathKey = p => { const s = lowP(p); return h32(s, 2166136261) + h32(s, 0x9747b28c) + s.length.toString(36); };
const drivePath = p => uid + "/d/" + pathKey(p) + ".jpg";
const photoPath = id => uid + "/p/" + id + ".jpg";
window.cvDriveUrl = p => /^https?:\/\//.test(p) ? p : PUB + drivePath(p);
window.cvPhotoUrl = (id, v) => PUB + photoPath(id) + "?v=" + encodeURIComponent(v||"");
let shareIndex = {};          // photo key -> storage path (mine and friends')
let shareMap = {};            // mine only, kept in my snapshot
window.cvSharedUrl = k => shareIndex[k] ? PUB + shareIndex[k] : "";

/* ---------- small helpers ---------- */
const J = (o, s=200) => new Response(JSON.stringify(o), {status:s, headers:{"Content-Type":"application/json"}});
const T = (t, s) => new Response(t, {status:s, headers:{"Content-Type":"text/plain"}});
const N = () => new Response(null, {status:204});
const chk = r => { if(r.error) throw new Error(r.error.message || String(r.error)); return r.data; };
const isoDay = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*6e4).toISOString().slice(0,10); };
async function bodyText(b){ if(b == null) return ""; if(typeof b === "string") return b; if(b instanceof Blob) return await b.text(); return String(b); }

/* ---------- this browser's copy (IndexedDB): opening only downloads what changed ---------- */
const idb = (() => { let p = null; const open = () => p || (p = new Promise((res) => { try{ const r = indexedDB.open("cardvault", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }catch{ res(null); } }));
  const tx = async (mode, fn) => { const db = await open(); if(!db) return null; return new Promise(res => { try{ const t = db.transaction("kv", mode), q = fn(t.objectStore("kv")); t.oncomplete = () => res(q && q.result); t.onerror = () => res(null); }catch{ res(null); } }); };
  return { get: k => tx("readonly", s => s.get(k)), set: (k, v) => tx("readwrite", s => s.put(v, k)) }; })();
let saveT = 0;
const keepLocal = () => { clearTimeout(saveT); saveT = setTimeout(() => { if(uid) idb.set("cache:" + uid, {docCache, snapCache, libCache}).catch(()=>{}); }, 1500); };
async function loadLocal(){ try{ const v = await idb.get("cache:" + uid); if(v){ Object.assign(docCache, v.docCache || {}); Object.assign(snapCache, v.snapCache || {}); if(v.libCache) libCache = v.libCache; } }catch{} }

/* ---------- documents (cards, sources, wants, history, images, snapshot, backups) ---------- */
const docCache = {};   // name -> {at, body}
async function getDoc(name, fallback){
  const meta = chk(await sb.from("docs").select("updated_at").eq("user_id", uid).eq("name", name).maybeSingle());
  if(!meta) return fallback;
  const c = docCache[name];
  if(c && c.at === meta.updated_at) return c.body;
  const row = chk(await sb.from("docs").select("body,updated_at").eq("user_id", uid).eq("name", name).maybeSingle());
  if(!row) return fallback;
  docCache[name] = {at: row.updated_at, body: row.body}; if(!/^bk-/.test(name)) keepLocal();
  return row.body;
}
async function putDoc(name, body){
  const at = new Date().toISOString();
  chk(await sb.from("docs").upsert({user_id: uid, name, body, updated_at: at}));
  if(/^bk-|^before-restore$/.test(name)) return;
  docCache[name] = {at, body}; keepLocal();
}

/* ---------- the set library: this site's library/sets.json + changes saved in Supabase ---------- */
let repoSets = null, libCache = null;
async function repoSetList(){
  if(!repoSets){ try{ const r = await origFetch("library/sets.json?v=" + BUILD); repoSets = r.ok ? await r.json() : []; }catch{ repoSets = []; } }
  return Array.isArray(repoSets) ? repoSets : [];
}
async function libRow(){
  const meta = chk(await sb.from("library").select("updated_at").eq("id","sets").maybeSingle());
  if(!meta) return null;
  if(libCache && libCache.at === meta.updated_at) return libCache.body;
  const row = chk(await sb.from("library").select("body,updated_at").eq("id","sets").maybeSingle());
  libCache = row ? {at: row.updated_at, body: row.body} : null; keepLocal();
  return libCache ? libCache.body : null;
}
async function getSets(){
  const base = await repoSetList(), b = await libRow();
  if(!b) return base;
  const list = Array.isArray(b) ? b : (b.list || []), removed = new Set(b.removed || []), have = new Set(list.map(s=>s.id));
  return [...list, ...base.filter(s => !have.has(s.id) && !removed.has(s.id))];
}
async function putSets(list){
  const b = await libRow(), cur = await getSets(), ids = new Set(list.map(s=>s.id));
  const removed = new Set((b && b.removed) || []);
  for(const s of cur) if(!ids.has(s.id)) removed.add(s.id);
  for(const id of ids) removed.delete(id);
  const body = {list, removed:[...removed]}, at = new Date().toISOString();
  chk(await sb.from("library").upsert({id:"sets", body, updated_at: at}));
  libCache = {at, body};
}

/* ---------- photos list (the old "images folder") ---------- */
let images = null, imagesSet = new Set(), imgTimer = 0;
async function loadImages(){ images = await getDoc("images", []); if(!Array.isArray(images)) images = []; imagesSet = new Set(images.map(lowP)); }
function addImage(p){ if(imagesSet.has(lowP(p))) return; images.push(p); imagesSet.add(lowP(p)); clearTimeout(imgTimer); imgTimer = setTimeout(()=>putDoc("images", images).catch(e=>console.warn("images list", e)), 1500); }
async function saveImagesNow(){ clearTimeout(imgTimer); await putDoc("images", images); }
async function upload(path, blob){
  chk(await sb.storage.from(BUCKET).upload(path, blob, {upsert:true, contentType:"image/jpeg", cacheControl:"3600"}));
}
// photos are made smaller before they go online (max 1000 px, JPEG)
async function shrink(file, max=1000){
  try{
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if(k === 1 && file.type === "image/jpeg" && file.size < 300000){ bmp.close && bmp.close(); return file; }
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width*k); cv.height = Math.round(bmp.height*k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close && bmp.close();
    return await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("photo could not be read")), "image/jpeg", 0.85));
  }catch(e){ if(file.type === "image/jpeg") return file; throw e; }
}

/* ---------- friends ---------- */
let snapCache = {};   // user_id -> {at, body}
async function allSnapshots(){
  const metas = chk(await sb.from("docs").select("user_id,updated_at").eq("name","snapshot"));
  const need = metas.filter(m => !snapCache[m.user_id] || snapCache[m.user_id].at !== m.updated_at).map(m => m.user_id);
  if(need.length){
    const rows = chk(await sb.from("docs").select("user_id,body,updated_at").eq("name","snapshot").in("user_id", need));
    for(const r of rows) snapCache[r.user_id] = {at: r.updated_at, body: r.body};
    keepLocal();
  }
  const keep = new Set(metas.map(m=>m.user_id)); for(const k in snapCache) if(!keep.has(k)) delete snapCache[k];
  shareIndex = {};
  for(const k in snapCache){ const p = (snapCache[k].body || {}).photos || {}; for(const pk in p) if(!(pk in shareIndex) || k === uid) shareIndex[pk] = p[pk]; }
  Object.assign(shareIndex, shareMap);
  return snapCache;
}

/* ---------- backup: a copy of my lists once a day; the 2 newest are kept ---------- */
let bkInfo = {last:"", error:""};
async function backupList(){
  const rows = chk(await sb.from("docs").select("name,updated_at").eq("user_id", uid).like("name", "bk-%"));
  return rows.sort((a,b)=> a.name < b.name ? 1 : -1);
}
async function ensureBackup(force){
  try{
    const day = isoDay(), name = "bk-" + day, list = await backupList();
    if(!force && list.some(r => r.name === name)){ bkInfo.last = fmtAt(list.find(r=>r.name===name).updated_at); return; }
    const body = {};
    for(const n of ["cards","sources","wants","history"]){ const v = await getDoc(n, null); if(v) body[n] = v; }
    if(!body.cards || !body.cards.length) return;      // nothing to keep yet
    body.size = JSON.stringify(body).length;
    await putDoc(name, body);
    const old = (await backupList()).slice(2).map(r=>r.name);   // today's copy and the one before it are kept
    if(old.length) chk(await sb.from("docs").delete().eq("user_id", uid).in("name", old));
    bkInfo = {last: fmtAt(new Date().toISOString()), error:""};
  }catch(e){ bkInfo.error = e.message; }
}
const fmtAt = s => { const d = new Date(s); return isNaN(d) ? String(s||"") : new Date(d.getTime() - d.getTimezoneOffset()*6e4).toISOString().slice(0,16).replace("T"," "); };

/* ---------- the "/api/..." answers ---------- */
const NOT_ONLINE = {ok:false, error:"Not available in the online version."};
async function api(url, method, rawBody){
  const u = new URL(url, location.href), p = u.pathname.replace(/^.*?\/api\//, "/api/");
  let m;
  if((m = p.match(/^\/api\/(cards|history|sources|wants)$/))){
    if(method === "GET") return J(await getDoc(m[1], []) || []);
    if(method === "PUT"){ const list = JSON.parse(await bodyText(rawBody)); if(!Array.isArray(list)) return T("Expected a list.", 400); await putDoc(m[1], list); return N(); }
  }
  if(p === "/api/sets"){
    if(method === "GET") return J(await getSets());
    if(method === "PUT"){ const list = JSON.parse(await bodyText(rawBody)); if(!Array.isArray(list)) return T("Expected a list.", 400); await putSets(list); return N(); }
  }
  if((m = p.match(/^\/api\/catalog\/([A-Za-z0-9_-]{1,64})$/))){
    const id = m[1];
    if(method === "GET"){ const r = await origFetch("library/catalog/" + id + ".json?v=" + BUILD); return r.ok ? J(await r.json()) : T("Not found", 404); }
    if(method === "DELETE"){
      const snaps = await allSnapshots(), users = [];
      for(const k in snaps){ if(k === uid) continue; const b = snaps[k].body || {}; if((b.cards||[]).some(c => c.setId === id)) users.push(b.name || "a friend"); }
      return users.length ? T("Still used by " + users.join(", "), 409) : N();
    }
  }
  if(p === "/api/me") return J({name: (prof && prof.name) || email.split("@")[0], shared: true, sharedDir: "online"});
  if(p === "/api/images"){ if(!images) await loadImages(); return J({ok:true, dir:"Card Vault online", files: images}); }
  if((m = p.match(/^\/api\/photos\/([A-Za-z0-9_-]{1,64})$/))){
    if(method === "PUT"){ const b = rawBody instanceof Blob ? rawBody : new Blob([rawBody], {type:"image/jpeg"}); await upload(photoPath(m[1]), b); return N(); }
    if(method === "DELETE"){ await sb.storage.from(BUCKET).remove([photoPath(m[1])]); return N(); }
  }
  if(p === "/api/snapshot" && method === "PUT"){
    const o = JSON.parse(await bodyText(rawBody)); o.photos = shareMap; await putDoc("snapshot", o);
    if(snapCache[uid]) snapCache[uid] = {at: docCache.snapshot.at, body: o};
    return N();
  }
  if(p === "/api/friends"){ const s = await allSnapshots(); return J(Object.keys(s).filter(k => k !== uid).map(k => s[k].body).filter(b => b && b.name)); }
  if(p === "/api/shared-photos"){ if(!Object.keys(snapCache).length) await allSnapshots(); return J(Object.keys(shareIndex)); }
  if(p === "/api/share-photo"){
    const q = JSON.parse(await bodyText(rawBody) || "{}");
    if(!/^[A-Za-z0-9_-]{1,160}$/.test(String(q.key||""))) return J({ok:false, error:"Bad photo key."});
    if(!images) await loadImages();
    const path = q.photo && /^[A-Za-z0-9_-]{1,64}$/.test(q.photo) ? photoPath(q.photo) : q.image && imagesSet.has(lowP(q.image)) ? drivePath(q.image) : "";
    if(!path) return J({ok:false, error:"Photo file not found."});
    shareMap[q.key] = path; shareIndex[q.key] = path;
    return J({ok:true});
  }
  if(p === "/api/unshare"){
    const q = JSON.parse(await bodyText(rawBody) || "{}");
    for(const k of q.keys || []){ delete shareMap[k]; delete shareIndex[k]; }
    return J({ok:true});
  }
  if(p === "/api/use-shared-photo"){
    const q = JSON.parse(await bodyText(rawBody) || "{}"), src = shareIndex[q.key];
    if(!src) return J({ok:false, error:"Not shared."});
    if(!images) await loadImages();
    let name = String(q.file || q.key).replace(/\.(jpe?g|png|webp)$/i, "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140).trim() + ".jpg";
    if(!imagesSet.has(lowP(name))){
      const r = await sb.storage.from(BUCKET).copy(src, drivePath(name));
      if(r.error && !/exist/i.test(r.error.message||"")) return J({ok:false, error: r.error.message});
      addImage(name);
    }
    return J({ok:true, file:name});
  }
  if(p === "/api/price-inbox"){
    if(method === "POST"){
      const q = JSON.parse(await bodyText(rawBody) || "{}"), ids = (q.names || []).map(Number).filter(Boolean);
      if(ids.length) chk(await sb.from("inbox").delete().in("id", ids));
      return N();
    }
    const rows = chk(await sb.from("inbox").select("id,data").order("id"));
    return J(rows.map(r => ({name: String(r.id), data: r.data})));
  }
  if(p === "/api/backup"){ if(method === "POST") await ensureBackup(true); return J({enabled:true, dir:"online, the 2 latest copies", last: bkInfo.last, error: bkInfo.error}); }
  if(p === "/api/backups"){
    const rows = await backupList(), list = [];
    for(const r of rows){ const d = r.name.slice(3); list.push({name: "card-vault-" + d + ".zip", at: fmtAt(r.updated_at), size: 0}); }
    return J({list});
  }
  if(p === "/api/restore"){
    try{
      const q = JSON.parse(await bodyText(rawBody) || "{}"), d = String(q.name||"").match(/(\d{4}-\d{2}-\d{2})/);
      if(!d) throw new Error("Bad backup name.");
      const b = await getDoc("bk-" + d[1], null); if(!b) throw new Error("Backup not found.");
      const before = {}; for(const n of ["cards","sources","wants","history"]){ const v = await getDoc(n, null); if(v) before[n] = v; }
      if(before.cards) await putDoc("before-restore", before);
      const done = []; for(const n of ["cards","sources","wants","history"]) if(b[n]){ await putDoc(n, b[n]); done.push(n + ".json"); }
      return J({ok:true, restored: done});
    }catch(e){ return J({ok:false, error:e.message}); }
  }
  if(p === "/api/ebay-specs") return T("Not found", 404);
  if(/^\/api\/(tcdb-image|find-photo|save-image|save-photo|find-price)$/.test(p)) return J(NOT_ONLINE);
  return T("Not found", 404);
}
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input && input.url) || "";
  if(/^\/api\//.test(url) || (url.startsWith(location.origin) && /\/api\//.test(url.slice(location.origin.length)))){
    if(!uid) return T("Not logged in", 401);
    try{ return await api(url, String((init && init.method) || "GET").toUpperCase(), init && init.body); }
    catch(e){ console.error("Card Vault online:", url, e); return T(String((e && e.message) || e), 500); }
  }
  return origFetch(input, init);
};

/* ---------- what the bookmarks send from TCDB and 130point (instead of downloading files) ---------- */
const okOrigin = o => { try{ return /(^|\.)(tcdb|130point|sportscardspro)\.com$/.test(new URL(o).hostname); }catch{ return false; } };
let linkT = 0, inboxT = 0, photoQ = Promise.resolve(), photosIn = 0;
const later = (t, fn, ms) => { clearTimeout(t); return setTimeout(fn, ms); };
addEventListener("message", e => {
  if(!okOrigin(e.origin) || !uid) return;
  const d = e.data || {};
  if(d.cv === "hello"){ try{ e.source.postMessage({cv:"ack"}, e.origin); }catch{} return; }
  if(d.cv === "prices" && d.data){
    sb.from("inbox").insert({user_id: uid, data: d.data}).then(r => {
      if(r.error){ console.warn(r.error); return; }
      try{ e.source.postMessage({cv:"got"}, e.origin); }catch{}
      inboxT = later(inboxT, () => { window.applyPriceInbox && window.applyPriceInbox(); }, 800);
    });
    return;
  }
  // the bookmark finished: the small receiving window closes once everything it got is saved
  if(d.cv === "done"){ if(/[#&]cvrecv\b/.test(location.hash)) photoQ.then(() => new Promise(r => setTimeout(r, 6000))).then(async () => { await saveImagesNow().catch(()=>{}); window.close(); }); return; }
  if(d.cv === "tcdbNone" && Array.isArray(d.names)){ photoQ = photoQ.then(() => window.markTcdbNone && window.markTcdbNone(d.names)); return; }
  if(d.cv === "photo" && d.blob && d.name){
    const name = String(d.name).replace(/[\\/:*?"<>|]/g, " ").trim();
    photoQ = photoQ.then(async () => {
      if(!images) await loadImages();
      if(imagesSet.has(lowP(name))) return;
      try{ await upload(drivePath(name), await shrink(d.blob)); addImage(name); photosIn++; }catch(err){ console.warn("photo", name, err); }
      linkT = later(linkT, async () => { await saveImagesNow().catch(()=>{}); window.linkArrivedPhotos && window.linkArrivedPhotos(); if(photosIn && window.toast) window.toast(photosIn + " photo" + (photosIn===1?"":"s") + " received from TCDB"); photosIn = 0; }, 2500);
    });
  }
});

/* ---------- login, account and import screens ---------- */
const css = `
#cvGate{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:var(--bg,#f5f5f7);padding:16px}
#cvGate .box,#cvAcc .box{background:var(--card,#fff);color:var(--ink,#1d1d1f);border-radius:14px;box-shadow:0 10px 40px #0002;padding:22px;width:100%;max-width:420px;font:15px/1.45 system-ui,sans-serif}
#cvGate h2,#cvAcc h2{margin:0 0 6px;font-size:22px} #cvGate p,#cvAcc p{margin:6px 0 12px;color:var(--muted,#6e6e73)}
#cvGate input,#cvAcc input[type=text]{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #ccc;border-radius:9px;margin:4px 0 10px;background:inherit;color:inherit}
#cvGate button,#cvAcc button,#cvAcc label.pick{font:inherit;padding:9px 14px;border-radius:9px;border:0;background:#0071e3;color:#fff;cursor:pointer;display:inline-block}
#cvAcc button.g,#cvAcc label.pick{background:transparent;color:inherit;border:1px solid #bbb}
#cvGate .err{color:#c00}
#cvAcc{position:fixed;inset:0;z-index:8000;display:flex;align-items:flex-start;justify-content:center;background:#0006;padding:40px 16px;overflow:auto}
#cvAcc[hidden],#cvGate[hidden]{display:none}
#cvAcc .box{max-width:560px} #cvAcc h3{margin:18px 0 4px;font-size:16px}
#cvAcc .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
#cvAcc .st{font-size:13px;color:var(--muted,#6e6e73);white-space:pre-wrap}
#cvAcc progress{width:100%}
#cvAcc input[type=file]{display:none}
@media (prefers-color-scheme: dark){#cvGate .box,#cvAcc .box{background:#1c1c1e;color:#f5f5f7}#cvGate{background:#000}}`;
function ui(){
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const g = document.createElement("div"); g.id = "cvGate"; g.hidden = true; document.body.appendChild(g);
  const a = document.createElement("div"); a.id = "cvAcc"; a.hidden = true; document.body.appendChild(a);
  a.addEventListener("click", e => { if(e.target === a) a.hidden = true; });
}
function gate(html){ const g = $$("#cvGate"); g.innerHTML = `<div class="box">${html}</div>`; g.hidden = false; return g; }
function showLogin(msg){
  const g = gate(`<h2>Card <span style="color:#0071e3">Vault</span></h2><p>Type your email. We send you a link: open it on this device to come in. No password.</p>
    <form id="cvLog"><input type="email" id="cvEmail" required placeholder="you@email.com" autocomplete="email">
      <input type="password" id="cvPass" placeholder="Password (if you set one)" autocomplete="current-password">
      <button>Log in</button></form>
    <p class="st" style="font-size:13px">With a password you're in straight away. Without one, we email you a link.</p>
    <p id="cvLogMsg" class="${msg ? "err" : ""}">${escH(msg || "")}</p>`);
  try{ g.querySelector("#cvEmail").value = localStorage.getItem("cv-email") || ""; }catch{}
  g.querySelector("#cvLog").onsubmit = async e => {
    e.preventDefault();
    const em = g.querySelector("#cvEmail").value.trim(), pw = g.querySelector("#cvPass").value, out = g.querySelector("#cvLogMsg"), b = g.querySelector("button");
    b.disabled = true; out.className = ""; out.textContent = pw ? "Logging in…" : "Sending…";
    try{ localStorage.setItem("cv-email", em); }catch{}
    if(pw){
      const r = await sb.auth.signInWithPassword({email: em, password: pw});
      b.disabled = false;
      if(r.error){ out.className = "err"; out.textContent = /invalid/i.test(r.error.message) ? "Wrong email or password. No password yet? Leave it empty to get a link." : "Couldn't log in: " + r.error.message; }
      else if(r.data && r.data.session) start(r.data.session);
      return;
    }
    const r = await sb.auth.signInWithOtp({email: em, options:{emailRedirectTo: location.origin + location.pathname}});
    b.disabled = false;
    if(r.error && /rate limit/i.test(r.error.message)){ out.className = "err"; out.textContent = "Too many login emails in the last hour. Wait a bit, or log in with your password if you set one."; return; }
    if(r.error){ out.className = "err"; out.textContent = "Couldn't send: " + r.error.message; }
    else out.textContent = "Done. Open your email and click the Card Vault link (look in spam too). You can close this tab.";
  };
}
async function askName(){
  return new Promise(res => {
    const g = gate(`<h2>Welcome!</h2><p>What name should your friends see on your collection?</p>
      <form id="cvNm"><input type="text" id="cvName" required maxlength="40" placeholder="Your name"><button>Continue</button></form><p id="cvNmMsg" class="err"></p>`);
    g.querySelector("#cvNm").onsubmit = async e => {
      e.preventDefault();
      const name = g.querySelector("#cvName").value.trim(); if(!name) return;
      const r = await sb.from("profiles").upsert({id: uid, name});
      if(r.error){ g.querySelector("#cvNmMsg").textContent = "Couldn't save: " + r.error.message; return; }
      res({id: uid, name});
    };
  });
}
function accountButton(){
  const bar = document.querySelector("header .bar"); if(!bar || $$("#cvAccBtn")) return;
  const b = document.createElement("button"); b.className = "btn ghost"; b.id = "cvAccBtn"; b.type = "button"; b.textContent = "☁ " + ((prof && prof.name) || "Account");
  b.title = "Your account, import from the PC app, sign out"; b.onclick = openAccount; bar.insertBefore(b, bar.firstChild);
}
let busy = false;
function openAccount(){
  const a = $$("#cvAcc");
  a.innerHTML = `<div class="box">
    <h2>☁ ${escH((prof && prof.name) || "Account")}</h2><p>Signed in as ${escH(email)}. Your cards are saved online; open this page on any device.</p>
    <div class="row"><button class="g" id="cvRen">Change my name</button><button class="g" id="cvPw">Set a password</button><button class="g" id="cvOut">Sign out</button><button class="g" id="cvX">Close</button></div>
    <h3>Bring my collection from the PC app</h3>
    <p>Do these once, in order. Doing one again is safe: it replaces that part only.</p>
    <div class="row"><label class="pick">1. My lists… <input type="file" id="cvFData" accept=".json,application/json" multiple></label></div>
    <p class="st">Open <b>Card Vault\\data</b> and select <b>cards.json</b>, <b>sources.json</b>, <b>wants.json</b> and <b>history.json</b> (all at once).</p>
    <div class="row"><label class="pick">2. My photos folder… <input type="file" id="cvFImg" webkitdirectory multiple></label></div>
    <p class="st">The folder where your card photos are (the one Card Vault used as images folder). Photos are made smaller (max 1000 px) as they go up.</p>
    <div class="row"><label class="pick">3. Card Vault\\data\\photos folder… <input type="file" id="cvFPh" webkitdirectory multiple></label></div>
    <p class="st">The photos you added straight in the app (skip if the folder is empty or missing).</p>
    <h3>Files a bookmark downloaded</h3>
    <p class="st">If a bookmark couldn't reach this tab, it saves files in Downloads instead (cardvault-prices….json, or photos named "cardvault - …jpg"). Pick them here.</p>
    <div class="row"><label class="pick">Pick downloaded files… <input type="file" id="cvFDl" multiple accept=".json,.jpg,application/json,image/jpeg"></label></div>
    <progress id="cvProg" value="0" max="1" hidden></progress><p class="st" id="cvSt"></p>
    <p class="st">Keep this tab open while photos go up. If it stops, choose the same folder again: photos already online are skipped.</p>
  </div>`;
  a.hidden = false;
  a.querySelector("#cvX").onclick = () => { if(!busy) a.hidden = true; };
  a.querySelector("#cvOut").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  a.querySelector("#cvPw").onclick = () => {
    const box = a.querySelector(".box"), d = document.createElement("form");
    d.innerHTML = `<h3>Set a password</h3><p class="st">Then you can log in on any browser with your email and this password, no email link needed.</p>
      <input type="password" id="cvNp" required minlength="8" placeholder="New password (8+ characters)" autocomplete="new-password" style="width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #ccc;border-radius:9px;margin:4px 0 10px;background:inherit;color:inherit">
      <div class="row"><button>Save password</button><span class="st" id="cvNpMsg"></span></div>`;
    box.insertBefore(d, box.children[3]);
    a.querySelector("#cvPw").disabled = true;
    d.onsubmit = async e => {
      e.preventDefault();
      const r = await sb.auth.updateUser({password: d.querySelector("#cvNp").value});
      d.querySelector("#cvNpMsg").textContent = r.error ? "Couldn't save: " + r.error.message : "Saved. Use it next time you log in.";
      if(!r.error) d.querySelector("#cvNp").value = "";
    };
  };
  a.querySelector("#cvRen").onclick = async () => {
    const n = prompt("Your name for friends", (prof && prof.name) || ""); if(!n || !n.trim()) return;
    const r = await sb.from("profiles").update({name: n.trim()}).eq("id", uid);
    if(r.error) return alert("Couldn't save: " + r.error.message);
    prof.name = n.trim(); $$("#cvAccBtn").textContent = "☁ " + prof.name; openAccount();
  };
  a.querySelector("#cvFData").onchange = e => importData([...e.target.files]);
  a.querySelector("#cvFImg").onchange = e => importPhotos([...e.target.files], "d");
  a.querySelector("#cvFPh").onchange = e => importPhotos([...e.target.files], "p");
  a.querySelector("#cvFDl").onchange = e => importDownloads([...e.target.files]);
}
const say = t => { const s = $$("#cvSt"); if(s) s.textContent = t; };
async function importData(files){
  if(busy) return; busy = true;
  const done = [], bad = [];
  try{
    await ensureBackup(true);
    for(const f of files){
      const m = f.name.toLowerCase().match(/^(cards|sources|wants|history)(\s*\(\d+\))?\.json$/);
      if(!m){ bad.push(f.name); continue; }
      say("Reading " + f.name + "…");
      let list; try{ list = JSON.parse(await f.text()); }catch{ bad.push(f.name + " (not readable)"); continue; }
      if(!Array.isArray(list)){ bad.push(f.name + " (not a list)"); continue; }
      await putDoc(m[1], list); done.push(m[1] + " (" + list.length + ")");
    }
    say((done.length ? "Saved online: " + done.join(", ") + "." : "Nothing saved.") + (bad.length ? "\nSkipped: " + bad.join(", ") : "") + (done.length ? "\nThe app reloads when you close this window." : ""));
    if(done.length) $$("#cvX").onclick = () => location.reload();
  }catch(e){ say("Couldn't save: " + e.message); }
  finally{ busy = false; }
}
async function importPhotos(files, kind){
  if(busy) return; busy = true;
  const prog = $$("#cvProg");
  try{
    if(!images) await loadImages();
    let list = files.filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f.name));
    const rel = f => (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name;
    if(kind === "d") list = list.filter(f => !imagesSet.has(lowP(rel(f))));
    else list = list.filter(f => /^[A-Za-z0-9_-]{1,64}\.jpg$/i.test(f.name));
    const total = list.length; let n = 0, bytes = 0, fails = 0, ix = 0;
    if(!total){ say("Nothing new to send in that folder."); return; }
    prog.hidden = false; prog.max = total; prog.value = 0;
    const t0 = Date.now();
    const work = async () => {
      while(ix < list.length){
        const f = list[ix++];
        try{
          const b = await shrink(f);
          if(kind === "d"){ await upload(drivePath(rel(f)), b); images.push(rel(f)); imagesSet.add(lowP(rel(f))); }
          else await upload(photoPath(f.name.replace(/\.jpg$/i, "")), b);
          bytes += b.size;
        }catch(e){ fails++; console.warn(f.name, e); }
        n++; prog.value = n;
        if(kind === "d" && n % 40 === 0) await saveImagesNow().catch(()=>{});
        const left = Math.round((Date.now()-t0)/n*(total-n)/1000);
        say(`${n} of ${total} photos sent · ${(bytes/1048576).toFixed(1)} MB${fails ? " · " + fails + " failed" : ""}${n<total ? " · about " + (left>90 ? Math.round(left/60) + " min" : left + " s") + " left" : ""}`);
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    if(kind === "d") await saveImagesNow();
    say(`Done: ${n - fails} of ${total} photos online (${(bytes/1048576).toFixed(1)} MB).${fails ? " " + fails + " failed: choose the folder again to retry them." : ""}`);
    $$("#cvX").onclick = () => location.reload();
  }catch(e){ say("Stopped: " + e.message); }
  finally{ busy = false; }
}

async function importDownloads(files){
  if(busy) return; busy = true;
  let prices = 0, photos = 0, skipped = 0;
  try{
    if(!images) await loadImages();
    for(const f of files){
      if(/^cardvault-prices.*\.json$/i.test(f.name)){
        try{ const d = JSON.parse(await f.text()); chk(await sb.from("inbox").insert({user_id: uid, data: d})); prices++; }catch(e){ skipped++; }
      } else if(/^cardvault - .*\.jpg$/i.test(f.name)){
        const name = f.name.replace(/^cardvault - /i, "").replace(/ \(\d+\)(?=\.jpg$)/i, "");
        if(!imagesSet.has(lowP(name))){ try{ await upload(drivePath(name), await shrink(f)); addImage(name); photos++; }catch(e){ skipped++; } }
      } else skipped++;
      say(`${prices} price file${prices===1?"":"s"} and ${photos} photo${photos===1?"":"s"} received${skipped ? " · " + skipped + " skipped" : ""}…`);
    }
    await saveImagesNow();
    say(`Done: ${prices} price file${prices===1?"":"s"} and ${photos} photo${photos===1?"":"s"} received${skipped ? " · " + skipped + " skipped" : ""}. You can delete those files from Downloads now.`);
    $$("#cvX").onclick = () => location.reload();
  }catch(e){ say("Stopped: " + e.message); }
  finally{ busy = false; }
}

/* ---------- new version published: offer to load it ---------- */
const BUILD = "__CV_BUILD__";
async function checkVersion(){
  try{
    const h = await (await origFetch(location.pathname + "?v=" + Date.now(), {cache:"no-store"})).text();
    const m = h.match(/const BUILD = "(\d+)"/);
    if(m && m[1] !== BUILD && !$$("#cvNew")){
      const n = document.createElement("div"); n.id = "cvNew";
      n.style.cssText = "position:fixed;z-index:9400;left:50%;transform:translateX(-50%);bottom:76px;background:#0071e3;color:#fff;padding:10px 16px;border-radius:999px;font:14px system-ui,sans-serif;box-shadow:0 6px 20px #0005;cursor:pointer";
      n.textContent = "A new version of Card Vault is ready · click to update"; n.onclick = () => { location.replace(location.pathname + "?v=" + m[1] + location.hash); };
      document.body.appendChild(n);
    }
  }catch{}
}
setInterval(checkVersion, 3*60*1000); setTimeout(checkVersion, 20000);

/* ---------- start ---------- */
async function start(session){
  if(started) return; started = true;
  uid = session.user.id; email = session.user.email || "";
  try{ prof = chk(await sb.from("profiles").select("id,name").eq("id", uid).maybeSingle()); }catch(e){ started = false; uid = ""; return showLogin("Couldn't open your account: " + e.message); }
  if(!prof || !prof.name) prof = await askName();
  // the key the bookmarks use to drop 130point results straight into my inbox (works even when this tab can't be reached)
  try{
    const r = await sb.from("profiles").select("inbox_key").eq("id", uid).maybeSingle();
    let k = r.data && r.data.inbox_key;
    if(!r.error && !k){ k = [...crypto.getRandomValues(new Uint8Array(24))].map(b=>b.toString(16).padStart(2,"0")).join(""); const u = await sb.from("profiles").update({inbox_key:k}).eq("id", uid); if(u.error) k = ""; }
    window.cvInboxKey = k || "";
  }catch{ window.cvInboxKey = ""; }
  $$("#cvGate").hidden = true;
  await loadLocal();
  try{ await loadImages(); const s = await getDoc("snapshot", null); shareMap = (s && s.photos) || {}; Object.assign(shareIndex, shareMap); }catch(e){ console.warn(e); }
  const main = document.getElementById("cvMain"), sc = document.createElement("script");
  sc.textContent = main.textContent; document.body.appendChild(sc);
  accountButton();
  setTimeout(() => ensureBackup(false), 5000);
  if(/[#&]import\b/.test(location.hash)) openAccount();
  if(/[#&]cvrecv\b/.test(location.hash)){ const n = document.createElement("div"); n.style.cssText = "position:fixed;z-index:9500;top:0;left:0;right:0;padding:10px 14px;background:#0071e3;color:#fff;font:14px system-ui,sans-serif;text-align:center";
    n.textContent = "Card Vault is receiving from the bookmark: keep this window open until the bookmark says done."; document.body.appendChild(n); }
}
async function boot(){
  ui();
  if(!window.supabase || !window.supabase.createClient){ gate(`<h2>Card Vault</h2><p class="err">Couldn't load the online service. Check your internet and reload.</p>`); return; }
  sb = window.supabase.createClient(SB_URL, SB_KEY, {auth:{flowType:"implicit", persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  window.cvSb = sb;
  sb.auth.onAuthStateChange((ev, s) => { if(s && !started) start(s); if(ev === "SIGNED_OUT" && started) location.reload(); });
  const {data} = await sb.auth.getSession();
  if(data && data.session) start(data.session);
  else if(!/access_token=/.test(location.hash)) showLogin(/error_description=([^&]+)/.test(location.hash) ? decodeURIComponent(RegExp.$1.replace(/\+/g," ")) + ". Ask for a new link." : "");
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();
})();
