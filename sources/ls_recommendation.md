# Replacing `Weather/weather.txt` for sol to Ls (recommendation only; nothing implemented)

Written 2026-11-15 for the later Opus step (Plan/17 P1-6b and P2-9).

## 1. The problem

`scripts/21_parse_rems.py` takes Ls per sol from `Weather/weather.txt` (key `soles`, 4745 records, sol 1 to 4995). Ls drives the season bins in `rems_A.json` and `rems_B.json`.

The file's own disclaimer says: "The information contained into this file is provided by Centro de Astrobiologia (CAB) and is intended for outreach purposes only. Any other use is discouraged. CAB will take no responsibility for any result or publication made base on the content of this file. To access REMS scientific data, visit PDS at http://pds.nasa.gov."

The download URL of the file was not recorded, and its `ls` values are whole degrees.

## 2. Do the REMS PDS files carry Ls? No.

Checked in `Weather/pds_rems/mslrem_1001/`:

- `LABEL/MODRDR6.FMT` defines 40 columns: TIMESTAMP, LMST, LTST, wind, brightness (ground) temperature, boom air temperatures, ambient temperature, UV channels, humidity, pressure, and confidence-level columns. No Ls or season column.
- `LABEL/ENVRDR6.FMT` (71 columns) has none either. Its only "solar" entries are LMST and LTST (time) and a solar zenith angle byte inside a UV confidence field.
- A product `.LBL` (checked `RME_775536674RMD42590000000_______P1.LBL`) has no Ls, season or solar-longitude keyword.
- `LABEL/ADR_GEOM6.FMT` has a column named `SOLAR_LONGITUDE_ANGLE`. Its description is "Solar azimuth angle relative to REMS rover frame ... Range of -180 to 180 degrees". It is a Sun direction in the rover frame, not areocentric Ls. `ERRATA.TXT` item 3 says it was renamed from SOLAR_AZIMUTH. Do not use it as Ls. The ADR products (about 4.4 GB) were not downloaded anyway.

Conclusion: the PDS files give LMST and a timestamp, but no Ls.

## 3. Recommendation

Compute Ls from the time of each sol with the published Mars24 / Allison and McEwen (2000) formulas. Use the MODRDR `TIMESTAMP` (column 1) as the time, not a sol-to-date table.

Why this one:

- It needs no CAB file, so the outreach-only restriction no longer applies.
- `TIMESTAMP` is "Number of seconds since noon 1-Jan-2000" (MODRDR6.FMT). That is a J2000 offset, so days since J2000 = TIMESTAMP / 86400. The spacecraft-clock to TT difference is a few seconds at most. Ls moves about 0.5 degree per Earth day, so seconds are irrelevant.
- The data to compute from is already read by the script. Use the median TIMESTAMP of each sol's file.
- It is a published method with a stated source, which the README can cite.

