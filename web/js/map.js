// MapLibre map with the train and station layers.
import * as maplibregl from "../vendor/maplibre/maplibre-gl.mjs";

export const COLORS = ["#1a9850", "#f39c12", "#d7301f", "#8c8c8c"]; // on time, 5–14, 15+, unknown
export const SCHEDULED_COLOR = "#7c3aed"; // timetable-only trains (OUIGO)
export const STRIDE = 6; // engine.positions(): lon, lat, class, bearing, fix age, flags
export const FLAG = { stopped: 1, likely: 2, scheduled: 4, commuter: 8, highSpeed: 16, medium: 32 };
/** Track colour per kind of train using it. */
// Colour per kind of service, shared by track, train rings and the legend:
// high speed purple, conventional (long and medium distance) dark teal.
// Cercanías lines keep their official colours.
export const SERVICE_COLORS = { av: "#6d28d9", conv: "#0f766e", cer: "#dc2626" };
export const TRACK_COLORS = { av: SERVICE_COLORS.av, ld: SERVICE_COLORS.conv, md: SERVICE_COLORS.conv };
/** Line widths (px by zoom), thicker for readability on a phone; a white
 * casing 3 px wider goes under each line. */
const TRACK_W = [5, 2.5, 6, 4, 9, 5.5, 11, 7, 13, 10, 16, 13];
const CER_W = [6, 4, 9, 5.5, 11, 8, 13, 12, 16, 14];
const width = (stops, extra = 0) => ["interpolate", ["linear"], ["zoom"], ...stops.map((v, i) => (i % 2 ? v + extra : v))];
/** Marker colour per kind of Renfe notice (engine incidents::Kind). */
export const KIND_COLORS = {
  disruption: "#dc2626",
  strike: "#7c3aed",
  works: "#f59e0b",
  accessibility: "#2563eb",
  other: "#64748b",
};

const empty = () => ({ type: "FeatureCollection", features: [] });

const STYLE_TIMEOUT_MS = 15_000;
const BLANK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#e5e3df" } }],
};

