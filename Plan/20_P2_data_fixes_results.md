# 20. Stage 6 P2 data-pipeline fixes: results

2026-11-15. Scope: Plan/17 section 9 items P2-9, P2-1, P2-2, P2-4 (data side), P2-5, P2-6, P2-7, plus dropping the unused `*_ko` fields and checking `rad.r5_note` against the RAD SIS.
Raw data folders were only read. Nothing was deleted (`42_t5_finalize.py` was moved). No git commit. Python was run as `python3 -I`; no packages were installed.

## 1. Changes per item

### P2-9 Ls source: Mars24 instead of `Weather/weather.txt`

- New module `scripts/ls_mars24.py`: the Mars24 equations A-2 to A-6 and B-1 to B-5 (https://www.giss.nasa.gov/tools/mars24/help/algorithm.html; Allison and McEwen 2000, doi:10.1016/S0032-0633(99)00092-6). It has functions `ls_from_dt_j2000(d)`, `ls_from_timestamp(ts)` and `ls_from_utc(dt)` (with a 1999–2026 leap-second table). Running `python3 -I scripts/ls_mars24.py` performs a self-check against three published anchors:

| Anchor | UTC | Computed | Published | Diff | Source |
|---|---|---|---|---|---|
| Mars24 worked example A | 2000-01-06 00:00:00 | 277.18759 | 277.18758 | +0.00001 | Mars24 algorithm page, Example A |
| Mars24 worked example B (Spirit) | 2004-01-03 13:46:31 | 327.32416 | 327.32416 | 0.00000 | Mars24 algorithm page, Example B |
| MSL landing | 2012-08-06 05:18:00 | 150.70293 | **150.7** | +0.003 | Washington Univ. Analyst's Notebook "MSL mission" page ("Solar Longitude L=150.7", "August 6, 2012, 05:18 UTC Spacecraft Event Time"); HiRISE ESP_028256_9022 lists "Solar longitude 150.7°" |

  The brief suggested Ls ≈ 150.6 for the landing. No source I found gives 150.6. Both sources I read give **150.7**, and the formula gives 150.70.
- `scripts/21_parse_rems.py`:
  - `TIMESTAMP` (MODRDR column 1, "seconds since noon 1-Jan-2000") was added to the columns read.
  - For each row, the parser computes the Earth time of LMST 12:00 of that row's sol: `TIMESTAMP − (LMST s − 43200) × 1.0274912517`. The mean of these values per sol gives the sol's noon time.
  - Ls for each sol is `ls_from_timestamp(noon)`, rounded to 2 decimals. `load_ls()` and the read of `weather.txt` are gone.
  - The cache key was bumped (`noon_ts_v2`) so all 1,035 caches were rebuilt (23 s).
  - The meta `sources.ls` now names Mars24 and the module. `sol_row_cols.ls` says "at LMST 12:00". `ls_note` (about sols missing from weather.txt) was removed.
- `sources/sources.json` entry `LS`: changed to the Mars24 computation with citations. `weather.txt` is now a cross-check only, and `gap` is false.
- Cross-check against `weather.txt`: the comparison script is in the scratchpad and is not part of the pipeline.
  - CAB's integer equals **floor(Ls at the start of the sol)** for 993 of the 1,009 route sols it lists: all 325 route A sols and 668 of 684 route B sols. The 16 misses are by ≤0.03°.
  - Our noon values are 0.22–1.31° above CAB (mean +0.79 A, +0.75 B, SD 0.29). So the whole offset comes from truncation plus half a sol (~0.3°). It is not a formula error.
- Season-bin changes (30° bins, `diurnal_by_ls30`):
  - The set of keys is **unchanged**: A has 0, 150–330 (8 keys); B has 0–330 (12 keys).
  - Sols that moved bin: **10 of 1,009** (A 4, B 6). All of them are sols where CAB's floor is x9° and the noon value is just past the boundary (≤1.15° over). All 10 are full sols (≥20 h). The brief's earlier estimate was 41 of 4,745 for the whole mission with date-based values; these 10 are the ones in the two route periods.

| Route | Sol | CAB Ls | New Ls | Bin |
|---|---|---|---|---|
| A | 103 | 209 | 210.08 | 180 → 210 |
| A | 150 | 239 | 240.15 | 210 → 240 |
| A | 196 | 269 | 270.08 | 240 → 270 |
| A | 350 | 359 | 0.07 | 330 → 0 |
| B | 4255 | 299 | 300.03 | 270 → 300 |
| B | 4306 | 329 | 330.14 | 300 → 330 |
| B | 4488 | 59 | 60.00 | 30 → 60 |
| B | 4555 | 89 | 90.13 | 60 → 90 |
| B | 4679 | 149 | 150.00 | 120 → 150 |
| B | 4830 | 239 | 240.01 | 210 → 240 |

  - 26 route B sols that `weather.txt` does not list (`ls` was null and they were in no curve) now have Ls. 12 of them are full sols and now join curves: 8 in bin 0 (sols 4373, 4397–4403, 4418), 1 in bin 90 (4615) and 2 in bin 180 (4760, 4777).
  - Contents per key, as sols per bin (before → after) and the largest change of any hourly mean (GTS or air):

| Key | A sols | A max abs. ΔT (K) | B sols | B max abs. ΔT (K) |
|---|---|---|---|---|
| 0 | 7 → 8 | 1.2 | 45 → 54 | 0.8 |
| 30 | — | — | 63 → 62 | 0.2 |
| 60 | — | — | 66 → 66 (one in, one out) | 0.3 |
| 90 | — | — | 61 → 63 | 0.3 |
| 120 | — | — | 58 → 57 | 0.5 |
| 150 | 37 (unchanged) | 0 | 44 → 45 | 0.5 |
| **180** (A default) | 49 → 48 | 0.2 | 18 → 20 | 0.9 |
| 210 | 47 → 47 (one in, one out) | 0.3 | 40 → 39 | 0.4 |
| **240** (B default) | 41 → 41 (one in, one out) | 0.4 | 36 → 37 | 0.5 |
| 270 | 22 → 23 | 0.4 | 43 → 42 | 1.1 |
| 300 | 44 (unchanged) | 0 | 51 → 51 | 0.4 |
| 330 | 56 → 55 | 0.3 | 54 → 55 | 0.6 |

  - Default seasons:
    - A 180: GTS min 192.6 K and max 282.6 K, both unchanged.
    - B 240: GTS min 197.4 → 197.3 K and max 279.0 → 278.9 K. The range stays 81.6 K.
  - The missing-hour gaps are unchanged (A 240 hours 7–8, A 270 hours 7–9, A 300 hours 8–9, B 180 hour 7, B 270 hours 9–10), so the self-test "B Ls 270 09:30 interpolated" case still applies.
  - Acceptance "season bins unchanged within 1°": every sol's Ls is within 1.31° of CAB's integer. Once CAB's own truncation at the start of the sol is allowed for, the difference is ≤0.99°. Only the 10 boundary sols above change bin.
  - Choice recorded: Ls is taken at LMST noon (mid-sol). Taking it at the start of the sol would reproduce CAB's bins almost exactly. Noon was kept because it represents the whole sol's curve.
- Other `rems_*.json` content is identical to before: `summary`, `range_hist_5K`, hourly rates, `recent_year_4175_4843`, and every sol row except `ls`. `rems_B.json` grew from 279,831 to 290,630 B because of the 2-decimal Ls values and the 26 new values.

### P2-1 R4 chart re-run

- `21_parse_rems.py` was re-run after `20_parse_rad.py`. `r4_rad_pressure.n_rad_valid_obs` = **19,502** and the sol-mean n = **231** (accepted).
- `en.json` `rad.r4_src` now reads: "Source: rad.json recent period ({n} valid RAD observations, sols 4613–4843) and REMS MODRDR pressure; {m} observations have a pressure value in the same sol and LMST hour." Rendered: "… (19,502 valid RAD observations …); 18,327 observations have a pressure value …".
- Plan/07: an English update block with the new R4 table was appended at the end. The numbers are in the table in section 2 below.

### P2-2 Early-period sol count

- `scripts/20_parse_rad.py`: `n_sols` is now the number of sols with `n_valid` > 0. A new field `n_sols_with_dose_obs` keeps the old count, and `n_sols_note` explains it. Values: early **300** (was 332), recent 231 (unchanged).
- Route A route panel (headless Chrome, `index.html?route=A&tab=route`) reads "**14,059 valid observations, 300 sols**". The radiation panel for the early period uses the same field.
- `sol_table` still lists all 332 early sols with dose observations. The 32 sols without a valid observation have `n_valid` 0 and null means, and they plot as gaps in R1, as before.

### P2-4 (data side) rad.json meta wording

- `meta.units.E`: "E detector, plastic scintillator; used here as the body-side reading". The word "tissue-like" is gone.
- `meta.filter.note`: "Observations whose QC flag is not 00000000 are excluded. RAD_RDR_SIS 4.2.1.2 defines 00000001 as "unknown quality control issues may exist". Only "00000000" and "00000001" occur in the data." No "not documented" text remains in `rad.json`.

### P2-5 LET bins per period

- `scripts/20_parse_rad.py` determines the bin count of each file as follows:
  - In the recent format, it reads `NUM_COLS` in each `[DOSIMETRY_LET_B_A1/A2]` block (52).
  - In the early format (no `NUM_COLS`), it uses the length of the centre row (44).
  - It raises an error if centre, width and count rows differ in length, if `NUM_COLS` disagrees with the row length, or if bins differ within a file or within a period.
- The bins are stored in `periods.<p>.let` as `centre_keV_um`, `width_keV_um`, `n_bins` and `n_bins_from`. `meta.let_bins` (44 bins only) was removed.
  - Result: early has 44 bins from 301 files; **recent has 52 bins** from 231 files, from NUM_COLS (52). The summed counts are identical to before.
- `scripts/50_export_config.py`: `let_grid_recent()`, the raw-file read and `let_bins_by_period` were removed. `site/data/config.json` has **no LET block** (4,585 → 1,946 B).
- `site/src/panels/radiation.js`: `const bins = P.let;`. The R5 caption reads "**52 bins**, counts ÷ total ÷ bin width" for the recent period (rendered and checked).

### P2-6 Self-test reference table from script 44

- `scripts/44_route_validate.py` writes `site/data/selftest_ref.json` (4,218 B) with:
  - the 7 turnaround scenarios (labels, limits, binding, D−R, turnaround distance, maximum stay, L_k);
  - a `spike` block: sol and UTC, 6 h E/B dose for starts at 09:00 and 10:00, and the hours until the E budget is reached.

  The spike sol is taken from `rad.json`.
- `site/src/eva/selftest.js`: the hand-typed `PY_REF` array and the fixed 65.3 / 64.6 / 4.58 / 63.0 / 62.6 values are gone. `runSelftest(core, ref)` reads them from the JSON. The spike cases compare with a tolerance of 0.1 µGy (dose) and 0.02 h (budget time).
- `site/src/eva/eva.js` loads `data/selftest_ref.json` (via `site/src/data.js` key `selftestRef`) only when `?selftest=1`. The precache shell picks it up automatically (`data/*.json`).
- The new Ls bins proved the mechanism. Route A Ls 180 lost sol 103, so the Python temperature limit for S6/S7 moved from 30,147 to 30,085 s. The page computes 30,054 s, which is within the 60 s tolerance of the new reference but 93 s from the old hand-typed value. That means the old JS would have failed, while the new one passed after re-running 44, with no JS edit.

### P2-7 T5 naming without `42_t5_finalize.py`

- `scripts/30_tiler.py` `recipes()` reads `provisional`, `base_name_en`, `base_sol`, `legend_note_en` and `basis` from `work/stage3/T5_<A|B>_viewshed.json`.
  - A final base must equal `scripts/config.json` routes.<id>.stops[0]. This check moved here from 42.
  - The layer name is "Line of sight from base A (Bradbury Landing)" or "(provisional)".
- `scripts/33_viewshed.py`:
  - New `final_base_fields()`. A `--basis` that starts with "FINAL" at the config base gives `provisional: false` and the three fields above.
  - New `refresh-meta [A B]` subcommand adds them to existing JSONs without recomputing the viewshed. It was run once for A and B.
  - Before this change, 33 always wrote `provisional: true` and needed 42 afterwards.
- `scripts/42_t5_finalize.py` was **moved** to `work/retired_scripts/42_t5_finalize.py`.
- `python3 -I scripts/30_tiler.py layers` alone now gives the final names, notes and `base` objects (including `sol`). Compared with the previous `layers.json` (42 output), with Korean fields and the `generated` timestamp ignored, the output is **identical**.
- B2's "(잠정)" was in its `limits_ko`, which no longer exists. The English B2 limits text in `en.json` never had it.

### Unused `*_ko` fields dropped

- `scripts/30_tiler.py`:
  - Fields removed: `name_ko` (11 layers, 2 external layers, as `name.ko`), `limits_ko`, `legend.low_ko` / `high_ko` / `note_ko` and `classes[].label_ko`.
  - `layers.json` shrank from 20,131 to 16,976 B, with 0 `_ko` keys and 0 Hangul characters.
- `scripts/40_route_profile.py`:
  - Fields removed: `env.note_ko`, `name_ko` on routes, stops and stations, and `meta.limits_ko`.
  - The Korean meta limits sentence became `meta.limits_en`, so its content is kept.
  - `routes.json` was regenerated (1 s): 108,346 → 107,191 B, 0 Hangul. Ignoring `_ko`, `limits_en` and `generated`, it is **identical** to before.
- Nothing reads them: a grep over `site/src`, the HTML, `sw.js` and scripts 44/50–59 finds no `.ko`, `_ko` or `['ko']` reads. The comment in `layerlist.js` was updated.

### `rad.r5_note` and the RAD SIS

- `RAD_RDR_SIS.HTM` 4.2.1.6 (Dosimetry) says that LET is "a 1-D (vector) array of E(B), containing counts in bins of energy deposited in B", normalised by the detector thickness (keV/µm). It gives no time or dead-time normalisation for the LET arrays. Section 4.2.1.4 gives a normalisation (events/read, live-time fraction) only for the particle histograms (SP/PP/neutral).
- New `en.json` `rad.r5_note`: "Shape only. RAD_RDR_SIS 4.2.1.6 describes the LET arrays as counts in bins of energy deposited in detector B, divided by the detector thickness (keV/µm); it gives no time normalisation for them. The values match counts divided by the live-time fraction of each observation; here they are summed over valid observations. No absolute flux and no SEE rate are derived. …"
- `rad.json` `meta.let_normalisation` has the same content and cites 4.2.1.6 and 4.2.1.4.

## 2. Key numbers before and after

| Quantity | Before | After | Why |
|---|---|---|---|
| RAD early: n_valid, B / E mean (µGy/h) | 14,059; 9.029 / 8.746 | same | — |
| RAD early `n_sols` | 332 | **300** | P2-2 (valid sols only) |
| RAD recent: n_valid, n_sols, B / E mean | 19,502; 231; 6.898 / 6.434 | same | — |
| RAD validation sols 4710–4843 | all reference values | identical | — |
| LET bins early / recent | 44 / 44 in meta (52 in config) | 44 / **52** in rad.json | P2-5 |
| R4 n_rad_valid_obs / matched | 18,060 / 16,926 | **19,502 / 18,327** | P2-1 re-run |
| R4 r(E,P) obs / sol-hour / sol-mean / within-sol | −0.239 / −0.251 / −0.176 / −0.429 | **−0.206 / −0.216 / −0.133 / −0.437** | P2-1 |
| R4 r(B,P) same levels | −0.146 / −0.205 / −0.231 / −0.125 | **−0.127 / −0.180 / −0.189 / −0.128** | P2-1 |
| R4 n sol-hour / sol-mean | 4,795 / 214 | **5,191 / 231** | P2-1 |
| R4 E slope (% per Pa) | −0.0196 | **−0.0169** | P2-1 |
| REMS A summary (325 sols, 303 full, range 77.6 / 95.2 / 60.1 K, 185.7–288.5 K) | — | identical | — |
| REMS B summary (710 sols, 591 full, range 83.3 / 111.0 / 59.8 K, 166.9–288.6 K); recent year 561 / 83.1 K | — | identical | — |
| Season curves | see the P2-9 table | ≤1.2 K per hourly mean; default seasons ≤0.1 K at min/max | P2-9 |
| Route A one-way / round trip / walk time / with stay | 585.5 m / 1,170.9 m / 1,816.3 s / 3,616.3 s | same | — |
| Route B one-way / round trip / walk time / with stay | 1,824.5 m / 3,649.1 m / 7,430.1 s / 9,230.1 s | same | — |
| Route doses (planned EVA) A E / B; B E / B | 8.8 / 9.1; 16.5 / 17.7 µGy | same | — |
| Turnaround S1–S5 (route B): limits, binding, D−R, maximum stay, L_k | — | identical | — |
| S1/S5 ground temperature at start; S4 | 252.4 K; 275.4 K | 252.7 K; 275.2 K | B Ls 240 curve (P2-9) |
| S6/S7 (route A) temperature limit | 30,147 s (8.374 h) | **30,085 s (8.357 h)** | A Ls 180 lost sol 103 (P2-9); binding stays "dose" |
| S6/S7 binding, D−R, maximum stay, L_k | dose, 18,781 s, 16,965 / 15,148 s | same | — |
| Spike day 6 h dose, start 09:00 E / B | 65.3 / 64.6 µGy | **65.3 / 64.6** | unchanged |
| Spike day 6 h dose, start 10:00 E / B; E budget reached | 63.0 / 62.6; 4.577 h | same | — |
| Precache shell | e50464e978ff, 45 files | ef968de198cf, 46 files (+ `selftest_ref.json`) | tiles and extras versions unchanged |

No number outside the expected ones changed.

## 3. Regeneration order (all run)

1. `20_parse_rad.py`: rebuilt all 564 caches (key bump), 0 skipped, 8 s.
2. `21_parse_rems.py`: rebuilt all 1,035 caches, 23 s.
3. `33_viewshed.py refresh-meta`.
4. `30_tiler.py layers`.
5. `40_route_profile.py`.
6. `44_route_validate.py`: 34/34 checks pass, writes `selftest_ref.json`.
7. `50_export_config.py`.
8. `55_eva_precache.py` (13.35 MB).

## 4. Regression (headless Chrome, `python3 -m http.server 8773` from `site/`, stopped afterwards)

| Check | Result | Before (Plan/19) | Expected values changed? |
|---|---|---|---|
| `node scripts/54_offline_check.mjs` (own servers 8768/8769) | **53/53 pass** | 53/53 | no |
| `node scripts/56_cuff_check.mjs http://127.0.0.1:8773/` | **51/51 pass** | 51/51 | no |
| `node scripts/57_eva_browser_check.mjs http://127.0.0.1:8773/` | **83/83 pass**, self-test **77/77** | 83/83, 77/77 | no (the self-test now reads `selftest_ref.json`; case count unchanged) |
| `node scripts/58_browser_check.mjs http://127.0.0.1:8773/` | 0 console errors, 0 exceptions, 0 HTTP errors, 0 tile 404 | same | no |
| `python3 -I scripts/59_check_panels.py` | **124/124 pass**, nothing uncovered | 124/124 | no hard-coded value needed editing. Values it reads from JSON moved as expected: `rad.r4.r_E_obs` −0.239 → −0.206; `route.B.gts_min` 197.4 → 197.3 K |

No check script was edited. The changed numbers, the sol count and the season curves are read from the JSON by the checks.

One flaky run: the first run of 57 crashed **after** finishing, in the temp-profile cleanup (`fs.rmSync` ENOTEMPTY on the Chrome profile dir, while Chrome was still writing). The immediate re-run exited 0 with 83/83. This is a cleanup race in the script, not a page failure.

## 5. Files changed

- New:
  - `scripts/ls_mars24.py`
  - `site/data/selftest_ref.json`
  - `work/retired_scripts/42_t5_finalize.py` (moved)
  - this file
- Scripts:
  - `scripts/20_parse_rad.py`
  - `scripts/21_parse_rems.py`
  - `scripts/30_tiler.py`
  - `scripts/33_viewshed.py`
  - `scripts/40_route_profile.py`
  - `scripts/44_route_validate.py`
  - `scripts/50_export_config.py`
- Site code:
  - `site/src/panels/radiation.js`
  - `site/src/eva/selftest.js`
  - `site/src/eva/eva.js`
  - `site/src/data.js`
  - `site/src/layerlist.js` (comment only)
  - `site/src/i18n/en.json` (`rad.r4_src`, `rad.r5_note`)
- Generated:
  - `site/data/rad.json`
  - `rems_A.json` and `rems_B.json`
  - `layers.json`
  - `routes.json`
  - `config.json`
  - `eva_precache.json`
  - `work/stage4/validate.json`
  - `work/stage3/T5_{A,B}_viewshed.json`
  - the caches under `work/stage2/`
- Documentation:
  - `sources/sources.json` (`LS` entry)
  - `Plan/07` (English update block)

## 6. Left over

- **README** (none yet) should say: "Ls is computed with the Mars24 algorithm (Allison and McEwen 2000) from the REMS TIMESTAMP at LMST noon; CAB's outreach JSON was used only to cross-check." It should cite the two papers in `sources/sources.json` `LS`.
- **Landing Ls anchor**: published sources give 150.7, not 150.6. Use 150.7 if it is quoted anywhere.
- **T5B name** "Line of sight from base B (Base B (sol 4614))" repeats "Base B", because the config stop is named "Base B (sol 4614)". This is unchanged from before (42 produced the same). It could be fixed by renaming the stop in `scripts/config.json` or by a rule in the tiler.
- `scripts/config.json` still has `name_ko` on route stops (input only; no generated file carries it now).
- The flaky profile cleanup in `57_eva_browser_check.mjs` (and the same pattern in 54/56/58) could retry `rmSync` or wait for Chrome to exit.
- `sol_table` for the early period still has 32 rows with `n_valid` 0. This is intentional (shows the gaps), but the R1 table lists them.
- Section 9 rows from Plan/17 still open: P2-8 (Safari/Firefox, user).
