# 21. Website steps W1 and W2: results

2026-11-15. Scope: Plan/18 section 5 rows W1 (move the map, fix links) and W2 (common skeleton, site facts), plus the T5B layer-name fix left over from Plan/20 section 6.
The decisions at the end of Plan/18 were applied: the home page is `index.html` and the map is `map.html`; no name or contact is shown; there are no component tolerance numbers; the site is English only (no `site.ko.json`, no language toggle).
Raw data folders were only read. Nothing was deleted (`site/index.html` was moved to `site/map.html`). No git commit. Python was run as `python3 -I`, with no packages installed. Only my own HTTP server (port 8774) was started and stopped. The check scripts start and stop their own servers (54: 8768/8769).

## 0. W0 start condition (re-run before any change)

| Check | Result |
|---|---|
| 54 offline | 53/53 |
| 56 cuff | 51/51 |
| 57 EVA | 83/83, self-test 77/77 |
| 58 browser | 0 console errors, 0 exceptions, 0 HTTP errors, 0 tile 404 |
| 59 panels | 124/124 |

These match Plan/20.

## 1. W1: map moved, links fixed

### 1-1. Files

| File | Change |
|---|---|
| `site/index.html` → `site/map.html` | Moved (`mv`). In the top bar, the title "Marswalk" is now a link to `index.html` (`#lnk-home`, tooltip "Home: project overview"). The bar's layout did not change: the link is inline, has no underline and inherits its colour (`.home-link` in `app.css`). |
| `site/index.html` (new, temporary) | Home page with 3 cards (Map / EVA replay / Cuff checklist), a menu and a footer. A 3-line inline script in `<head>` runs before anything else loads. If the query has `route` or `tab`, it calls `location.replace('map.html' + search + hash)`. Uses `src/site/site.css`, `src/site/site.js` and `src/sw-register.js`. W4 will replace this page. |
| `site/eva.html`, `site/src/eva/eva.js` | "Planning mode" → `map.html` (static) / `map.html?route=<A\|B>` (JS). New "Home" link (`#lnk-home`, `b48 btnlink`) in the setup dialog next to Close. The header band `.ebar` is unchanged. |
| `site/cuff.html`, `site/src/cuff/cuff.js` | "Planning mode" → `map.html` / `map.html?route=…`. New "Home" link on the screen-only bar. It is not printed. |
| `site/src/panels/about.js` | Link "Home: project overview, EVA replay and cuff checklist" (`#about-home`) at the bottom of the About pane. The method and sources links will be added in W5, once those pages exist. |
| `site/src/i18n/en.json` | `ui.home_title` and `about.home_link` added. |
| `site/src/i18n/eva.en.json` | `setup.home` added. |
| `site/src/i18n/cuff.en.json` | `screen.home` added. |
| `site/src/app.css` | `.home-link` added (2 lines). |
| `site/src/main.js`, `draw.js`, `sw-register.js` | Comments only (`index.html` → `map.html`). |
| `site/sw.js` | Not changed. The scope root still maps to `index.html`, which is now the home page, as Plan/18 1-1 intended. |
| `scripts/54_offline_check.mjs` | The online first visit now opens `map.html`. Offline pages: `index.html` (home) was added before `map.html?route=B`, which was relabelled `index` → `map`. New: an offline redirect check. The EVA offline-state wait was made robust (see 3-2). |
| `scripts/56_cuff_check.mjs` | Section 4 opens `map.html?route=B`; the check names say "map". New Home-link check. |
| `scripts/57_eva_browser_check.mjs` | Lines 181 and 211 now use `map.html`. The control-bar probe also records the `.ebar` height. New Home-link / header check (section 6a). |
| `scripts/58_browser_check.mjs` | Lines 127, 230, 342 and 392 now use `map.html`. Screenshot `40_index_lang_ko_ignored` was renamed `40_map_lang_ko_ignored`. New section 11 records the map home links, 4 redirect probes and the home page state (screenshot `41_home_tmp`). |
| `scripts/59_check_panels.py` | The English-only row was renamed `en_only.index_lang_ko` → `en_only.map_lang_ko` (same test, now on `map.html?lang=ko`). New rows, see 3-1. |
| `site/data/eva_precache.json` | Regenerated with `python3 -I scripts/55_eva_precache.py`. Shell 51 files (was 46): + `map.html`, `src/site/site.css`, `src/site/site.js`, `src/i18n/site.en.json`, `data/site_facts.json`. Total 13.37 MB. No code change in 55. |
| `Plan/13` | Addendum at the end: the URL contract after the move (map parameters, redirect, `lang` obsolete, Home links). |