export function createMap(container, config, attribution) {
  const map = new maplibregl.Map({
    container,
    style: config.style,
    center: config.center,
    zoom: config.zoom,
    minZoom: 4,
    maxZoom: 17,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  // If the tile server is unreachable, carry on with a plain background:
  // the trains matter more than the base map.
  let fellBack = false;
  // Set once the first style is in. (map.isStyleLoaded() is also false
  // while tiles load, so it can't tell a dead style from a busy map.)
  let styled = false;
  map.once("style.load", () => (styled = true));
  const fallBack = (why) => {
    if (fellBack || styled) return;
    fellBack = true;
    console.warn(`Base map ${why}, using a blank background`);
    map.setStyle(BLANK_STYLE);
  };
  map.on("error", (e) => {
    if (String(e?.error?.message || "").includes(config.style)) fallBack("unavailable");
  });
  // A style request that neither loads nor fails (a weak mobile connection)
  // must not hold the trains back: they need no base map.
  setTimeout(() => fallBack("too slow"), STYLE_TIMEOUT_MS);
  const attr = new maplibregl.AttributionControl({ compact: true, customAttribution: attribution });
  map.addControl(attr, "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  return { map, attr };
}

/** Turn a drawn shape into a signed distance field, the format MapLibre's
 * SDF icons expect (edge at alpha 192, about 24 per pixel), so the halo
 * (the train-kind border) can be several pixels wide instead of the
 * one-pixel fringe a hard-edged image allows. */
function toSdf(img) {
  const { width: w, height: h, data } = img;
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inside[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  // Edge pixels: inside pixels next to an outside one, and vice versa.
  const edges = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = inside[y * w + x];
      if ((x > 0 && inside[y * w + x - 1] !== v) || (x < w - 1 && inside[y * w + x + 1] !== v) ||
          (y > 0 && inside[(y - 1) * w + x] !== v) || (y < h - 1 && inside[(y + 1) * w + x] !== v)) {
        edges.push(x, y);
      }
    }
  }
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      for (let k = 0; k < edges.length; k += 2) {
        const dx = edges[k] - x, dy = edges[k + 1] - y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      const dist = Math.sqrt(best) * (inside[y * w + x] ? 1 : -1);
      const o = (y * w + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = 0;
      out.data[o + 3] = Math.max(0, Math.min(255, Math.round(192 + dist * 24)));
    }
  }
  return out;
}

/** Draw the train icons once (SDF, so the colour comes from the data).
 * Names start with "tr-": the base map's own sprite has images called
 * "dot" and "arrow", and ours would replace them (big black town dots). */
function addIcons(map) {
  // Shapes are drawn on a 48 px design grid inside a 64 px image: the
  // margin leaves room for the border (halo) around them.
  const PAD = 8;
  const size = 48 + 2 * PAD;
  const make = (draw) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.strokeStyle = "#000";
    g.translate(PAD, PAD);
    draw(g);
    return toSdf(g.getImageData(0, 0, size, size));
  };
  const arrow = (g) => {
    g.beginPath();
    g.moveTo(24, 4);
    g.lineTo(42, 42);
    g.lineTo(24, 33);
    g.lineTo(6, 42);
    g.closePath();
  };
  map.addImage("tr-arrow", make((g) => (arrow(g), g.fill())), { sdf: true, pixelRatio: 2 });
  // Trains from ARROW_ZOOM: a drop pointing where they're heading, in two
  // pieces drawn on the same centre: the outer drop (its colour = kind of
  // service) and a smaller one inside (its colour = delay), so the ring is a
  // crisp 3 px band at any size. Zoomed out, the same as two dots.
  const drop = (r, tipY) => (g) => {
    const cy = 30;
    const a = Math.asin(r / (cy - tipY));
    g.beginPath();
    g.moveTo(24, tipY);
    g.arc(24, cy, r, -a, Math.PI + a);
    g.closePath();
    g.fill();
  };
  const dot = (r) => (g) => {
    g.beginPath();
    g.arc(24, 30, r, 0, 2 * Math.PI);
    g.fill();
  };
  map.addImage("tr-drop-out", make(drop(16, 0)), { sdf: true, pixelRatio: 2 });
  map.addImage("tr-drop-in", make(drop(10, 10)), { sdf: true, pixelRatio: 2 });
  map.addImage("tr-dot-out", make(dot(16)), { sdf: true, pixelRatio: 2 });
  map.addImage("tr-dot-in", make(dot(10.5)), { sdf: true, pixelRatio: 2 });
  // High speed: slimmer and more pointed. Medium distance: flat tip.
  map.addImage(
    "tr-arrow-av",
    make((g) => {
      g.beginPath();
      g.moveTo(24, 1);
      g.lineTo(38, 46);
      g.lineTo(24, 37);
      g.lineTo(10, 46);
      g.closePath();
      g.fill();
    }),
    { sdf: true, pixelRatio: 2 },
  );
  map.addImage(
    "tr-arrow-md",
    make((g) => {
      g.beginPath();
      g.moveTo(17, 6);
      g.lineTo(31, 6);
      g.lineTo(43, 42);
      g.lineTo(24, 33);
      g.lineTo(5, 42);
      g.closePath();
      g.fill();
    }),
    { sdf: true, pixelRatio: 2 },
  );
  map.addImage(
    "tr-arrow-hollow",
    make((g) => {
      arrow(g);
      g.lineWidth = 6;
      g.lineJoin = "round";
      g.stroke();
    }),
    { sdf: true, pixelRatio: 2 },
  );
  map.addImage(
    "tr-dot-hollow",
    make((g) => {
      g.beginPath();
      g.arc(24, 24, 13, 0, 2 * Math.PI);
      g.lineWidth = 6;
      g.stroke();
    }),
    { sdf: true, pixelRatio: 2 },
  );
  map.addImage(
    "tr-dot",
    make((g) => {
      g.beginPath();
      g.arc(24, 24, 15, 0, 2 * Math.PI);
      g.fill();
    }),
    { sdf: true, pixelRatio: 2 },
  );
  // Stations: white squares with a dark border (not SDF: two colours).
  map.addImage(
    "tr-station",
    (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 24;
      const g = c.getContext("2d");
      g.fillStyle = "#334155";
      g.fillRect(2, 2, 20, 20);
      g.fillStyle = "#ffffff";
      g.fillRect(6, 6, 12, 12);
      return g.getImageData(0, 0, 24, 24);
    })(),
    { pixelRatio: 2 },
  );
}

