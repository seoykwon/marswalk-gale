# Space Apps 2026 — project form text (paste into each field)

## Project Name
Marswalk: a walking-EVA planner for Gale Crater

## High-Level Project Summary
Marswalk is a layered web map that helps an astronaut plan and carry out a walking EVA in Gale Crater, Mars. It combines data from several NASA missions on one map: MRO HiRISE and CTX imagery, a 1 m HiRISE terrain model, Mars Odyssey THEMIS, MGS MOLA, and Curiosity's own RAD radiation and REMS weather measurements. For a chosen route it reports distance, walking time, climb, steep slopes, radio blind spots to base, radiation dose and ground temperature by hour and season. An EVA screen counts down to the turn-back point, the earliest of four limits: time, sunset, cold and dose budget. A printable cuff checklist puts the same numbers on the astronaut's wrist. On the Mount Sharp route, the 3.6 km round trip takes about 2 h 34 min, has 3 sections at 15 degrees or steeper (Curiosity tilted 24 degrees there) and 856 m out of radio line of sight. The first crews on Mars will need to know, before they step out, whether they can go and when they must turn back. Marswalk answers both from real mission data, and it works offline.


## Link to Project Demo
[paste the public link to the slide deck]

## Link to Final Project
https://seoykwon.github.io/marswalk-gale/

## Project Details
WHAT IT DOES
Marswalk is a static website with three tools for one walking EVA in Gale Crater:
- Planning map: 11 map layers (HiRISE colour, CTX, THEMIS day/night infrared, thermal inertia, MOLA, hillshade, slope classes, elevation, radio line of sight) and 14 vector layers (Curiosity traverse, waypoints, rover photos, geology, place names, contours). Pick a route and a panel shows distance, walking time, climb, steep-slope sections, radio blind spots to base, radiation dose for the walk and ground temperature by hour and season. A draw tool gives the same numbers for any path you sketch.
- EVA screen: the next stop, time left, a turn-back countdown, dose bars and slope/comms warnings. A replay mode simulates a normal day and the sol 4716 transient radiation event.
- Cuff checklist: printable wrist cards with bearings, distances and the latest turn-back time at each stop.

HOW IT WORKS
- All rasters are reprojected to one Mars coordinate frame and checked against Curiosity's surveyed waypoints: the terrain model differs from them by -1.32 m on average, and its slope differs from the rover's measured tilt by -0.81 degrees (median).
- Radiation comes straight from Curiosity RAD files in the Planetary Data System (only quality-flag 00000000 observations of 600 s or longer). Ground temperature comes from REMS files, high-confidence rows only.
- The turn-back point is the earliest of four limits: 6 hours, sunset, -40 C ground and a 50 microgray dose budget. These are planning assumptions, labelled as such, not health limits.
- Every number shown on screen is recomputed from the data by check scripts, and the EVA self-test passes 77/77.

BENEFITS AND INTENDED IMPACT
Data from several NASA missions becomes one clear go or turn-back decision. Example: the Mount Sharp route is a 3,649 m round trip of about 2 h 34 min. It has 3 sections at 15 degrees or steeper (Curiosity tilted 24 degrees there), 856 m without radio line of sight to base, and adds 16.5 microgray of measured dose. The tool also works offline, which a crew in the field would need. The same data is read for equipment too: dose in silicon (total ionizing dose), the particle energy spectrum (single-event-effect context) and daily thermal cycling of 83 K on average.

HUMAN SURVIVAL CONSIDERATIONS
Every feature was shaped by one question: will the crew member get back safely?
- Turn back before the first limit: the turn-back point is the earliest of four limits (6 hours, sunset, -40 C ground, 50 microgray dose budget), with a 30-minute reserve kept for the walk home. The EVA screen moves from "continue" to "turn soon" to "turn now" as the margin shrinks.
- Radiation: dose is tracked twice, for the body (RAD's plastic detector, used here as the body-side reading) and for the equipment (its silicon detector). A replay of sol 4716, a transient radiation event of unconfirmed cause, shows what a bad day looks like: starting at 09:00, the 50 microgray budget is reached after about 4.6 hours.
- Cold: hourly ground temperature by season shows when the surface drops below -40 C. In the last Mars year the ground spent about 14 hours per sol below that line, so the start time matters.
- Falls and fatigue: slopes of 15 degrees or more are flagged 50 m ahead, slopes over 25 degrees are treated as impassable, and walking speed is reduced on steeper ground, so the time estimates already include the climb.
- Losing contact: stretches with no radio line of sight to base are flagged 100 m ahead, so the crew knows when they will be out of touch.
- Daylight: the walk must end before sunset; the planner refuses a start time that is already too cold.
- Backup when tech fails: the site works offline, and the printed cuff checklist keeps bearings, distances and turn-back times on the wrist if the screen fails.
- Readable under stress: dark high-contrast screen, large buttons usable with gloves (72 px), and warnings shown with shape and text, not colour alone.
These limits are planning assumptions, clearly labelled, not medical or health limits; real values would come from suit and crew data.

CREATIVITY
- It uses the rover's own measurements, not models: Curiosity measured radiation and weather at this very site, so the walk is planned with what was actually measured there.
- It goes from planning to doing: the same numbers flow from the map to the EVA screen and to a paper wrist card.
- It shows one dataset through two lenses, the astronaut and the electronics they carry.

FACTORS CONSIDERED
- Honest limits: RAD records no position, so radiation is shown over time at the rover, not as a map. The two routes' dose rates were measured 13 years apart, so their difference is not read as an altitude effect.
- Accessibility: high-contrast EVA screen, 72 px buttons, keyboard control, and colours readable with colour blindness.
- Every assumption (walking speed, slope limits, antenna height) is labelled and listed.
- Every data source is credited with links on the Sources page.

TOOLS
HTML, CSS and JavaScript with Leaflet 1.9.4 (no build step); Python 3 and GDAL 3.8 for data processing; headless Chrome for automated checks; GitHub Pages for hosting. Claude Code (Anthropic) was used as a coding tool; see the SI section.


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