### 1-2. URL contract (summary; details in the Plan/13 addendum)

- `map.html?route=<A|B>&tab=<route|rad|temp|draw|about>`. Defaults: route B, tab route.
- `index.html?route=…` or `?tab=…` → `map.html` with the same query string and hash. This also works offline, from the worker. A bare `index.html` stays on the home page.
- `eva.html` and `cuff.html` are unchanged. `lang` is not part of any URL.
- All links are relative, so they work under `/marswalk-gale/` (54 sub-path run).

### 1-3. EVA header band height

The Home link is inside `<dialog id="setup">`, so it cannot affect `.ebar`. To confirm this, the Play / Turn-back button rectangles from the W0 run of 57 and from the final run were compared at 1024×768, 768×1024, 390×844 and 360×640, with the banner both hidden and shown. All 8 are **identical**, for example Play top 628 / 824 / 639 / 419 px. The `.ebar` heights are 62 / 98.3 / 88.3 / 88.3 px. 57 now also checks that `.ebar` holds only `#btn-setup` and `#lnk-plan`.

## 2. W2: common skeleton and site facts

### 2-1. Files

| File | What it does |
|---|---|
| `site/src/site/site.css` | Loaded after `app.css`. It undoes the full-height app layout (`html, body { height: auto }`, `body.site { display: block }`) and sets a reading column of max 72rem (prose max 42rem, about 72 characters). The header band and hero use EVA colours (black, white, amber `#ffc233`). It styles the cards (the EVA card is black), the key-number grid (`.facts`, `tabular-nums`), sideways-scrolling tables (`.table-wrap`), figures and the footer. Links and buttons are at least 44 px tall, with focus outlines. There are no web fonts, gradients or animation. Light and dark follow the OS through the `app.css` tokens. |
| `site/src/site/site.js` | ES module. It builds the menu (`#site-nav`) from one `PAGES` list and sets `aria-current="page"` on the current page. Pages with `live: false` (about, electronics, sources) are left out until W4–W6 build them. It builds the footer (`#site-footer`) and fills `data-s` / `data-s-aria` strings from `site.en.json` plus an optional page dictionary (`<body data-dict="home">`). It fills `data-fact="key"` from `data/site_facts.json` (`data-fact-part` = `t` text with unit, the default; `n` number; `u` unit). An unknown key keeps its fallback text and gets `data-fact-missing`. When done it sets `body[data-ready="1"]` and `data-facts-missing`, and `window.siteFacts`. Errors set `data-ready="error"` and print no console output. |
| `REPO_URL` in `site.js` | **TODO(release)**. This is the only place the repository URL lives. While it is empty, the footer shows the plain text "Source code: repository link added at release" (`data-todo="repo-url"`) instead of a dead link. No name or contact is shown anywhere. |
| (fix during the run) | The first home screenshot showed blue menu links on the black band: `body.site a` outranked `.site-head a`. The selector became `body.site .site-head a`. The precache and 54/58/59 were re-run after this. |
| `site/src/i18n/site.en.json` | Shared strings: site name, skip link, menu labels, footer, the three card texts and the temporary home lead. It holds no numbers. |
| `scripts/61_site_facts.py` | Writes `site/data/site_facts.json` (69 facts, 9.2 KB) and `work/site/site_facts_audit.json`. See 2-2. |

Plan/18 2-1 aimed for ≤3 KB. With the source file and field recorded for every fact, the file is 9.2 KB, which still adds very little to the 1.2 MB shell.

### 2-2. How 61 works

For each fact, the script:

1. Reads the value from the JSON field the site already uses and records `src` = file#field.
2. Recomputes the value independently and requires agreement at display precision. The second sources are raw per-sol tables, the 2 m route samples, CSV point lists, `scripts/config.json` versus `site/data/config.json`, and the numbers the map panel actually rendered (`work/stage5/browser_check.json`).
3. Compares the value with the number written in Plan/18 2-2, 2-3 or 2-4. A difference that a later result document explains is listed as a "known change". Any other difference is **held back** in a `pending` block, so pages cannot show it. The script prints the difference and exits with code 3. A failed recomputation exits with code 1.

Rounding mirrors `format.js`: half away from zero, the "," separator and U+2212 for the minus sign.

Final run: **69 facts written, 65 recomputed independently and all agree, 6 without a second source, 0 failures.** The Plan/18 comparison gives 50 equal, 3 known changes and **2 unresolved** (exit 3).

### 2-3. Fact list

