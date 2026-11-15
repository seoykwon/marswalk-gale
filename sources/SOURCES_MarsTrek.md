# Sources for the rasters in `MarsTrek/` (verified 2026-11-15)

This file replaces the missing `MarsTrek/SOURCES.md`. The `MarsTrek/` folder is read-only, so the record lives here. Machine-readable copy: `sources/sources.json`.

How each fact was found is given as "Evidence". Nothing below is guessed. Where a fact could not be recovered it is marked **GAP**.

Dates are the local file dates on this machine (UTC+9) unless stated. The download session ran 2026-11-14 to 2026-11-15.

## Summary

| Local file | Used in site/ | Source | URL known | Product ID | Date | Credit line |
|---|---|---|---|---|---|---|
| `extra/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif` | B2 | USGS Astropedia, MSL Gale Merged Orthophoto Mosaic 25 cm (colour) | yes | file name | colour file "July 2025" (page); downloaded 2026-11-14 | NASA/JPL-Caltech/UArizona; T. Parker and F. J. Calef III; USGS Astrogeology |
| `Gale_DEM_SMG_1m.tif` | T1, T2, T3, T5, contours, grids, route elevation | NASA Mars Trek catalogue | **GAP** (pattern only) | Trek label `Gale_DEM_SMG_1m` | Trek record 2020-06-25; download date **GAP** | NASA/JPL-Caltech/UArizona (HiRISE) |
| `extra/curiosity_ctx_mosaic.tif` | B1 | NASA Mars Trek catalogue | yes | Trek label `curiosity_ctx_mosaic` | Trek record 2020-06-25; downloaded 2026-11-14 | NASA/JPL-Caltech/MSSS (CTX) |
| `extra/THEMIS_night_IR_USGS_WCS_lon130-145_lat-12-3.tif` | B4 | USGS planetarymaps WCS | yes (request pattern) | WCS coverage `THEMIS_night` | released Oct. 2018; fetched 2026-11-14 | NASA/JPL-Caltech/ASU; USGS Astrogeology |
| `extra/THEMIS_controlled_IR_USGS_WCS_lon130-145_lat-12-3.tif` | B5 | USGS planetarymaps WCS | yes (request pattern) | WCS coverage `THEMIS_controlled` | tiles complete as of Oct. 2018; fetched 2026-11-14 | NASA/JPL-Caltech/ASU; USGS Astrogeology |
| `extra/THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub` | E1, route `ti` | USGS Astropedia | yes | file name | published 2014-05-30; downloaded 2026-11-14/15 | R. Fergason; NASA/JPL-Caltech/ASU; USGS |
| `extra/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif` | T6 | USGS Astropedia | yes | file name | MEGDR edition 2003-03-21; downloaded 2026-11-14/15 | NASA/JPL-Caltech/GSFC (MOLA); USGS |
| `extra/Dune_Field.zip` | E3 | NASA Mars Trek catalogue | yes | Trek label `Dune_Field` | downloaded 2026-11-14 | Hayward et al. 2007 (USGS OFR 2007-1158); Mars Trek |
| `extra/Hydrous_Mineral_Detections_CRISM_clon0.zip` | E3 (CRISM, OMEGA) | NASA Mars Trek catalogue | yes | Trek label of the same name | downloaded 2026-11-14 | Carter et al. 2013; Mars Trek |
| `extra/Aqueous_Mineral_Distribution_Options_clon0.zip` | E3 | NASA Mars Trek catalogue | yes | Trek label of the same name | downloaded 2026-11-14 | Ehlmann and Edwards 2014; Mars Trek |

Not used in `site/` but present: `Gale_CTX_BlockAdj_dd.tif` (5 m CTX, failed alignment), `extra/curiosity_hirise_mosaic.tif`, the THEMIS ISIS cubes, TES rasters, `mola_roughness.tif`, other Trek zips. They are not described further here, except that `Gale_CTX_BlockAdj_dd.tif` is listed below because it sits at the top level next to the DEM.

## Mars Trek download pattern

The session's download scripts (`dl.sh`, `small.sh`; session scratchpad) fetched Trek files with:

```
https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=<label>
```

The Trek catalogue query (`https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?rows=3000&wt=json`, 2038 records saved in the session scratchpad as `all.json`) gives each label's title, file size, bounding box and record date. Trek's `data_created_date` for the three Gale items is 2020-06-25. That is the date of the Trek record, not the date the underlying map was made.