Formulas (Mars24 algorithm page, https://www.giss.nasa.gov/tools/mars24/help/algorithm.html , read 2026-11-15). Angles in degrees, d = days since J2000 (JD_TT - 2451545.0):

```
M      = 19.3871  + 0.52402073  * d
a_FMS  = 270.3871 + 0.524038496 * d
PBS    = sum_{i=1..7} A_i * cos(0.985626 * d / tau_i + phi_i)
nu - M = (10.691 + 3.0e-7 * d) sin M + 0.623 sin 2M + 0.050 sin 3M
         + 0.005 sin 4M + 0.0005 sin 5M + PBS
Ls     = (a_FMS + (nu - M)) mod 360
```

| i | A_i | tau_i | phi_i (deg) |
|---|---|---|---|
| 1 | 0.0071 | 2.2353 | 49.409 |
| 2 | 0.0057 | 2.7543 | 168.173 |
| 3 | 0.0039 | 1.1177 | 191.837 |
| 4 | 0.0037 | 15.7866 | 21.736 |
| 5 | 0.0021 | 2.1354 | 15.704 |
| 6 | 0.0020 | 2.4694 | 95.528 |
| 7 | 0.0018 | 32.8493 | 49.095 |

Sources to cite (both named on the Mars24 page; DOIs confirmed with Crossref):

- Allison, M., and M. McEwen (2000), A post-Pathfinder evaluation of areocentric solar coordinates with improved timing recipes for Mars seasonal/diurnal climate studies, Planet. Space Sci., 48, 215-235, doi:10.1016/S0032-0633(99)00092-6.
- Allison, M. (1997), Accurate analytic representations of solar time and seasons on Mars with applications to the Pathfinder/Surveyor missions, Geophys. Res. Lett., 24, 1967-1970.

The Mars24 page states no accuracy figure; do not quote one. Say "computed with the Mars24 algorithm" and show the check below.

## 4. Checks already done (scratchpad only, not in the repo)

A throwaway script compared the formula with `weather.txt` for all 4745 sols, using each record's `terrestrial_date` at 12:00 UT (TT - UTC = 69.184 s):

- Largest absolute difference 1.61 degrees; mean +0.77; standard deviation 0.33. The positive offset is expected: CAB's values are whole degrees (apparently truncated) and the date is taken at noon.
- Sol 1: formula 151.36, CAB 150. Sol 4995 (2026-08-25): formula 341.56, CAB 341.
- With the MODRDR timestamp instead (sol 4259, TIMESTAMP 775536724, LMST 00:01): 302.17 degrees; CAB lists 302 for sol 4259 (2024-07-30). Agrees.
- Counting 30-degree bins on the date-based numbers, 41 of 4745 sols fall in a different bin than CAB's integer would give. The timestamp-based value should cut that but cannot remove it, because CAB's integers are rounded.

## 5. What the Opus step must do

1. In `scripts/21_parse_rems.py`, replace `load_ls()` (reads `weather.txt`) with a function `ls_from_timestamp(ts)` using the formulas above. Take the sol's time from the MODRDR TIMESTAMP column; add TIMESTAMP to the `NEED` column list and to the per-file cache in `work/stage2/rems_cache/` (the cache currently holds LMST-hour aggregates, so it must be rebuilt or extended).
2. Keep `ls` as a float in the sol rows (`ls: 302.17`) and keep the existing 30-degree bin logic.
3. Acceptance for P2-9: "season bins unchanged within 1 degree". Compare old and new per sol. Expect differences of up to about 1.6 degrees against `weather.txt`, mostly from CAB's integer values. List the sols that change bin and judge them one by one; the 41 date-based bin changes above are the number to beat. If a bin change moves a sol across a season boundary in the A or B route periods, report it.
4. Update `rems_*.json` meta: `ls` source becomes "Mars24 algorithm (Allison and McEwen 2000)"; drop the `Weather/weather.txt` mention and the `ls_note` about sols missing from `weather.txt`.
5. Re-run 55, 54 and 59 as for P2-1.
6. Keep `Weather/weather.txt` in place as a cross-check only. In the README, state: "Ls is computed with the Mars24 algorithm; CAB's outreach JSON was used only to cross-check."

## 6. If the team keeps weather.txt instead

State in the README: "Solar longitude per sol was taken from the CAB REMS daily weather file, which its provider describes as 'intended for outreach purposes only. Any other use is discouraged', with no responsibility accepted for results based on it." The URL stays a gap. This is the weaker option: it relies on a file the provider discourages for other uses, with no recorded source, and the formula replacement is small.

## 7. Open points

- `weather.txt` URL: not recoverable from the file, the logs or the transcripts. A guessed CAB widget address returned 404. The CAB REMS home is https://cab.inta-csic.es/rems/ . Ask the project owner where the file came from.
- The Mars24 page does not publish an accuracy figure. If one is needed in the README, take it from the Allison and McEwen paper itself (not read here).
