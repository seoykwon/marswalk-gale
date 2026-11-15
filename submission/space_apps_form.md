# Space Apps 2026 — project form text (paste into each field)

## Project Name
Marswalk: a walking-EVA planner for Gale Crater

## High-Level Project Summary
Marswalk is a layered web map that helps an astronaut plan and carry out a walking EVA (a "Marswalk") in Gale Crater, Mars. It combines data from several NASA missions on one map: MRO HiRISE and CTX imagery, a 1 m HiRISE terrain model, Mars Odyssey THEMIS, MGS MOLA, and Curiosity's own RAD radiation and REMS weather measurements. It turns that data into numbers a crew can act on. For a chosen route it reports distance, walking time, climb, steep-slope sections, radio blind spots to base, radiation dose for the walk, and ground temperature by hour and season. An EVA screen counts down to the turn-back point, which is the earliest of four limits: time, sunset, cold and dose budget. A printable cuff checklist puts the same numbers on the astronaut's wrist. On the Mount Sharp route, the 3,649.1 m round trip takes about 2 h 34 min. It has 3 sections at 15° or steeper (Curiosity tilted 24.0° there) and 856 m out of radio line of sight. The walk adds 16.5 µGy of measured dose. This matters because the first crews on Mars will need to know before they step out whether they can go, and when they must turn back.

## Link to Project Demo
[paste the public link to the slide deck]

## Link to Final Project
[paste the GitHub Pages URL, e.g. https://<your-github-username>.github.io/marswalk-gale/]

## Detailed Project Description
What it does
- Planning map (map.html) with 11 map layers and 14 vector layers. The map layers cover HiRISE colour, CTX, THEMIS day and night IR, thermal inertia, MOLA, hillshade, slope classes, elevation and radio line of sight. The vector layers cover the Curiosity traverse, waypoints, photos, geology, place names and contours.
- Route panel for two routes: a flat reference route from Bradbury Landing to Yellowknife Bay, and a slope route on Mount Sharp. It shows distance, time, climb, slope hazards checked against the rover's recorded tilt, radio blind spots, radiation dose, ground temperature and nearby rover photos.
- Radiation panel (Curiosity RAD) and temperature panel (Curiosity REMS), with charts, units, periods and data tables.
- A draw tool. Sketch any path and get its distance, slope profile and walking time on a 10 m grid.
- EVA screen (eva.html). It shows the next stop, the remaining time, the turn-back margin, dose bars, and slope and comms warnings. A replay mode simulates a normal day and the sol 4716 transient-event day. It is high-contrast, has large buttons and works offline.
- Cuff checklist (cuff.html). Printable 90 × 60 mm cards with bearings, distances and latest turn-back times.
- Electronics view. The same data read for equipment: dose in silicon (TID), the LET spectrum (SEE context) and daily thermal cycling.

How it works
- All rasters are reprojected to one Mars sphere frame. Before use they are checked against Curiosity's surveyed waypoints: the DEM is −1.32 m from the waypoints on average, and DEM slope is −0.81° (median) from the rover's measured tilt.
- RAD data are parsed directly from PDS RDR files. Only observations with QC flag 00000000 and a duration of at least 600 s are kept.
- REMS data come from PDS MODRDR files, keeping high-confidence ground temperature only. The season (Ls) is computed with the Mars24 / Allison & McEwen (2000) formulas.
- Every number shown is recomputed from the data by check scripts. The EVA self-test passes 77/77.

Benefits and goals
- Data from several missions combined into one go or turn-back decision, with every assumption labelled.
- Works offline, which is what a crew in the field would need.
- Next: live REMS and RAD feeds, more routes, and suit telemetry in place of the assumed limits.

Tools
- HTML, CSS and JavaScript with Leaflet 1.9.4.
- Python 3 standard library and GDAL 3.8 for data processing.
- Headless Chrome for checks.

Honest limits
- RAD has no position. Radiation is shown as measured at the rover over time, not as a map.
- The route A and route B dose rates were measured 13 years apart, so their difference is not an altitude or site effect.
- Walking speed, slope thresholds, antenna height and the EVA limits are assumptions. The 50 µGy dose budget is a planning number, not a health limit.
- Only Chrome has been tested.

## Use of Super Intelligence (SI)
Yes. Claude Code (Anthropic), an AI coding assistant, was used as a tool. It helped plan the work, wrote and edited the website code and the data-processing scripts, and drafted documentation text, using Claude Fable 5.2, Claude Opus 5.5 and Claude Sonnet. All data processing and checks were run by scripts in the repository, on NASA and USGS source files. The assistant did not supply any measurements. The idea of how to solve the challenge is the project owner's: a layered map of Gale Crater, built from NASA mission data, for planning a walking EVA, with an astronaut-facing view and the same data read for its impact on electronics. The owner chose the challenge, set the direction, and reviewed and approved the output. The AI assistant was used as a tool to plan and carry out the implementation; its working notes are kept in Plan/. No AI-generated images, video or audio are used. The images are NASA data or screenshots of the app. The SI use is also stated in the README, on the Sources page, and in each page's generator meta tag.

## NASA Data
- MSL Curiosity RAD Reduced Data Records, MSL-M-RAD-3-RDR-V1.0 (PDS PPI Node)
- MSL Curiosity REMS MODRDR, mslrem_1001 (PDS Atmospheres Node)
- MSL traverse and waypoints (NASA/JPL "Where is Curiosity?" MMGIS)
- MSL raw images (mars.nasa.gov raw image API)
- MRO HiRISE colour mosaic of the MSL area and HiRISE 1 m DEM of Gale Crater (NASA Mars Trek)
- MRO CTX mosaic of the Curiosity area (NASA Mars Trek)
- Mars Odyssey THEMIS day and night IR and thermal inertia (USGS Astrogeology)
- MGS MOLA 463 m DEM (USGS Astrogeology); NASA Mars Trek basemap tiles

## Space Agency Partner Data and Other References
- REMS is an instrument from Spain's Centro de Astrobiología (CSIC-INTA). We used its PDS data (Spanish Space Agency partner context).
- USGS SIM 3292, Global Geologic Map of Mars (Tanaka et al. 2014); IAU/USGS Gazetteer of Planetary Nomenclature.
- Rudolph et al., Mendeley Data mcdw3sp5vw v3 (CC BY 4.0), and JGR Planets 2024, doi:10.1029/2023JE008242.
- Allison & McEwen (2000) / NASA GISS Mars24 algorithm for Ls.
- Leaflet 1.9.4 (BSD-2-Clause).
- The full list with URLs, credits and licences is in the README and on the site's Sources page.