The metadata endpoint is `https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/stream?label=<label>`. Checked on 2026-11-15: for `curiosity_ctx_mosaic` it returns a placeholder record (title, abstract and use constraints all "TBD"; access constraint "PRIVATE"). For `Gale_DEM_SMG_1m` and `Gale_CTX_BlockAdj_dd` it returns HTTP 500.

## 1. B2 HiRISE colour mosaic

- File: `MarsTrek/extra/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif`, 1,030,625,379 bytes, 36000 x 76000 px at 0.25 m, JPEG-compressed COG.
- URL: `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif` (page: `https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm`).
- Product ID: the file name. The catalogue has no separate ID.
- Date: the USGS page announces the colour mosaic as "NEW (July 2025) Color Mosaic now available". The page's own publication date, 2016-10-20, belongs to the grayscale orthophoto it was fused with.
- Description from the page: "The HiRISE 78 quad color basemap is composed of several HiRISE RGB color strips georectified using thousands of manually placed tie-points, blended and then fused using Adobe Photoshop to the MSL mission HiRISE RED orthophoto mosaic ... slightly sharpened in GIMP ... converted to a Jpeg compressed COG (Quality = 85)". "Authorship order for this color version is Timothy Parker and Fred J. Calef III." The file's JPEG_QUALITY=85 and LAYOUT=COG tags match.
- Originators on the page: JPL-Caltech, NASA, USGS Astrogeology Science Center, University of Arizona.
- Terms (grayscale parent page): Access Constraints "Please credit authors"; Use Constraints "None".
- Citation (parent product): Calef III, F. J., and Parker, T. (2016). MSL Gale Merged Orthophoto Mosaic. PDS Annex, U.S. Geological Survey.
- Credit line: NASA/JPL-Caltech/UArizona. Mosaic: T. Parker and F. J. Calef III, USGS Astrogeology Science Center.
- Evidence: session transcript (download command with this exact URL, 2026-11-14 ~13:00 UTC); saved page `mars_msl_gale_merged_orthophoto_mosaic_25cm.html`; local GDAL tags. Downloaded by `dl2.sh` (curl `-C -` resume), finished 2026-11-15 00:03 local.
- GAP: release date of the colour file itself (only "July 2025"); a licence statement on the colour file's own record.

## 2. HiRISE DEM (T1, T2, T3, T5, contours, grids, route elevation)

