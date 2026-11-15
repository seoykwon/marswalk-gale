# 24. Website step W6: Electronics impact page

2026-11-15. Scope: Plan/18 2-4 and the W6 row, shortened on the lead's instruction (finish in 30 min; TID, SEE and thermal sections; at most 2 live charts).
Rules applied: English only; no component tolerance numbers; no Sv and no health-limit claims; sol 4716 is a "transient event, cause unconfirmed", never an SPE; general engineering statements are tagged "General background".

## 1. Files

| File | What |
|---|---|
| `site/electronics.html` | Page. Key numbers, TID, sol 4716, SEE, thermal cycling, limits, links to `map.html?tab=rad` / `?tab=temp` / EVA. `<meta name="generator" content="Built with Claude Code (Anthropic)">`. Page-only CSS in a `<style>` block (chart width max 36rem, `.bg-tag`). |
| `site/src/site/electronics.js` | Draws 2 charts with `charts.js` and the same options, data files (`data/rad.json`, `data/rems_B.json`) and `en.json` strings as the map panels: **R1** (sol-mean dose rate, recent period) and **H2** (daily ground-temperature swing, data set B). Fills glossary tooltips on `[data-term]`. Sets `body[data-charts="ready"]`. |
| `site/src/i18n/elec.en.json` | `doc_title` and the "General background" tag. Prose stays in the HTML because `data-s` would overwrite nested `data-fact` spans. |

- `scripts/61_site_facts.py`: **not changed.** Every needed fact already existed (`rad_early_B_mean`, `rad_early_years`, `rad_epoch_gap_years` had been added by another agent). The script still exits 0.
- Screenshots: not used; live charts are used instead.

## 2. Check (headless Chrome, `python3 -m http.server 8777`, stopped afterwards)

Script: `/private/tmp/.../scratchpad/elec_check.mjs` (scratch, not in the repo).

| Item | 1280 px | 390 px |
|---|---|---|
| Console errors, exceptions, log errors | 0 | 0 |
| `data-fact` slots / missing / text ≠ site_facts | 41 / 0 / 0 | 41 / 0 / 0 |
| Horizontal overflow | 0 | 0 |
| "Sv", "SPE", krad numbers in the rendered text | none | none |
| R1 equal to map `#r1` (title, caption, SVG markup without the id, data table) | yes | yes |
| H2 equal to map `#h2` | yes | yes |

The map pages were `map.html?route=B&tab=rad` and `?tab=temp`. The SVG markup includes every path coordinate and bar, so equal markup means equal plotted values.

## 3. Engineering claims and their basis

| Sentence (short) | Basis |
|---|---|
| Detector B is silicon, so its dose is the dose a silicon device on the deck receives | Data fact (RAD detector, glossary `B`) |
| Recent B mean 6.898 µGy/h, 60.5 mGy = 6.05 rad(Si) per Earth year | Data facts `rad_recent_B_mean`, `rad_recent_B_year_mGy`, `rad_recent_B_year_rad` |
| Early B mean 9.029 µGy/h, 79.1 mGy per year; periods 13 years apart, difference not read as altitude/place | Data facts `rad_early_*`, `rad_epoch_gap_years`; Plan/02 "not done" |
| One route B EVA: 17.7 µGy(Si) | Data fact `routeB_dose_B` |
| TID shifts thresholds and raises leakage; compare with the datasheet krad(Si) rating; no rating stated | **General background** (tagged) |
| Sol 4716: E sol mean 7.86, max 11.95 µGy/h, rise about 7 h, only sol above threshold, cause unchecked, not an SPE | Data facts `spike_*`; `rad.json` spikes list |
| During such an event the concern is higher particle flux (SEE chance), not extra dose | **General background** (tagged) |
| LET spectrum 52 bins, peak bin 0.283 keV/µm, falls steeply, high-LET present but rare | Data facts `let_recent_bins`, `let_peak_keV_um`; shape of `rad.json` let arrays |
| SEE is caused by one particle; designers compare heavy-ion LET threshold and cross-section against such a spectrum | **General background** (tagged) |
| No SEE rate: shape only, no absolute flux, no part data | Data limitation (RAD_RDR_SIS via map R5 note; Plan/02) |
| One cycle per sol, 669 per Mars year; swing mean 83.1 K (59.8–111.0 K), 561 sols | Data facts `mars_year_sols`, `gts_recent_range_*`, `gts_recent_n_full` |
| Fastest warming +17.4 K/h from 08:00, cooling −14.2 K/h from 17:00 | Data facts `gts_heat_rate_*`, `gts_cool_rate_*` |
| 14.3 h per sol below −40 °C; −40 °C is a comparison line, not a part grade | Data facts `gts_h_below_m40`, `eva_min_ground_C` |
| Swings strain solder joints and packages; larger/more swings bring fatigue sooner; enclosures and heaters reduce exposure | **General background** (tagged) |
| Limits list (deck position, shielding, Gy only, no map/altitude, ground ≠ internal temperature, uncertainty 9.07 K, short slices) | Data facts / Plan/02, Plan/17 6 |

## 4. Left over (shared files I may not edit)

- `site/src/site/site.js` `PAGES`: set `electronics` to `live: true` so the menu shows "Electronics" with `aria-current`. Until then the page's menu omits itself (the static fallback menu in the HTML matches the other pages).
- `scripts/55_eva_precache.py` must be re-run (W7) so the new page and files enter the offline shell.
- Dropped for time: live R2 (sol 4716 curve), R5 (LET) and H1/H3 charts. The page links to them in the map.