/** Zoom from which trains are arrows (below: dots). */
export const ARROW_ZOOM = 9;

/** IGN orthophoto (PNOA, CC BY 4.0): the "satellite" base map. */
export const SATELLITE_TILES = "https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg";

/** Show the satellite imagery over the vector base map, or hide it. It
 * sits under all of TrainRadar's own layers. */
export function setBasemap(map, kind) {
  if (!map.getSource("satellite")) {
    map.addSource("satellite", {
      type: "raster",
      tiles: [SATELLITE_TILES],
      scheme: "tms",
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Ortofoto: <a href="https://pnoa.ign.es/" target="_blank" rel="noopener">PNOA</a> © IGN (CC BY 4.0)',
    });
    map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } }, "track-md-casing");
  }
  map.setLayoutProperty("satellite", "visibility", kind === "satellite" ? "visible" : "none");
}

export function addLayers(map) {
  addIcons(map);
  // AV/LD/MD track we have geometry for (OpenStreetMap legs).
  map.addSource("track", { type: "geojson", data: empty() });
  // One layer per kind of train using the track (a section used by several
  // kinds is in each; the high-speed one is drawn on top).
  for (const [kind, prop] of [["md", "md"], ["ld", "ld"], ["av", "av"]]) {
    map.addLayer({
      id: `track-${kind}-casing`,
      type: "line",
      source: "track",
      filter: ["==", ["get", prop], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": width(TRACK_W, 3), "line-opacity": 0.9 },
    });
    map.addLayer({
      id: `track-${kind}`,
      type: "line",
      source: "track",
      filter: ["==", ["get", prop], true],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": TRACK_COLORS[kind], "line-width": width(TRACK_W), "line-opacity": 0.95 },
    });
  }
  // Cercanías lines in their colours (dashed orange when a notice names them),
  // and the selected train's route.
  map.addSource("lines", { type: "geojson", data: empty() });
  map.addSource("route", { type: "geojson", data: empty() });
  // Cercanías over conventional and high speed where they share a corridor.
  map.addLayer({
    id: "lines-casing",
    type: "line",
    source: "lines",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": width(CER_W, 3), "line-opacity": 0.9 },
  });
  map.addLayer({
    id: "lines",
    type: "line",
    source: "lines",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": width(CER_W), "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "lines-notice",
    type: "line",
    source: "lines",
    filter: ["==", ["get", "notice"], true],
    paint: {
      "line-color": "#ea580c",
      "line-width": width(CER_W),
      "line-dasharray": [1.5, 1.5],
      "line-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "route",
    type: "line",
    source: "route",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#1d4ed8", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 6, 12, 12], "line-opacity": 0.6 },
  });
  map.addLayer({
    id: "route-stops",
    type: "circle",
    source: "route",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3, 12, 6],
      "circle-color": "#ffffff",
      "circle-stroke-color": "#1d4ed8",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "route-labels",
    type: "symbol",
    source: "route",
    filter: ["==", ["geometry-type"], "Point"],
    minzoom: 7,
    layout: {
      "text-field": ["concat", ["get", "name"], " ", ["get", "time"]],
      "text-size": 11,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: { "text-color": "#1e3a8a", "text-halo-color": "#fff", "text-halo-width": 1.4 },
  });

  map.addSource("stations", { type: "geojson", data: empty() });
  map.addSource("trains", { type: "geojson", data: empty() });
  map.addSource("selected", { type: "geojson", data: empty() });

  // Stations: white circles with a thick border in the colour of their
  // service (teal long distance, red Cercanías); interchanges (both) are
  // bigger, dark-bordered and named sooner. Long-distance ones from zoom 6,
  // all from zoom 9. An invisible 22 px circle makes each easy to tap.
  const big = ["==", ["get", "services"], 3];
  const stationPaint = {
    "circle-color": "#ffffff",
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["case", big, 3, 2.5], 8, ["case", big, 4, 3], 11, ["case", big, 7, 5], 14, ["case", big, 10, 7]],
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 1.5, 11, ["case", big, 3.5, 2.5], 14, ["case", big, 4, 3]],
    "circle-stroke-color": ["match", ["get", "services"], 3, "#1f2937", 2, SERVICE_COLORS.cer, SERVICE_COLORS.conv],
  };
  const longDistance = ["==", ["%", ["get", "services"], 2], 1]; // SERVICE_LONG_DISTANCE bit
  map.addLayer({ id: "stations-ld", type: "circle", source: "stations", minzoom: 6, maxzoom: 9, filter: longDistance, paint: stationPaint });
  map.addLayer({ id: "stations", type: "circle", source: "stations", minzoom: 9, paint: stationPaint });
  const hit = { "circle-radius": 22, "circle-color": "#000000", "circle-opacity": 0 };
  map.addLayer({ id: "stations-ld-hit", type: "circle", source: "stations", minzoom: 6, maxzoom: 9, filter: longDistance, paint: hit });
  map.addLayer({ id: "stations-hit", type: "circle", source: "stations", minzoom: 9, paint: hit });
  const label = (minzoom, size) => ({
    "text-field": ["get", "name"],
    "text-size": size,
    "text-offset": [0, 1.1],
    "text-anchor": "top",
    "text-optional": true,
  });
  const labelPaint = { "text-color": "#1f2937", "text-halo-color": "#fff", "text-halo-width": 1.5 };
  map.addLayer({ id: "station-labels-big", type: "symbol", source: "stations", minzoom: 8, filter: big, layout: label(8, 12.5), paint: labelPaint });
  map.addLayer({ id: "station-labels", type: "symbol", source: "stations", minzoom: 11, filter: ["!", big], layout: label(11, 11.5), paint: labelPaint });
  // Stations named in Renfe notices.
  map.addSource("incidents", { type: "geojson", data: empty() });
  map.addLayer({
    id: "incidents",
    type: "circle",
    source: "incidents",
    minzoom: 6,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 9],
      "circle-color": ["match", ["get", "kind"], ...Object.entries(KIND_COLORS).flat(), KIND_COLORS.other],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.9,
    },
  });

  // The user's position (only when they turn location on).
  map.addSource("user", { type: "geojson", data: empty() });
  map.addSource("user-accuracy", { type: "geojson", data: empty() });
  map.addLayer({
    id: "user-accuracy",
    type: "fill",
    source: "user-accuracy",
    paint: { "fill-color": "#2563eb", "fill-opacity": 0.12, "fill-outline-color": "#2563eb" },
  });
  map.addLayer({
    id: "user",
    type: "circle",
    source: "user",
    paint: {
      "circle-radius": 7,
      "circle-color": "#2563eb",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2.5,
    },
  });
  map.addLayer({
    id: "selected-ring",
    type: "circle",
    source: "selected",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 13, 9, 15, 12, 19, 15, 22],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#1d4ed8",
      "circle-stroke-width": 3,
    },
  });
  // Trains stopped between stations get a red ring.
  map.addLayer({
    id: "stopped-ring",
    type: "circle",
    source: "trains",
    filter: ["==", ["get", "s"], 1],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 7, 8, 12, 9, 14, 12, 18, 15, 21],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#b91c1c",
      "circle-stroke-width": ["case", ["==", ["get", "l"], 1], 1.5, 2.5],
      "circle-stroke-opacity": ["case", ["==", ["get", "dim"], 1], 0.25, 1],
    },
  });
  // Trains: zoomed out, coloured dots; from ARROW_ZOOM, drops pointing where
  // they're heading (a dot if unknown). Inside = delay (white: position
  // from the timetable only); the ring = kind of service (purple high
  // speed, teal conventional, the line's colour for Cercanías), with a thin
  // white rim that keeps them clear on any base map.
  const image = (part) => [
    "step", ["zoom"],
    `tr-dot-${part}`,
    ARROW_ZOOM,
    ["case", ["has", "b"], `tr-drop-${part}`, `tr-dot-${part}`],
  ];
  const trainLayout = (part) => ({
    "icon-image": image(part),
    "icon-rotate": ["coalesce", ["get", "b"], 0],
    "icon-rotation-alignment": "map",
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    // Dots: about 8 px for all of Spain, 18 px just before ARROW_ZOOM.
    // Drops: about 22 px at ARROW_ZOOM, 28 px at city zoom (12), 32 px close up.
    "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 6, 0.8, ARROW_ZOOM - 0.01, 1.35, ARROW_ZOOM, 1.2, 12, 1.55, 15, 1.8],
    "symbol-sort-key": ["get", "c"],
  });
  const opacity = ["case", ["==", ["get", "dim"], 1], 0.18, [">", ["get", "a"], 600], 0.65, 1];
  map.addLayer({
    id: "trains-ring",
    type: "symbol",
    source: "trains",
    layout: trainLayout("out"),
    paint: {
      "icon-color": [
        "match", ["get", "t"],
        ["av", "ouigo"], SERVICE_COLORS.av,
        "cer", ["coalesce", ["get", "lc"], SERVICE_COLORS.cer],
        SERVICE_COLORS.conv,
      ],
      "icon-halo-color": "#ffffff",
      "icon-halo-width": 1.2,
      "icon-opacity": opacity,
    },
  });
  map.addLayer({
    id: "trains",
    type: "symbol",
    source: "trains",
    layout: trainLayout("in"),
    paint: {
      "icon-color": [
        "case",
        ["==", ["get", "sch"], 1],
        "#ffffff",
        ["match", ["get", "c"], 0, COLORS[0], 1, COLORS[1], 2, COLORS[2], COLORS[3]],
      ],
      "icon-opacity": opacity,
    },
  });
  // "C5 +12" next to each train when zoomed in to a city.
  map.addLayer({
    id: "train-labels",
    type: "symbol",
    source: "trains",
    minzoom: 12,
    filter: ["all", ["has", "lb"], ["!=", ["get", "dim"], 1]],
    layout: {
      "text-field": ["get", "lb"],
      "text-size": 11.5,
      "text-anchor": "left",
      "text-offset": [1.5, 0],
      "text-optional": true,
      "symbol-sort-key": ["-", 3, ["get", "c"]],
    },
    paint: { "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.8 },
  });
}

