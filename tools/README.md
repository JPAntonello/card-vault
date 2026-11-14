# Card Vault tools

## Price matching test (run before every deploy)
`node tests/price-test.js` — checks every saved sale title in `tests/price-cases.json`
(real sales from the collection) against the app's `cardMatch`:
- **STOPPED MATCHING** = a sale that set a card's price is no longer recognised → fails (exit 1).
- **NOW MATCHES** = a sale the app used to leave out now counts → listed for review.
Cases marked `known` are titles too vague to tell versions apart; they're reported but don't fail.
Add hand-written cases to `tests/extra-cases.json` (same shape: `{card, title, expect}`).

## Weekly TCDB check
1. Open a www.tcdb.com tab in Chrome (pass the security check if shown).
2. Paste `tools/tcdb-scan.js`, then `cvScan.run()`; poll `cvScan.summary()` until `finished`.
   It downloads `cv-tcdb-scan.json` (only the sets with something new).
3. `python3 tools/update_sets.py cv-tcdb-scan.json` adds the new base cards, inserts and
   parallels to `library/` (additions only) and writes `tools/last-update.json`.
4. `node tests/price-test.js`, then commit and push.
