# 25. Website W4: home page (results)

Date: 2026-11-15. Plan: Plan/18 sec. 2-2, 3, W4 row and decisions. Model: Opus.

## Files
- `site/index.html`: replaced the W1 temporary page. The `<head>` redirect script is byte-for-byte unchanged (`?route`/`?tab` → `map.html`).
- `site/src/i18n/home.en.json`: new page dictionary (`<body data-dict="home">`).
- No changes to `site.css`, `site.js` or other shared files. Home-only layout lives in a small `<style>` block in `index.html`.

## Page layout (top to bottom)
1. Black hero: "Marswalk / Gale Crater EVA planner", one-line lead, buttons Map / EVA replay / Cuff checklist.
2. The problem (2 paragraphs, no numbers).
3. Key findings (6 items), all numbers from `data/site_facts.json` via `data-fact`: route B distance/ascent/EVA time; ≥15° sections (count, length, max slope); line-of-sight gap; recent RAD B and E rates and route B EVA dose (Si); the A/B 13-year sentence (wording from en.json, years from facts); spike sol 4716 ("transient event; its cause is unconfirmed"); ground-temperature daily range mean/max. Every assumption (speed, stay, 15° level, 2 m antenna, EVA duration) is labelled "assumption".
4. Three tools: cards with screenshots `map-route-b`, `eva-landscape`, `cuff-sheet` (alt from `screens.json`, width/height set, `loading="lazy"`). Exactly one link per card (`.cards a` = 3, as scripts 54 and 58 expect): `map.html`, `eva.html?route=B`, `cuff.html?route=B`.
5. How the numbers are checked (check counts from facts), Limits (3 lines).
6. More: `about.html`, `electronics.html`, `sources.html`; NASA data note and AI-use note. Footer = repo note from `site.js` only. No name, contact or tolerance numbers.
- `<meta name="generator" content="Built with Claude Code (Anthropic)">` and a meta description.
- HTML fallback for every number is "…" (no numbers typed into HTML).

## Decision: findings above the cards
At 1280×800 the cards' images were inside the first screen (all 3 = 437 KB → over 0.3 MB). Key findings now come before the cards, so the first screen at 1280 and 390 contains no images. The hero buttons still give one-click entry to all three tools.

## Verification (headless Chrome, port 8778, server stopped afterwards)
| Check | 1280×800 | 390×844 |
|---|---|---|
| Console errors / exceptions | 0 | 0 |
| Horizontal overflow | no | no |
| `data-fact` missing / differs from `site_facts.json` `t` | 0 / 0 | 0 / 0 |
| Raw dictionary keys shown | 0 | 0 |
| Card links | map.html, eva.html?route=B, cuff.html?route=B | same |
| First card image top | 1,349 px (below fold) | 2,228 px |
- `index.html?route=A&tab=rad` → `/map.html?route=A&tab=rad`.
- First screen transfer (cold cache): HTML 12.8 KB + CSS 21.6 KB + JS 16.9 KB + JSON 16.7 KB = 68 KB; with the service-worker precache list (`eva_precache.json`, 27.9 KB, background) 96 KB. ≤ 0.3 MB.
- Note: Chrome's lazy-load distance still fetches the three images (437 KB) after load because they are within ~1,250 px of the viewport; they do not block the first screen.

## Open items for others
- `site.js` `PAGES`: `about`, `electronics`, `sources` are `live: false`, so the top menu does not list them yet. Flip when W5/W6 land (W5/W6/W7 owner).
- W7: add `img/*` (extras) and the new pages to the offline lists; offline the card images will fail unless cached.