/** Turn engine.positions() into GeoJSON. `highlight` (a Set of indexes) dims
 * every other train; `hidden(flags)` filters trains out entirely; `meta(i)`
 * may give `{ lc, lb }`: the Cercanías line colour and the "C5 +12" label. */
export function trainsGeoJson(flat, highlight = null, hidden = () => false, meta = () => null) {
  const features = [];
  for (let i = 0; i * STRIDE < flat.length; i++) {
    const o = i * STRIDE;
    const flags = flat[o + 5];
    if (hidden(flags)) continue;
    const props = {
      i,
      c: flat[o + 2],
      a: flat[o + 4],
      s: flags & FLAG.stopped ? 1 : 0,
      l: flags & FLAG.likely ? 1 : 0,
      sch: flags & FLAG.scheduled ? 1 : 0,
      // Kind of train, for the border colour.
      t: flags & FLAG.scheduled ? "ouigo" : flags & FLAG.commuter ? "cer" : flags & FLAG.highSpeed ? "av" : flags & FLAG.medium ? "md" : "ld",
      dim: highlight && !highlight.has(i) ? 1 : 0,
    };
    if (!Number.isNaN(flat[o + 3])) props.b = flat[o + 3];
    const m = meta(i);
    if (m?.lc) props.lc = m.lc;
    if (m?.lb) props.lb = m.lb;
    features.push({ type: "Feature", id: i, geometry: { type: "Point", coordinates: [flat[o], flat[o + 1]] }, properties: props });
  }
  return { type: "FeatureCollection", features };
}

/** Show base-map place names in the app's language (OpenMapTiles has
 * `name:es`, `name:en` and the local `name`). */
export function setMapLanguage(map, lang) {
  const field = ["coalesce", ["get", `name:${lang}`], ["get", "name"]];
  for (const layer of map.getStyle()?.layers || []) {
    if (layer.type !== "symbol" || layer.source === "stations") continue;
    const tf = map.getLayoutProperty(layer.id, "text-field");
    if (tf && JSON.stringify(tf).includes("name")) map.setLayoutProperty(layer.id, "text-field", field);
  }
}

export function pointGeoJson(lon, lat) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} }],
  };
}

export { empty as emptyGeoJson, maplibregl };
