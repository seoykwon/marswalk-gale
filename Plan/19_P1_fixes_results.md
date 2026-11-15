# 19. Stage 6 P1 fixes: results

2026-11-15. Scope: Plan/17 section 9 items P1-1, P1-2, P1-3, P1-4, P2-3, P2-4, plus the user's decisions (English only; name "Marswalk").
Not touched: `scripts/20_parse_rad.py`, `scripts/21_parse_rems.py`, `site/data/rad.json`, `site/data/rems_*.json`, raw data folders. Nothing was deleted. No git commit.

## 1. Changes per item

### P1-1 EVA control bar off-screen

- `site/src/eva/eva.css`: the four body children now have explicit rows (`.ebar` 1, `.banner` 2, `.egrid` 3, `.ectl` 4). A hidden banner leaves row 2 empty (0 height) instead of shifting the main grid up and the control bar into the `1fr` row.
- `scripts/57_eva_browser_check.mjs`: new section 6. At 1024×768, 768×1024, 390×844 and 360×640, with the banner hidden (route B at 170 m) and shown (route B at 1,600 m, slope caution), it checks that both `#btn-play` and `#btn-turn` lie fully inside the viewport, that `scrollY` is 0, and that it stays 0 after `scrollTo(0, 100000)`. It also checks that the banner really is in the requested state. Screenshots: `work/stage5/eva_screens/40_ctlbar_*.png`.

| Viewport | Play top–bottom (px) | Turn back top–bottom (px) | Same with banner shown | scrollY |
|---|---|---|---|---|
| 1024×768 | 628–700 | 628–700 | same | 0 |
| 768×1024 | 824–896 | 824–896 | same | 0 |
| 390×844 | 639–711 | 639–725 | same | 0 |
| 360×640 | 419–491 | 419–526 | same | 0 |

Before the fix, the top of Play was 778 / 1,034 / 854 / 650 px (Plan/17 5-3), below the viewport. The bar stays in place when the banner shows; the card list (row 3) gets shorter instead.

### P1-2 English only

- Language buttons removed from `index.html`, `eva.html` and `cuff.html`.
- `site/src/i18n.js`: loads only `en.json`. No `SUPPORTED` list, no `setLang` / `onLangChange` / `getLang`, no localStorage key, and it never writes `lang=` to the URL. `?lang=` is ignored, so `?lang=ko` renders English. `pick()` reads only `*_en` / `.en` fields.
- `site/src/eva/ei18n.js`: loads only `eva.en.json`.
- `site/src/cuff/cuff.js`: loads only `cuff.en.json` and `eva.en.json`. It drops `lang` from its URL and links.
- `site/src/eva/eva.js`, `site/src/main.js`: language handlers removed. `eva.js` `writeUrl` deletes `lang`. The links to the planning page carry no `lang`.
- `site/src/panels/route.js`: the EVA and cuff links no longer carry `lang`.
- `site/src/layerlist.js`: layer names, legends and "limits" come from the English fields and `en.json` `layers.limits.<id>` only. The Korean branch that read `limits_ko` from `layers.json` is gone. All 11 own tile layers have an English limits entry.
- `site/src/sw-register.js`: offline-control strings come from `en.json` / `eva.en.json` only. The `<html lang>` observer is removed.
- `site/src/eva/selftest.js`: the "eva.en.json vs eva.ko.json keys" case is replaced by "every `data-et` / `data-et-aria` key on the page exists in eva.en.json", so the self-test still has 77 cases.
- CSS: `.lang` rules removed from `app.css`, `eva/eva.css` and `cuff/cuff.css`.
- Dictionaries: `site/src/i18n/ko.json`, `eva.ko.json` and `cuff.ko.json` were **moved** to `work/retired_i18n/`, not deleted. The `hdr.lang_label` and `screen.lang` keys were dropped from the English files. The `_comment` lines no longer mention ko.
- Precache: `python3 -I scripts/55_eva_precache.py` was re-run. New version `f254ad5110ff`, 13.34 MB. The i18n files listed are `en.json`, `eva.en.json` and `cuff.en.json`.
- Check scripts, Korean cases removed:
  - 54: the `eva_A_ko` offline page is gone. Added the check "precache lists no *.ko.json".
  - 56: the ko layout/PDF combos are gone. `B 11:00 Ls 270 ko` is now English. The en/ko key-structure check is gone. Added "?lang=ko renders English (no language buttons, no Hangul, title Marswalk · Cuff checklist)". Bad-parameter fallback now expects `en`. Index links must carry no `lang`.
  - 57: the Korean section and the "URL contract after language switch" check are gone. Added the `?lang=ko` English check (title `Marswalk · EVA`, `SIMULATION`, 0 language buttons, no Hangul).
  - 58: the Korean screenshots and draw-panel Korean step are gone. Added an `en_only` probe of `index.html?lang=ko`.
  - 59: the link contract no longer expects `lang`. Added row `en_only.index_lang_ko`.
- Generated data (`layers.json`, `routes.json`) still carries `name.ko`, `limits_ko`, `legend.*_ko`, `name_ko` and `note_ko`. Nothing reads them. `30_tiler.py` and `40_route_profile.py` were not changed, which the P1-2 row allows.

### P1-3 Route A–B gap sentence

The sentence below was added exactly as written in the P1-3 row:

> Route A and route B rates were measured 13 years apart (2012–13 and 2025). The difference between them must not be read as an effect of altitude or location; this data cannot separate the two.

