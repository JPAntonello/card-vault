#!/usr/bin/env python3
"""Build the online Card Vault page from the PC app's index.html.
usage: build.py <app index.html> <shim.js> <out index.html> [supabase script url]"""
import sys, re
src, shim_f, out = sys.argv[1:4]
SB_JS = sys.argv[4] if len(sys.argv) > 4 else "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js"
h = open(src, encoding="utf-8").read()
shim = open(shim_f, encoding="utf-8").read()

def rep(old, new, count=1):
    global h
    n = h.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of {old[:80]!r}, found {n}")
    h = h.replace(old, new)

# photo addresses
rep('const driveUrl = p => /^https?:\\/\\//.test(p) ? p : "/drive/" + encodeURIComponent(p);', 'const driveUrl = p => cvDriveUrl(p);')
rep('const photoSrc = (id, v) => "/photos/" + encodeURIComponent(id) + ".jpg?v=" + encodeURIComponent(v||"");', 'const photoSrc = (id, v) => cvPhotoUrl(id, v);')
rep('<img src="/shared/${esc(c.pk)}.jpg" alt="" loading="lazy">', '<img src="${esc(cvSharedUrl(c.pk))}" alt="" loading="lazy">')
# texts
rep('Personal sports card library. Saved on your PC · data from TCDB.', 'Personal sports card library. Saved online · data from TCDB.')
rep("Can't reach the Card Vault server. Start it with start-card-vault.bat, then reload this page.", "Can't reach Card Vault online. Check your internet, then reload this page.")

# bookmarks: talk to the online app (the tab that opened them) instead of downloading files;
# with no Card Vault online behind them they still download, so they keep working with the PC app
HELLO = ("let O=null;try{const op=window.opener;if(op){await new Promise(r=>{const h=e=>{if(e.source===op&&e.data&&e.data.cv==='ack'){O=op;removeEventListener('message',h);r()}};"
         "addEventListener('message',h);op.postMessage({cv:'hello'},'*');setTimeout(r,1500)})}}catch(e){}")
rep("let L;try{L=JSON.parse(s)}catch(e){alert('Card Vault: that is not a photo list');return}",
    "let L;try{L=JSON.parse(s)}catch(e){alert('Card Vault: that is not a photo list');return}" + HELLO)
rep("if(!b)continue;const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='cardvault - '+n;document.body.appendChild(a);a.click();a.remove();ok++;",
    "if(!b)continue;if(O){O.postMessage({cv:'photo',name:n,blob:b},'*')}else{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='cardvault - '+n;document.body.appendChild(a);a.click();a.remove()}ok++;")
rep("They will appear in the app in a few seconds.')", "'+(O?'They were sent to Card Vault online.':'They will appear in the app in a few seconds.'))")
rep("let J;try{J=JSON.parse(s)}catch(e){alert('Card Vault: that is not a search list');return}",
    "let J;try{J=JSON.parse(s)}catch(e){alert('Card Vault: that is not a search list');return}" + HELLO)
rep("const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({site,kind,at:new Date().toISOString(),results:out})],{type:'application/json'}));a.download='cardvault-prices-'+site+'-'+Date.now()+'.json';document.body.appendChild(a);a.click();last=a;",
    "const pl={site,kind,at:new Date().toISOString(),results:out};if(O){O.postMessage({cv:'prices',data:pl},'*')}else{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(pl)],{type:'application/json'}));a.download='cardvault-prices-'+site+'-'+Date.now()+'.json';document.body.appendChild(a);a.click();last=a}")

# the app runs only after login: its script waits as text, the shim starts it
i = h.index("<script>\nconst $ = s => document.querySelector(s);")
j = h.index("</script>", i)
main = h[i+len("<script>"):j]
h = (h[:i] + f'<script src="{SB_JS}"></script>\n<script>\n{shim}\n</script>\n'
     + '<script type="text/plain" id="cvMain">' + main + "</script>" + h[j+len("</script>"):])
if "</script" in main.replace("<\\/script", ""):
    raise SystemExit("main script contains </script")
open(out, "w", encoding="utf-8").write(h)
print("ok", len(h))
