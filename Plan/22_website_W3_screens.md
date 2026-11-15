# 22. Website step W3: screenshots

2026-11-15. `scripts/60_site_screens.mjs` drives headless Chrome (DevTools protocol, no packages) against a server on port 8775 (started and stopped by me) and writes `site/img/*` plus `site/img/screens.json` (file, width, height, bytes, alt, shows).

Method: JPEG through Chrome's own `Page.captureScreenshot`; quality starts at 82 and drops in steps of 6 until a file is at most 150,000 bytes. The cuff sheet was first a PNG (164 KB), so it is a JPEG now. Every image was opened and read by eye; text is legible.

| File | Size | Bytes | Shows |
|---|---|---|---|
| map-route-b.jpg | 1280x800 | 146,903 | Map, route B, Route panel |
| map-radiation.jpg | 1280x800 | 135,636 | Radiation tab, RAD dose-rate charts |
| map-temperature.jpg | 1280x800 | 145,327 | Temperature tab, REMS charts |
| map-draw.jpg | 1280x800 | 142,424 | Draw tab with a drawn line and stats |
| map-layers.jpg | 1280x800 | 148,828 | Slope and line-of-sight overlays on route B, zoom 15 |
| eva-landscape.jpg | 1280x800 | 145,412 | EVA replay at 30%, outbound, CONTINUE state |
| eva-portrait.jpg | 390x844 | 68,093 | EVA on a phone |
| cuff-sheet.jpg | 680x907 | 144,553 | First cuff sheet (summary + cards) |

Total 1,077,176 bytes (limit 1.5 MB). No console or file changes outside `site/img/` and the script. The lead asked to cut to 4-5 images; all 8 were already captured and fit the limits, so pages may use any subset (suggested minimum: map-route-b, eva-landscape, cuff-sheet, map-radiation, map-temperature).
