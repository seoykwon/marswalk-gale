#!/usr/bin/env python3
"""Rudolph et al. Aeolis Mons unit lines -> site/data/geology_rudolph.geojson

Input : Geology/gale_local/rudolph_mendeley/shapefiles/*.shp (Mars sphere equirectangular,
        central meridian 180, metres; extracted from the Mendeley archive, see SOURCES.md there)
Output: one LineString collection in +proj=longlat +R=3396190, with region/unit/confidence
        derived from each layer's file name (the attribute table carries no unit names).
Run   : python3 -I scripts/23_geology_rudolph.py
"""
import glob, json, os, subprocess, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GDAL = '/Applications/Postgres.app/Contents/Versions/latest/bin'
SRC = os.path.join(ROOT, 'Geology/gale_local/rudolph_mendeley/shapefiles')
OUT = os.path.join(ROOT, 'site/data/geology_rudolph.geojson')
CRS = '+proj=longlat +R=3396190 +no_defs'
SIMPLIFY_DEG = 0.00002  # ~1.2 m


def classify(name):
    region, rest = name.split('_', 1)
    if 'MBand' in rest:
        unit = 'marker_band_and_mantling'
    elif 'bench' in rest:
        unit = 'high_albedo_bench'
    elif 'MB' in rest:
        unit = 'marker_band'
    else:
        unit = 'mantling'
    for key, label in (('lessconfident', 'less_confident'), ('confident', 'confident'),
                       ('discontinuous', 'discontinuous'), ('inferred', 'inferred')):
        if key in rest:
            return region, unit, label
    return region, unit, 'mapped'


def main():
    feats = []
    with tempfile.TemporaryDirectory() as tmp:
        for shp in sorted(glob.glob(os.path.join(SRC, '*.shp'))):
            name = os.path.basename(shp)[:-4]
            gj = os.path.join(tmp, name + '.geojson')
            subprocess.run([os.path.join(GDAL, 'ogr2ogr'), '-q', '-f', 'GeoJSON', '-t_srs', CRS,
                            '-dim', '2', gj, shp], check=True)
            region, unit, conf = classify(name)
            for ft in json.load(open(gj))['features']:
                coords = [[round(c[0], 6), round(c[1], 6)] for c in ft['geometry']['coordinates']]
                feats.append({'type': 'Feature',
                              'properties': {'layer': name, 'region': region, 'unit': unit,
                                             'confidence': conf},
                              'geometry': {'type': 'LineString', 'coordinates': coords}})
        merged = os.path.join(tmp, 'merged.geojson')
        json.dump({'type': 'FeatureCollection', 'name': 'rudolph2024_units', 'features': feats},
                  open(merged, 'w'), separators=(',', ':'))
        if os.path.exists(OUT):
            os.remove(OUT)
        subprocess.run([os.path.join(GDAL, 'ogr2ogr'), '-q', '-f', 'GeoJSON',
                        '-simplify', str(SIMPLIFY_DEG), '-lco', 'COORDINATE_PRECISION=6',
                        OUT, merged], check=True)
    print('wrote %s: %d lines, %d bytes' % (OUT, len(feats), os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