- File: `MarsTrek/Gale_DEM_SMG_1m.tif`, 5,775,684,529 bytes, 36000 x 40100 px, 1 m, 137.1225-137.7298 E, -4.9255 to -4.2490.
- Identified as: Mars Trek catalogue item with label `Gale_DEM_SMG_1m`, title "MRO HiRISE, Gale Crater DEM", instrument HiRISE. The match rests on three values that agree exactly: file size 5,775,684,529; bounding box; pixel grid. (Trek's record: `fileSize` 5775684529, `bbox` 137.1224711,-4.9254743,137.7298129,-4.2489631.)
- URL: the Trek stream pattern above with `label=Gale_DEM_SMG_1m` would deliver this file, but **no log shows it being used**. The file was already in `MarsTrek/` (dated 2026-11-14 20:13) before the logged download session, and `Plan/01` records only that the project owner supplied it. Treat the URL as a pointer to the right Trek item, not as the proven download URL.
- This is **not** the USGS "Mars MSL Gale Merged DEM 1m" version 3 (`MSL_Gale_DEM_Mosaic_1m_v3.tif`, 3.6 GB, 32980 x 57440 px, 137.124-137.681 E, -5.099 to -4.130, Parker and Calef, 2016-10-20). The size, grid and extent differ. Do not cite that record for this file.
- Credit line: NASA/JPL-Caltech/UArizona (HiRISE). This follows from the Trek instrument field; the Trek record names no author.
- GAP: the real download URL and date, the upstream producer and product ID behind "SMG", licence, citation. To close it, ask the project owner where they got the file, or request the metadata from the Trek team (a 2016 announcement lists MarsTrek@jpl.nasa.gov; not verified).

## 3. B1 CTX mosaic

- File: `MarsTrek/extra/curiosity_ctx_mosaic.tif`, 156,380,277 bytes, 11520 x 13460 px, 136.2768-139.3864 E, -7.2137 to -3.5805. This is what `scripts/30_tiler.py` names as the B1 source.
- URL: `https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=curiosity_ctx_mosaic`.
- Product ID: Trek label `curiosity_ctx_mosaic`, title "MRO CTX, Curiosity Roving Site Mosaic". Trek record date 2020-06-25.
- Date downloaded: 2026-11-14 (log: "curiosity_ctx_mosaic.tif attempt 1 got 156380277 expected 156380277 ... OK").
- Credit line: NASA/JPL-Caltech/MSSS (CTX).
- GAP: the upstream map producer and publication date, and licence. Trek's metadata record is a "TBD" placeholder.
- Related file not used: `MarsTrek/Gale_CTX_BlockAdj_dd.tif` (Trek label `Gale_CTX_BlockAdj_dd`, "MRO CTX, Gale Crater Mosaic", 1,796,940,658 bytes = Trek `fileSize`, 135.1843-139.2413 E). Same provenance gap as the DEM: it was in `MarsTrek/` before the logged session.

## 4. B4 and B5 THEMIS infrared tiles

- Files: `MarsTrek/extra/THEMIS_night_IR_USGS_WCS_lon130-145_lat-12-3.tif` and `THEMIS_controlled_IR_USGS_WCS_lon130-145_lat-12-3.tif`.
- Service: USGS planetarymaps WCS 1.0.0. Base: `https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map&service=WCS&version=1.0.0`.
- Request (nine 5-degree tiles per file, W = 130, 135, 140 and S = -12, -7, -2):
  `<base>&request=GetCoverage&coverage=<COV>&CRS=EPSG:4326&BBOX=<W>,<S>,<W+5>,<S+5>&WIDTH=2964&HEIGHT=2964&FORMAT=GTiff`
  The tiles were merged with `gdalbuildvrt` and `gdal_translate -b 1` into one 8-bit GeoTIFF (script `wcs.sh`).
- Coverage IDs and layer titles (from the service's GetMetadata, fetched 2026-11-15):

| Coverage | Layer title | Description |
|---|---|---|
| `THEMIS_night` (B4) | THEMIS IR Night 100m Controlled Partial Mosaic | "created by Astrogeology at 100 m/p and released in Oct. 2018. Data is originally from Arizona State University (and NASA's Mars Odyssey mission). It is fully-controlled and should closely align to the MOLA DEM/hillshade. ... only covers from -65 to 65 latitude." |
| `THEMIS_controlled` (B5) | THEMIS IR Day 100m Controlled Partial Mosaic | "created by Astrogeology at 100m/p using data originally from Arizona State University ... represents all tiles that were completed as of Oct. 2018." |

- Background page named by the service: `https://astrogeology.usgs.gov/maps/mars-themis-controlled-mosaics-and-final-smithed-kernels`.
- Date fetched: 2026-11-14 (~12:54-13:05 UTC).
- Credit line: NASA/JPL-Caltech/ASU (THEMIS, Mars Odyssey); USGS Astrogeology Science Center.
- GAP: no licence text on the service; no named author for these two mosaics.

## 5. E1 THEMIS thermal inertia

- File: `MarsTrek/extra/THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub`, 2,532,510,196 bytes (= the page's "External File Size"), 35565 x 17782 px, 100 m, 120-180 E, 30 S to 0.
- URL downloaded: `https://asc-astropedia.s3.us-west-2.amazonaws.com/Mars/Odyssey/THEMIS-Global-Thermal-Inertia-Mosaic/Quantitative-32-Bit/THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub`. The product page lists the older link `http://astropedia.astrogeology.usgs.gov/download/Mars/Odyssey/THEMIS-Global-Thermal-Inertia-Mosaic/Quantitative-32-Bit/THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub`.
- Product page: `https://astrogeology.usgs.gov/search/map/themis_thermal_inertia_mosaic_quantitative_30s120e_100mpp`. Title "THEMIS Thermal Inertia Mosaic Quantitative 30S120E 100mpp"; primary author Robin Fergason; originators USGS Astrogeology Science Center, Arizona State University Mars Space Flight Facility, NASA Mars Data Analysis Program; publication date 2014-05-30; edition 1; "Progress: Complete".
- Terms on the page: Access Constraints "Public domain"; Use Constraints "Please cite authors".
- Method citation named on the page: Fergason, R. L., Christensen, P. R., and Kieffer, H. H. (2006), J. Geophys. Res., 111, E12004, doi:10.1029/2006JE002735 (Crossref confirms the title and journal).
- Date downloaded: 2026-11-14/15 (log `log_ti.txt`, finished 2026-11-15 00:48 local).
- Credit line: R. Fergason; NASA/JPL-Caltech/ASU (THEMIS); USGS Astrogeology Science Center.
- GAP: the pixel unit. The ISIS label (`Base = 0.0`, `Multiplier = 1.0`) and the page text read here do not state it. The usual THEMIS unit is SI thermal inertia (J m^-2 K^-1 s^-1/2), but that was not confirmed from these sources. Check the Fergason et al. 2006 paper or the page's FGDC XML before putting a unit in the README.

## 6. T6 MOLA elevation

- File: `MarsTrek/extra/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`, 2,125,771,142 bytes, 46080 x 23040 px, 16-bit, 128 pixels per degree.
- URL: `https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif` (page: `https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m`).
- Product ID: the file name. Page title "Mars MGS MOLA DEM 463m"; primary author "MOLA Team"; originator Goddard Space Flight Center; publisher USGS Astrogeology Science Center; series MEGDR; edition 2003-03-21.
- Terms: Access Constraints "CC0 (public domain)"; Use Constraints "None".
- Page reference for the instrument: Smith et al. (2001).
- Date downloaded: 2026-11-14/15 (log `log_mola.txt`, finished 2026-11-15 00:57 local).
- Credit line: NASA/JPL-Caltech/GSFC (MOLA, Mars Global Surveyor); USGS Astrogeology Science Center.
- No gap.

## 7. E3 Mars Trek vector zips

The three zips that feed `context_vectors.geojson` (E3), per `scripts/22_vectors.py`. All came from the Trek stream pattern with the label shown. File sizes equal the Trek catalogue sizes.

| Local file | Trek label | Bytes | Trek layer description cites |
|---|---|---|---|
| `Dune_Field.zip` | `Dune_Field` | 542,079 | Hayward, R.K., Mullins, K.F., Fenton, L.K., Hare, T.M., Titus, T.N., Bourke, M.C., Colaprete, A., and Christensen, P.R., 2007, Mars Global Digital Dune Database: MC2-MC29: USGS Open-File Report 2007-1158 |
| `Hydrous_Mineral_Detections_CRISM_clon0.zip` | `Hydrous_Mineral_Detections_CRISM_clon0` | 125,577 | Carter, J., Poulet, F., Bibring, J.-P., Mangold, N., Murchie, S. (2013), J. Geophys. Res. Planets, 118(4), 831-858 |
| `Aqueous_Mineral_Distribution_Options_clon0.zip` | `Aqueous_Mineral_Distribution_Options_clon0` | 154,071 | Ehlmann, B. L., and Edwards, C. S. (2014), Annu. Rev. Earth Planet. Sci., 42, 291-315 |

- URL for each: `https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=<label>`.
- Date downloaded: 2026-11-14 (file dates 21:57 local).
- Trek metadata (fetched 2026-11-15): the title and abstract are filled in as above; publication date, access constraint and use constraint are empty.
- Credit: the cited authors, as distributed by NASA Mars Trek. The CRISM and OMEGA layer also derives from MRO and Mars Express instrument data.
- GAP: licence/terms (empty in the Trek record). Only the paper and report citations above are verifiable. The Trek record does not say whether the zipped shapefiles are the authors' own release or a Trek redigitisation.
- The dune database's own USGS report was not opened. The report number comes from the Trek abstract.

## What the README can say today

- Rasters 1, 3 (B1), 4, 5, 6 have a URL, an ID, a date and a credit line.
- The DEM has a credit line and a verified Trek identity but no proven URL. Say "NASA Mars Trek catalogue item Gale_DEM_SMG_1m (MRO HiRISE, Gale Crater DEM)" and do not link a download.
- E3 has URLs, IDs and literature citations but no licence statement.
- Trek tiles (B3, B6) have no stated terms; see `sources/sources.json`, id `B3B6`.
