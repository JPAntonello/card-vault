// in-memory stand-in for supabase-js (just what Card Vault online uses), kept in localStorage
(()=>{
const KEY = "fakeSB";
const load = () => { try{ const x = new XMLHttpRequest(); x.open("GET","/__db",false); x.send(); return JSON.parse(x.responseText) || null; }catch{ return null; } };
let db = load() || {profiles:[], docs:[], library:[], inbox:[], storage:{}, seq:1};
const save = () => { const x = new XMLHttpRequest(); x.open("POST","/__db",false); x.send(JSON.stringify(db)); };
const user = () => { const u = localStorage.getItem("fakeUser"); return u ? JSON.parse(u) : null; };
const pk = {profiles:["id"], docs:["user_id","name"], library:["id"], inbox:["id"]};
window.fakeCalls = [];
class Q {
  constructor(t){ this.t = t; this.f = []; this.op = "select"; this.cols = "*"; this.single = false; }
  select(c){ if(this.op === "select") this.cols = c; return this; }
  eq(k,v){ this.f.push(r => r[k] === v); return this; }
  neq(k,v){ this.f.push(r => r[k] !== v); return this; }
  in(k,v){ this.f.push(r => v.includes(r[k])); return this; }
  like(k,v){ const re = new RegExp("^" + v.replace(/%/g, ".*") + "$"); this.f.push(r => re.test(r[k])); return this; }
  order(){ return this; }
  maybeSingle(){ this.single = true; return this; }
  upsert(o){ this.op = "upsert"; this.row = o; return this; }
  insert(o){ this.op = "insert"; this.row = o; return this; }
  update(o){ this.op = "update"; this.row = o; return this; }
  delete(){ this.op = "delete"; return this; }
  then(res, rej){ return Promise.resolve().then(()=>this.run()).then(res, rej); }
  run(){
    const u = user(); if(!u) return {data:null, error:{message:"not logged in"}};
    const rows = db[this.t]; window.fakeCalls.push(this.t + ":" + this.op);
    if(this.op === "upsert"){
      const o = {...this.row}; if(this.t === "docs" && !o.user_id) o.user_id = u.id;
      const i = rows.findIndex(r => pk[this.t].every(k => r[k] === o[k]));
      if(i >= 0) rows[i] = {...rows[i], ...o}; else rows.push({updated_at: new Date().toISOString(), ...o});
      save(); return {data:null, error:null};
    }
    if(this.op === "insert"){ rows.push({id: db.seq++, ...this.row}); save(); return {data:null, error:null}; }
    const hit = rows.filter(r => this.f.every(f => f(r)));
    if(this.op === "update"){ hit.forEach(r => Object.assign(r, this.row)); save(); return {data:null, error:null}; }
    if(this.op === "delete"){ db[this.t] = rows.filter(r => !hit.includes(r)); save(); return {data:null, error:null}; }
    const cols = this.cols === "*" ? null : this.cols.split(",");
    const out = hit.map(r => cols ? Object.fromEntries(cols.map(c => [c, r[c]])) : r).map(r => JSON.parse(JSON.stringify(r)));
    return {data: this.single ? (out[0] || null) : out, error:null};
  }
}
const storage = { from: () => ({
  upload: async (path, blob) => { db.storage[path] = blob.size; save(); window.fakeCalls.push("upload:" + path); return {data:{path}, error:null}; },
  remove: async (ps) => { ps.forEach(p => delete db.storage[p]); save(); return {data:null, error:null}; },
  copy: async (a, b) => { if(!(a in db.storage)) return {data:null, error:{message:"not found"}}; db.storage[b] = db.storage[a]; save(); return {data:null, error:null}; },
})};
window.supabase = { createClient: () => ({
  from: t => new Q(t),
  storage,
  auth: {
    getSession: async () => { const u = user(); return {data:{session: u ? {user:u} : null}}; },
    onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}}),
    signInWithOtp: async ({email}) => { window.fakeOtp = email; return {error:null}; }, signInWithPassword: async () => { const u={id:"u1",email:"a@b.c"}; localStorage.setItem("fakeUser", JSON.stringify(u)); return {data:{session:{user:u}}, error:null}; }, updateUser: async () => ({error:null}),
    signOut: async () => { localStorage.removeItem("fakeUser"); return {error:null}; },
  },
})};
})();
