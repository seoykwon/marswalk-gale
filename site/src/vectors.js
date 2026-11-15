// Vector layers (GeoJSON / routes). Each entry: {id, group, label(), make(map), legend(), info(), defaultOn}.
/* global L */
import { t, pick, escapeHtml as esc } from './i18n.js';
import { fmt, dur, lonlat } from './format.js';
import { load } from './data.js';
import { classRuns, sampleAtDistance } from './routecalc.js';
import { thumbsHtml, positionNote } from './photos.js';

// Route slope classes: same colours as the T2 slope layer (light yellow -> orange -> dark red, monotone
// lightness so the order survives colour-vision deficiency); class >= 15 deg is also drawn wider.
export const CLASS_COLORS = ['#ffffff', '#fed976', '#fd8d3c', '#800026'];
const CLASS_WIDTH = [4, 4, 7, 7];
const G3_COLORS = { marker_band: '#e87ba4', mantling: '#5ec4ff', high_albedo_bench: '#ffd23f', marker_band_and_mantling: '#b9a6ff' };

let canvas = null;
const cv = () => (canvas ||= L.canvas({ padding: 0.3 }));

function popupTable(rows) {
  return `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>`;
}

export function vectorDefs({ routes, config, photos, onRouteSelect }) {
  const walk = config.walk;
  const defs = [];

  // ---- EVA plan: routes A and B (P1)
  for (const rid of ['A', 'B']) {
    const R = routes.routes[rid];
    defs.push({
      id: 'P1' + rid, group: 'plan', defaultOn: true,
      label: () => t('layers.route', { id: rid }) + ' — ' + pick(R, 'name').replace(/^[^—-]*[—-]\s*/, ''),
      make: async () => {
        const g = L.featureGroup();
        const all = R.samples.lat.map((la, i) => [la, R.samples.lon[i]]);
        L.polyline(all, { color: '#111', weight: 10, opacity: 0.85, interactive: false }).addTo(g);
        for (const run of classRuns(R, walk)) {
          L.polyline(run.latlngs, { color: CLASS_COLORS[run.cls], weight: CLASS_WIDTH[run.cls], opacity: 1, lineCap: 'butt' })
            .bindTooltip(t('route.class_tip', { cls: t('route.class.' + run.cls), from: fmt(run.from_m), to: fmt(run.to_m) }), { sticky: true })
            .on('click', () => onRouteSelect(rid))
            .addTo(g);
        }
        for (const h of R.hazards) {
          const p = sampleAtDistance(R, h.from_m);
          L.marker([p.lat, p.lon], {
            icon: L.divIcon({ className: 'hz-icon', html: '▲', iconSize: [16, 16] }),
            title: t('route.hazard_marker', { from: fmt(h.from_m), max: fmt(h.max_slope_deg, 1) }),
            alt: t('route.hazard_marker', { from: fmt(h.from_m), max: fmt(h.max_slope_deg, 1) }),
          }).bindPopup(`<div class="popup"><h4>${esc(t('route.hazard'))}</h4>${popupTable([
            [t('route.at'), `${fmt(h.from_m)}–${fmt(h.to_m)} m`],
            [t('route.max_slope_5m'), `${fmt(h.max_slope_deg, 1)}°`],
            [t('route.level'), esc(t('route.level_' + h.level))],
          ])}<p class="small">${esc(t('route.hazard_see_panel'))}</p></div>`).addTo(g);
        }
        for (const s of R.stations) {
          const m = L.circleMarker([s.lat, s.lon], { radius: 6, color: '#0b0b0b', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
            .bindTooltip(s.id, { permanent: true, direction: 'right', offset: [6, 0], className: 'st-label' });
          const leg = s.leg;
          m.bindPopup(`<div class="popup"><h4>${esc(s.id)} · ${esc(pick(s, 'name'))}</h4>${popupTable([
            [t('route.kind'), esc(t('route.kind_' + (s.kind === 'via' && s.reason === 'turn' ? 'turn' : s.kind)))],
            [t('route.dist_from_base'), `${fmt(s.d_m, 1)} m`],
            [t('route.elev_dem'), `${fmt(s.elev_m, 1)} m`],
            [t('route.arrive'), esc(dur(s.t_out_s))],
            ...(leg ? [[t('route.next_leg', { to: leg.to }), `${fmt(leg.dist_m, 1)} m · ${leg.bearing_deg}° · +${fmt(leg.climb_m, 1)} / −${fmt(leg.descent_m, 1)} m · ${esc(dur(leg.time_s))}`]] : []),
          ])}</div>`);
          m.addTo(g);
        }
        g.on('click', () => onRouteSelect(rid));
        return g;
      },
      legend: () => `${CLASS_COLORS.map((c, i) => `<div><span class="ln" style="border-top:${CLASS_WIDTH[i] - 1}px solid ${c};outline:1px solid #111"></span>${esc(t('route.class.' + i))}</div>`).join('')}
        <div>▲ ${esc(t('legend.hazard_start'))} · ○ ${esc(t('legend.station'))}</div>`,
      info: () => esc(t('layers.info.P1')),
    });
  }
  defs.push({
    id: 'P1c', group: 'plan', defaultOn: false,
    label: () => t('layers.comms_gaps'),
    make: async () => {
      const g = L.featureGroup();
      for (const rid of ['A', 'B']) {
        const R = routes.routes[rid];
        for (const gap of R.comms_gaps) {
          const S = R.samples;
          const pts = [];
          for (let i = 0; i < S.d_m.length; i++) if (S.d_m[i] >= gap.from_m && S.d_m[i] <= gap.to_m) pts.push([S.lat[i], S.lon[i]]);
          L.polyline(pts, { color: '#111', weight: 14, opacity: 0.5, interactive: false }).addTo(g);
          L.polyline(pts, { color: '#c4b8ff', weight: 3, dashArray: '2 7', lineCap: 'round' })
            .bindTooltip(t('route.gap_tip', { id: rid, from: fmt(gap.from_m), to: fmt(gap.to_m), len: fmt(gap.len_m) }), { sticky: true })
            .addTo(g);
        }
      }
      return g;
    },
    legend: () => `<div><span class="ln" style="border-top:3px dashed #c4b8ff;outline:1px solid #111"></span>${esc(t('legend.no_los'))}</div>`,
    info: () => esc(t('layers.info.P1c')),
  });

  // ---- Curiosity measurements
  defs.push({
    id: 'M1', group: 'measure', defaultOn: true, label: () => t('layers.traverse'),
    make: async () => L.geoJSON(await load('traverse'), {
      renderer: cv(), style: { color: '#9fd8ff', weight: 1.6, opacity: 0.9 }, interactive: false,
    }),
    legend: () => `<div><span class="ln" style="border-top:2px solid #9fd8ff;outline:1px solid #111"></span>${esc(t('legend.traverse'))}</div>`,
    info: () => esc(t('layers.info.M1')),
  });
  defs.push({
    id: 'M1w', group: 'measure', defaultOn: false, label: () => t('layers.waypoints'),
    make: async () => L.geoJSON(await load('waypoints'), {
      pointToLayer: (f, ll) => L.circleMarker(ll, { renderer: cv(), radius: 3.5, color: '#0b0b0b', weight: 1, fillColor: '#9fd8ff', fillOpacity: 1 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindPopup(`<div class="popup"><h4>${esc(t('wp.title', { sol: p.sol }))}</h4>${popupTable([
          [t('wp.elev'), `${fmt(p.elev, 1)} m`],
          [t('wp.tilt'), `${fmt(p.tilt, 1)}°`],
          [t('wp.odometry'), `${fmt(p.dist_m)} m`],
          [t('wp.pos'), esc(lonlat(f.geometry.coordinates[0], f.geometry.coordinates[1], 5))],
        ])}<p class="small">${esc(t('wp.note'))}</p></div>`);
      },
    }),
    legend: () => `<div><span class="sw" style="background:#9fd8ff;border-radius:50%"></span>${esc(t('legend.waypoint'))}</div>`,
    info: () => esc(t('layers.info.M1w')),
  });
  defs.push({
    id: 'M2', group: 'measure', defaultOn: true, label: () => t('layers.sites'),
    make: async () => L.geoJSON(await load('sites'), {
      style: { color: '#ffd23f', weight: 2, fillOpacity: 0.08 },
      onEachFeature: (f, l) => l.bindTooltip(`${f.properties.name} (site ${f.properties.site})`),
    }),
    legend: () => `<div><span class="sw" style="border:2px solid #ffd23f;background:transparent"></span>${esc(t('legend.site'))}</div>`,
    info: () => esc(t('layers.info.M2')),
  });
  defs.push({
    id: 'M5', group: 'measure', defaultOn: false, label: () => t('layers.photos'),
    make: async () => {
      const byPos = new Map();
      for (const p of photos) {
        const k = p.lon.toFixed(6) + ',' + p.lat.toFixed(6);
        if (!byPos.has(k)) byPos.set(k, []);
        byPos.get(k).push(p);
      }
      const g = L.featureGroup();
      for (const list of byPos.values()) {
        const p0 = list[0];
        const label = t('photo.marker', { n: list.length, sol: p0.wp_sol });
        L.marker([p0.lat, p0.lon], {
          icon: L.divIcon({ className: 'photo-icon', html: String(list.length), iconSize: [18, 18] }),
          title: label, alt: label, keyboard: true,
        }).bindPopup(`<div class="popup"><h4>${esc(t('photo.popup_title', { wp_sol: p0.wp_sol, n: list.length }))}</h4>
          <p class="small">${esc(t('photo.rover_position'))}</p>${thumbsHtml(list, 30)}
          <p class="small">${esc(positionNote(p0))}</p></div>`, { maxWidth: 300 }).addTo(g);
      }
      return g;
    },
    legend: () => `<div><span class="photo-icon" style="display:inline-block;width:16px;height:16px">3</span> ${esc(t('legend.photo'))}</div>`,
    info: () => esc(t('layers.info.M5')),
  });
  defs.push({
    id: 'M6', group: 'measure', defaultOn: true, label: () => t('layers.places'),
    make: async () => L.geoJSON(await load('places'), {
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 3, color: '#fff', weight: 1, fillColor: '#0b0b0b', fillOpacity: 1 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindTooltip(p.name, { permanent: true, direction: 'right', className: 'place-label', offset: [4, 0] });
        l.bindPopup(`<div class="popup"><h4>${esc(p.name)}</h4>${popupTable([
          [t('place.type'), esc(p.type)], [t('place.diameter'), `${fmt(p.diameter_km, 1)} km`],
          [t('place.status'), esc(p.approval)]])}<p class="small"><a href="${esc(p.link.replace('http://', 'https://'))}" target="_blank" rel="noopener">USGS Gazetteer</a></p></div>`);
      },
    }),
    legend: () => `<div>${esc(t('legend.place'))}</div>`,
    info: () => esc(t('layers.info.M6')),
  });
  defs.push({
    id: 'M7', group: 'measure', defaultOn: true, label: () => t('layers.landing_now'),
    make: async () => {
      const wp = (await load('waypoints')).features;
      const first = wp[0], last = wp[wp.length - 1];
      const g = L.featureGroup();
      for (const [f, key] of [[first, 'landing'], [last, 'latest']]) {
        const [lon, lat] = f.geometry.coordinates;
        L.circleMarker([lat, lon], { radius: 8, color: '#0b0b0b', weight: 3, fillColor: key === 'landing' ? '#ffffff' : '#ffd23f', fillOpacity: 1 })
          .bindTooltip(t('m7.' + key, { sol: f.properties.sol }), { direction: 'top' })
          .bindPopup(`<div class="popup"><h4>${esc(t('m7.' + key, { sol: f.properties.sol }))}</h4>${popupTable([
            [t('wp.elev'), `${fmt(f.properties.elev, 1)} m`], [t('wp.pos'), esc(lonlat(lon, lat, 5))]])}
            <p class="small">${esc(t('wp.note'))}</p></div>`)
          .addTo(g);
      }
      return g;
    },
    legend: () => `<div>${esc(t('legend.m7'))}</div>`,
    info: () => esc(t('layers.info.M7')),
  });

  // ---- Terrain vectors: contours (T4)
  defs.push({
    id: 'T4', group: 'terrain', defaultOn: false, label: () => t('layers.contours50'),
    make: async () => L.geoJSON(await load('contours50'), {
      renderer: cv(),
      style: (f) => ({ color: '#f5e6c8', weight: f.properties.elev_m % 250 === 0 ? 1.6 : 0.8, opacity: 0.8 }),
      onEachFeature: (f, l) => l.bindTooltip(`${fmt(f.properties.elev_m)} m`, { sticky: true }),
    }),
    legend: () => `<div>${esc(t('legend.contours50'))}</div>`,
    info: () => esc(t('layers.info.T4')),
  });
  defs.push({
    id: 'T4r', group: 'terrain', defaultOn: false, label: () => t('layers.contours10'),
    make: async () => {
      const [a, b] = await Promise.all([load('contours10A'), load('contours10B')]);
      const opt = {
        renderer: cv(),
        style: (f) => ({ color: '#f5e6c8', weight: f.properties.elev_m % 50 === 0 ? 1.5 : 0.7, opacity: 0.9 }),
        onEachFeature: (f, l) => l.bindTooltip(`${fmt(f.properties.elev_m)} m`, { sticky: true }),
      };
      return L.featureGroup([L.geoJSON(a, opt), L.geoJSON(b, opt)]);
    },
    legend: () => `<div>${esc(t('legend.contours10'))}</div>`,
    info: () => esc(t('layers.info.T4r')),
  });

  // ---- Surface & geology
  defs.push({
    id: 'G3', group: 'surface', defaultOn: false, label: () => t('layers.rudolph'),
    make: async () => L.geoJSON(await load('rudolph'), {
      renderer: cv(),
      style: (f) => {
        const p = f.properties;
        return { color: G3_COLORS[p.unit] || '#fff', weight: 2, opacity: 0.95, dashArray: p.confidence === 'confident' ? null : '6 5' };
      },
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindTooltip(`${t('g3.unit.' + p.unit)} · ${t('g3.conf.' + p.confidence)} (${p.region})`, { sticky: true });
      },
    }),
    legend: () => `${Object.entries(G3_COLORS).map(([k, c]) => `<div><span class="ln" style="border-top:3px solid ${c};outline:1px solid #111"></span>${esc(t('g3.unit.' + k))}</div>`).join('')}
      <div><span class="ln" style="border-top:3px solid #ddd"></span>${esc(t('g3.solid'))}</div>
      <div><span class="ln" style="border-top:3px dashed #ddd"></span>${esc(t('g3.dashed'))}</div>`,
    info: () => esc(t('layers.info.G3')),
  });
  defs.push({
    id: 'G1', group: 'surface', defaultOn: false, label: () => t('layers.g1'),
    make: async () => {
      const d = await load('context');
      return L.geoJSON({ type: 'FeatureCollection', features: d.features.filter((f) => f.properties.layer === 'G1_geology_sim3292') }, {
        style: { color: '#ffffff', weight: 1.5, dashArray: '4 4', fillOpacity: 0.04 },
        onEachFeature: (f, l) => l.bindTooltip(`${f.properties.Unit}: ${f.properties.UnitDesc}`, { sticky: true }),
      });
    },
    legend: () => `<div>${esc(t('legend.g1'))}</div>`,
    info: () => esc(t('layers.info.G1')),
  });
  defs.push({
    id: 'E3', group: 'surface', defaultOn: false, label: () => t('layers.e3'),
    make: async () => {
      const d = await load('context');
      const col = { E3_dune_field: '#ffd23f', E3_hydrous_crism: '#5ec4ff', E3_hydrous_omega: '#1baf7a', E3_aqueous_options: '#e87ba4' };
      return L.geoJSON({ type: 'FeatureCollection', features: d.features.filter((f) => f.properties.layer.startsWith('E3')) }, {
        style: (f) => ({ color: col[f.properties.layer], weight: 2, fillOpacity: 0.15 }),
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: '#0b0b0b', weight: 1.5, fillColor: col[f.properties.layer], fillOpacity: 1 }),
        onEachFeature: (f, l) => {
          const props = Object.entries(f.properties).filter(([k, v]) => k !== 'layer' && v !== null && v !== '').slice(0, 6);
          l.bindPopup(`<div class="popup"><h4>${esc(t('e3.' + f.properties.layer))}</h4>${popupTable(props.map(([k, v]) => [k, esc(String(v))]))}</div>`);
        },
      });
    },
    legend: () => ['E3_dune_field', 'E3_hydrous_crism', 'E3_hydrous_omega', 'E3_aqueous_options'].map((k, i) =>
      `<div><span class="sw" style="background:${['#ffd23f', '#5ec4ff', '#1baf7a', '#e87ba4'][i]}"></span>${esc(t('e3.' + k))}</div>`).join(''),
    info: () => esc(t('layers.info.E3')),
  });
  return defs;
}