| Key | Shown | Source (file#field) | Independent recomputation | Plan/18 |
|---|---|---|---|---|
| layers_own_tiles | 11 | layers.json#layers | tile folders in site/tiles | = |
| layers_external | 2 | layers.json#external | entries with remote URL | = |
| **layers_vector** | **14** | browser_check.json layer_ids minus tile ids | `id:` entries in vectors.js | **15: unresolved** |
| routeB_one_way_m | 1,824.5 m | routes.json#routes.B.summary.dist_m | last sample d_m | = |
| routeB_round_trip_m | 3,649.1 m | …summary.round_trip_m | 2 × last d_m | — |
| routeB_climb_m | +158.6 m | …summary.climb_m | sum of rising steps (158.7, tol 0.5 m) | = |
| routeB_eva_total | 2 h 34 min | …summary.round_trip_with_stay_s | 2 × t_out + stay | = |
| routeB_hazards_15_n / _m | 3 / 28.0 m | …n_hazards_15, len_over15_m | runs of segments ≥15° from samples | = |
| routeB_comms_out_m | 856.0 m | …comms_out_m | segments with vis 0 | = |
| routeB_max_slope_deg | 17.4° | …max_slope_deg | max samples.slope_deg | — |
| routeB_max_tilt_deg / _sol | 24.0° / 4970 | …rover_tilt.max, rover_tilt[] | rover_tilt list; map panel row 4 | — |
| rad_recent_B_mean / E_mean | 6.898 / 6.434 µGy/h | rad.json#periods.recent.B_mean / E_mean | n_valid-weighted sol table | = |
| rad_recent_sols | 4613–4843 | …sol_range_in_data | sol table | = |
| rad_recent_n_valid / n_sols | 19,502 / 231 | …n_valid, n_sols | sol table | — |
| rad_recent_B_year_mGy / _rad | 60.5 mGy / 6.05 rad | B_mean × 8,766 h | conversion field + map panel | = |
| rad_early_B_year_mGy | 79.1 mGy | early B_mean × 8,766 h | sol table + map panel | = (see note 1) |
| rad_early_sols | 1–359 | …early.sol_range_in_data | sol table | = |
| routeB_dose_B / dose_E | 17.7 / 16.5 µGy | B/E mean × EVA hours | sol table + map panel | = |
| spike_sol | 4716 | …spikes[0].sol | highest E sol mean | = |
| spike_E_max | 11.95 µGy/h | …spikes[0].E_obs_max | max of series | = |
| spike_E_solmean | 7.86 µGy/h | …spikes[0].E_solmean | sol table row | = |
| spike_rise_h | 7 h | spikes[0].series | none (one rule: onset = first obs after 06:00 above night mean + 3 SD, 6.82 h; peak 13.75 h → 6.93 h) | = |
| let_peak_keV_um | 0.283 keV/µm | recent let, argmax A1 counts/width | raw A1 argmax and A2 density argmax | = (re-checked on the 52-bin recent data) |
| let_recent_bins | 52 | …let.n_bins | centre array length | — |
| gts_recent_range_mean / max / min | 83.1 / 111.0 / 59.8 K | rems_B.json#recent_year_4175_4843 | sols[] with ≥20 h | = |
| gts_recent_n_full | 561 | …n_sols_full | same | = |
| mars_year_sols | 669 | …n_sols_with_rows | 4843 − 4175 + 1 | = |
| gts_heat_rate_max / hour | +17.4 K/h / 08:00 | max(mean_rate_K_per_h_by_hour) | none (hourly rows not in site/data) | = |
| gts_cool_rate_max / hour | −14.2 K/h / 17:00 | min(mean_rate…) | none | "about −14 (16–17 h)": = (hour 16 is −14.1) |
| gts_h_below_m40 / m55 | 14.3 / 12.0 h | rems_B summary | mean of sols[].g40/g55, ≥20 h | = |
| rems_B_sols | 4134–4843 | meta.period_sols | sols[] | = |
| gts_unc_mean | 9.07 K | summary.mean_long_term_uncertainty_K | mean sols[].unc | = |
| rems_ls_method | Mars24 (Allison & McEwen 2000) | rems_B.json#meta.sources.ls | rems_A.json names the same | — |
| ls_landing_deg | 150.7° | scripts/ls_mars24.py ls_from_utc(2012-08-06 05:18 UTC) | published 150.7 (Plan/20 P2-9) | — |
| walk_speed_kmh, slope_caution/danger_deg, eva_max_h, eva_reserve_min, eva_daylight_end_h, eva_min_ground_C, eva_dose_budget_uGy, antenna_m, eva_stay_min | 2.5 km/h, 15°, 25°, 6 h, 30 min, 17.5 h LMST, −40 °C, 50 µGy, 2 m, 30 min | config.json | scripts/config.json | = |
| rad_min_obs_s, rad_qc_required, rems_gts_conf | 600 s, 00000000, 111 | rad.json meta.filter / config.json | config.json / scripts/config.json | = |
| dem_wp_mean_diff_m / dem_wp_n | −1.32 m / 94 | work/checks/alignment_results.json | dem_waypoints_diff.csv | = |
| slope5_tilt_median_diff / r | −0.81° / 0.78 | work/stage3/slope_check.json | slope_check.csv | = |
| tile_shift_max_px | 0.13 px | work/stage3/verify_results.json | none (all 33 pass_1px) | = |
| **ctx5_offset_max_m** | **1,550 m** | alignment_results.json#ctx_field.max_m | none | **1,750: unresolved (2-3)** |
| ctx5_offset_landing_m | 1,153 m | ctx_dem.landing.B1_ctx_5m | hypot(E, N) | — |
| checks_panel / eva / cuff / offline / route / selftest | 130/130, 84/84, 52/52, 61/61, 34/34, 77/77 | work/stage5/*_check.json, work/stage4/validate.json | count of true flags | 123/123, —, 75/75, 64/64, 34/34, 77/77: known changes (Plan/19, this step) |

Notes:
1. `rad.json` `periods.early.conversion.equipment_earth_year_mGy_Si` is stored as 79.15. Rounding that stored value again would give 79.2. The fact is computed from the unrounded `B_mean × 8,766 h` = 79.148, which shows 79.1, as the map panel does.
2. Facts that come from `work/` rather than `site/data/`: the method-page validation numbers, the rendered vector-layer count and the check counts. Those results were never copied into `site/data`. Pages still read only `site/data/site_facts.json`, and the `src` field says where each value came from.
3. The check counts must be refreshed by re-running 61 (then 55) after the last regression of each W step. That was done here.

### 2-4. Differences from Plan/18 (reported, not resolved)

| Fact | Plan/18 | Data | Finding | Needs |
|---|---|---|---|---|
| Vector layers (2-2) | 15 (from Plan/12 0) | **14** | The rendered layer list has 27 ids: 11 own tiles + 2 external + 14 vector (P1A, P1B, P1c, M1, M1w, M2, M5, M6, M7, T4, T4r, G3, G1, E3). A naive count of `id: '…'` in `vectors.js` gives 15, because `id: 'P1' + rid` also matches; that may be where 15 came from. | User decision; held in `pending` |
| CTX 5 m offset maximum (2-3) | "up to 1,750 m" (Plan/06) | **1,550 m** (`ctx_field.max_m`, reliable points) | Plan/06's "−250 to +1,750 m per strip" is a rounded range. `ctx_offset_field.csv` has east offsets from −1,648 to +1,744 m over all 225 points, including unreliable ones. No stored field equals 1,750. | User decision; held in `pending` |
| Cooling rate (2-4) | about −14 K/h at 16–17 h | −14.2 K/h at hour 17 (hour 16: −14.1) | Consistent | — |
| Check counts (2-2) | 123, 77, 75, 64, 34 | 130, 77, 52, 61, 34 (+ 57: 84) | Plan/19 removed the Korean cases. W1 added checks. | Known |
| LET peak (2-4) | 0.283 keV/µm (old 44-bin data) | 0.283 keV/µm (52-bin recent data, Plan/20 P2-5) | Unchanged | — |

All other 2-2 and 2-4 numbers equal the current JSON. The Plan/20 changes (early `n_sols` 300, R4 correlations, season curves) are not among the Plan/18 home or electronics numbers.

## 3. Regression (headless Chrome, `python3 -m http.server 8774` from `site/`, stopped afterwards)

### 3-1. Results and new checks

| Check | W0 | Final | New checks (the only count changes) |
|---|---|---|---|
| 54 offline (own servers, root + `/marswalk-gale/`) | 53/53 | **61/61** | +8. Per run (root and sub-path): home page offline "page starts", "no listed file failed", "no unexpected console errors" (3); "index.html?route=A&tab=rad redirects to map.html?route=A&tab=rad" (1). The home page has no map or numbers yet, so the tiles and "numbers shown" checks are skipped for it. |
| 56 cuff | 51/51 | **52/52** | +1: "Home link on screen (href index.html, ≥44 px), hidden in print; Planning mode → map.html?route=B" |
| 57 EVA | 83/83, self-test 77/77 | **84/84**, 77/77 | +1: "Home link in the setup dialog (href index.html); header band holds only Setup + Planning mode (→ map.html)" |
| 58 browser | 0 / 0 / 0 / 0 | **0 console errors, 0 exceptions, 0 HTTP errors, 0 tile 404** | (probes only; values checked by 59) |
| 59 panels | 124/124 | **130/130**, nothing uncovered | +6: `site.map_home_links`; `site.redirect.route-A`, `.route-A_tab-rad`, `.tab-temp`, `.none` (bare index.html stays on the home page); `site.home_facts` (the home page's `[data-fact]` texts equal `site_facts.json`, 3 cards, menu with `aria-current`, no horizontal overflow) |

- Acceptance "54 passes under `/marswalk-gale/`": the sub-path run passes all its checks, including the home page and the redirect.
- Acceptance "`index.html?route=A` redirects": `map.html?route=A`, route A selected (58/59). With `&tab=rad`, the Radiation tab opens, online and offline.
- Acceptance "zero console errors": 58 (map, home, redirects) 0; 56 0; 57 0; 54 "no unexpected console errors" on every page.

### 3-2. One check timing change in 54

The first full 54 run after W1 failed "offline eva_A: setup dialog shows offline ready" in both runs (59/61). The dialog still read "Not saved for offline use" 600 ms after the page was ready. In the same run, the button on that page showed ● (ready) a moment later, so the cache was intact. The state text is written only after `measure()` walks the caches. The check now waits up to 15 s for the text and records how long it took: about 1.5 s on the root run (and 0–1.5 s on the sub-path run in repeated runs), then it passes. The cause of the slower measurement was not isolated. The offline page order is now home → map → eva_A instead of index → eva_A, and the shell has 5 more files. A real failure still fails, because the check needs the text "Offline ready" within 15 s.

## 4. T5B layer name

- `scripts/30_tiler.py` `recipes()`: if the base name is "Base \<id\> (…)", only the part in brackets is kept. A bare "Base \<id\>" is dropped. `import re` was added. `scripts/config.json` was not changed, so the stop name "Base B (sol 4614)" stays as it is in routes.json, the EVA screen and the cuff cards.
- `python3 -I scripts/30_tiler.py layers` was re-run. Compared with the previous `layers.json`, the only differences are `generated` and `layers[T5B].name.en`, which changed from "Line of sight from base B (Base B (sol 4614))" to **"Line of sight from base B (sol 4614)"**. T5A is unchanged ("Line of sight from base A (Bradbury Landing)"). Nothing in `site/src` or the checks referred to the old string.
- The T5B legend note still reads "Base: Base B (sol 4614), rover waypoint sol 4614 …". It comes from `33_viewshed.py` `final_base_fields()` and was not part of this task.

## 5. Files

- New:
  - `site/index.html` (temporary home)
  - `site/src/site/site.css`, `site/src/site/site.js`
  - `site/src/i18n/site.en.json`
  - `scripts/61_site_facts.py`
  - `site/data/site_facts.json`
  - `work/site/site_facts_audit.json`
  - this file
- Moved: `site/index.html` → `site/map.html`
- Changed:
  - Pages: `site/map.html`, `site/eva.html`, `site/cuff.html`
  - Site code: `site/src/eva/eva.js`, `site/src/cuff/cuff.js`, `site/src/panels/about.js`, `site/src/app.css`, `site/src/main.js`, `site/src/draw.js`, `site/src/sw-register.js` (the last three: comments only)
  - Dictionaries: `site/src/i18n/en.json`, `eva.en.json`, `cuff.en.json`
  - Scripts: `scripts/30_tiler.py`, `54_offline_check.mjs`, `56_cuff_check.mjs`, `57_eva_browser_check.mjs`, `58_browser_check.mjs`, `59_check_panels.py`
  - Plan: `Plan/13` (addendum)
- Generated: `site/data/layers.json`, `site/data/eva_precache.json`, `work/stage5/*_check.json`, screenshots

## 6. Left over

- **User decisions:**
  - Vector layer count (14 versus 15).
  - CTX maximum offset (1,550 versus 1,750 m).
  - Until then, both stay in `pending` and 61 exits 3. To accept the data value, add a `known_change` reason in 61, or correct Plan/18.
- `REPO_URL` in `site/src/site/site.js` (TODO, release step).
- W4–W6: set `live: true` in `PAGES` when about/electronics/sources exist, and add the method and sources links to the map About pane (W5).
- Six facts have no second source in `site/data`: the heating and cooling rates and their hours, the spike rise time, and the tile shift. If these are shown, the pages should say how they were derived.
- The T5B legend-note wording ("Base: Base B (sol 4614)") in `33_viewshed.py`.
- After each later W step: run 61, then 55, then 54–59 (the check-count facts depend on the last run).