It went into three places:
- `en.json` `rad.limits_short`, appended. This shows under the route panel dose block for both routes.
- `en.json` `rad.limits`, as a new list item after the "no spatial map" item. This is the radiation panel limits list for both periods.
- `eva.en.json` `disc.full`, after the RAD sentence. This is the EVA setup disclaimer for both routes.

### P1-4 Name "Marswalk"

- `<title>` and the title set by JS:
  - `index.html`: "Marswalk · Map" (`ui.doc_title`)
  - `eva.html`: "Marswalk · EVA" (`doc_title`)
  - `cuff.html`: "Marswalk · Cuff checklist" (`doc_title`)
- Planning header: "Marswalk" (`ui.app_title`) with the subtitle "Gale Crater EVA planner" (`ui.app_sub`). As before, the subtitle is hidden below 1000 px.
- Cuff screen heading: "Marswalk · Cuff checklist (print)".
- Cuff card footer: the new `card.footer` text "Marswalk · Gale Crater EVA planner" is the last line of the contingency ("IF…") card.
  - I tried the summary card first. It overflowed its 60 mm box (A: 15 px, B: 1 px; caught by script 56), so I moved the footer to the contingency card, which has free space.
  - The printed PDF shows it at the foot of that card.
- "Gale EVA Planner", "Gale EVA Replay (simulation)" and "Gale EVA cuff checklist" are gone from `site/`. "Gale Crater EVA planner" remains only as the requested subtitle and in the footer.
- No `README` exists yet, so there was nothing to rename there.
- The map was not moved to `map.html` (that is Plan/18's job).

### P2-3 E detector wording

- Glossary `E`: "RAD's plastic scintillator; used here as the body-side reading."
- `rad.body_E` and `eva` `dose.crew`: "Body-side reading (plastic detector E)".
- `rad.E_short`: "E (plastic)".
- `src/eva/state.js` code comment changed to match.
- No paper is cited. No "tissue" text is left in `site/src` or the HTML.

### P2-4 QC wording

- `en.json` `rad.limits[5]` (it was index 4; the new P1-3 item moved it down one): "Observations whose QC flag is not 00000000 are excluded. RAD_RDR_SIS 4.2.1.2 defines 00000001 as 'unknown quality control issues may exist'."
- Glossary `QC`: "8-character quality flag on each RAD observation. RAD_RDR_SIS 4.2.1.2 defines 00000000 as no issue and 00000001 as 'unknown quality control issues may exist'."
- `scripts/20_parse_rad.py` was not touched.

## 2. Regression (headless Chrome, server `python3 -m http.server 8772` from `site/`, stopped afterwards)

| Check | Result | Before (Plan/17) | Why the count changed |
|---|---|---|---|
| `node scripts/54_offline_check.mjs` (own servers 8768/8769) | **53/53 pass** | 64/64 | `eva_A_ko` page removed from the root and sub-path runs (−12); precache no-ko check added (+1) |
| `node scripts/56_cuff_check.mjs http://127.0.0.1:8772/` | **51/51 pass** | 75/75 | two ko layout/PDF combos removed; ko key check removed; footer and `?lang=ko` checks added |
| `node scripts/57_eva_browser_check.mjs http://127.0.0.1:8772/` | **83/83 pass**, self-test 77/77 | 77/77 | 3 Korean checks removed; 8 control-bar checks and 1 English check added |
| `node scripts/58_browser_check.mjs http://127.0.0.1:8772/` | 0 console errors, 0 exceptions, 0 HTTP errors, 0 tile 404 | same | — |
| `python3 -I scripts/59_check_panels.py` | **124/124 pass**, nothing uncovered | 123/123 | + `en_only.index_lang_ko` |

## 3. Hangul left in `site/` (`.html`, `.js`, `.json`)

| File | Fields | Why it stays |
|---|---|---|
| `site/data/layers.json` | `name.ko` (13), `limits_ko` (11), `legend.note_ko` (9), `legend.classes[].label_ko` (7), `legend.low_ko` / `high_ko` (2 each) | Generated by `30_tiler.py`. Not read by any code now. Can be dropped in the tiler later |
| `site/data/routes.json` | `meta.limits_ko`, `name_ko`, `env.note_ko`, `stops[].name_ko`, `stations[].name_ko` | Generated by `40_route_profile.py`. Not read |

No Hangul is left in any `.html`, any `.js` or any `src/i18n/*.json`.

## 4. Left over

- `site/data/rad.json` meta still says "E detector, plastic scintillator (tissue-like)" and "QC bit meaning is not documented". It is not shown on any page. It is for the agent that regenerates `rad.json` through `20_parse_rad.py` (P2-4 script part).
- `rad.r5_note` still says "the normalisation of the RAD histogram is not documented". That is about the LET histogram, not QC, and was not verified either way, so it was left.
- Old Korean screenshots and PDFs from earlier runs (`work/stage5/screens/18_routeB_ko.png`, `19_rad_ko.png`, `23_draw_ko.png`, `work/stage5/cuff/*_ko.*`, `work/stage5/eva_screens/3*_ko.png`) remain in `work/`. They were not deleted (no deletions without confirmation).
- The CSS font stacks still list "Apple SD Gothic Neo" / "Noto Sans KR". This is harmless and can be cleaned up later.
- `*_ko` fields in generated JSON: optional cleanup in `30_tiler.py` / `40_route_profile.py` (see section 3).
- Only headless Chrome was used. Safari and Firefox are still P2-8.
