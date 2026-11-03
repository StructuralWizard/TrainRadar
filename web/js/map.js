// MapLibre map with the train and station layers.
import * as maplibregl from "../vendor/maplibre/maplibre-gl.mjs";

export const COLORS = ["#1a9850", "#f39c12", "#d7301f", "#8c8c8c"]; // on time, 5–14, 15+, unknown
export const SCHEDULED_COLOR = "#7c3aed"; // timetable-only trains (OUIGO)
export const STRIDE = 6; // engine.positions(): lon, lat, class, bearing, fix age, flags
export const FLAG = { stopped: 1, likely: 2, scheduled: 4, commuter: 8 };

const empty = () => ({ type: "FeatureCollection", features: [] });

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
  map.on("error", (e) => {
    if (fellBack || map.isStyleLoaded()) return;
    if (!String(e?.error?.message || "").includes(config.style)) return;
    fellBack = true;
    console.warn("Base map unavailable, using a blank background");
    map.setStyle(BLANK_STYLE);
  });
  const attr = new maplibregl.AttributionControl({ compact: true, customAttribution: attribution });
  map.addControl(attr, "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  return { map, attr };
}

/** Draw the train icons once (SDF, so the colour comes from the data). */
function addIcons(map) {
  const size = 48;
  const make = (draw) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.strokeStyle = "#000";
    draw(g);
    return g.getImageData(0, 0, size, size);
  };
  const arrow = (g) => {
    g.beginPath();
    g.moveTo(24, 4);
    g.lineTo(42, 42);
    g.lineTo(24, 33);
    g.lineTo(6, 42);
    g.closePath();
  };
  map.addImage("arrow", make((g) => (arrow(g), g.fill())), { sdf: true, pixelRatio: 2 });
  map.addImage(
    "arrow-hollow",
    make((g) => {
      arrow(g);
      g.lineWidth = 6;
      g.lineJoin = "round";
      g.stroke();
    }),
    { sdf: true, pixelRatio: 2 },
  );
  map.addImage(
    "dot",
    make((g) => {
      g.beginPath();
      g.arc(24, 24, 15, 0, 2 * Math.PI);
      g.fill();
    }),
    { sdf: true, pixelRatio: 2 },
  );
  // Stations: white squares with a dark border (not SDF: two colours).
  map.addImage(
    "station",
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
    map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } }, "track");
  }
  map.setLayoutProperty("satellite", "visibility", kind === "satellite" ? "visible" : "none");
}

export function addLayers(map) {
  addIcons(map);
  // AV/LD/MD track we have geometry for: dark for standard gauge (high
  // speed), grey otherwise; dashed where single track.
  map.addSource("track", { type: "geojson", data: empty() });
  map.addLayer({
    id: "track",
    type: "line",
    source: "track",
    paint: {
      "line-color": ["case", ["==", ["get", "gauge"], 1435], "#334155", "#94a3b8"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 2.5],
      "line-opacity": 0.7,
    },
  });
  // Cercanías lines in their colours (dashed orange when a notice names them),
  // and the selected train's route.
  map.addSource("lines", { type: "geojson", data: empty() });
  map.addSource("route", { type: "geojson", data: empty() });
  map.addLayer({
    id: "lines",
    type: "line",
    source: "lines",
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.2, 12, 3],
      "line-opacity": 0.6,
    },
  });
  map.addLayer({
    id: "lines-notice",
    type: "line",
    source: "lines",
    filter: ["==", ["get", "notice"], true],
    paint: {
      "line-color": "#ea580c",
      "line-width": ["interpolate", ["linear"], ["zoom"], 7, 2, 12, 5],
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
    paint: { "line-color": "#1d4ed8", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3, 12, 6], "line-opacity": 0.75 },
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

  // Stations as squares: long-distance ones from zoom 6, all from zoom 9.
  const stationLayout = {
    "icon-image": "station",
    "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.45, 10, 0.7, 14, 1],
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };
  map.addLayer({
    id: "stations-ld",
    type: "symbol",
    source: "stations",
    minzoom: 6,
    maxzoom: 9,
    filter: ["==", ["%", ["get", "services"], 2], 1], // SERVICE_LONG_DISTANCE bit
    layout: stationLayout,
  });
  map.addLayer({ id: "stations", type: "symbol", source: "stations", minzoom: 9, layout: stationLayout });
  map.addLayer({
    id: "station-labels",
    type: "symbol",
    source: "stations",
    minzoom: 11,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-offset": [0, 1],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: { "text-color": "#333", "text-halo-color": "#fff", "text-halo-width": 1.2 },
  });
  // Stations named in Renfe notices.
  map.addSource("incidents", { type: "geojson", data: empty() });
  map.addLayer({
    id: "incidents",
    type: "circle",
    source: "incidents",
    minzoom: 6,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 9],
      "circle-color": "#f59e0b",
      "circle-stroke-color": "#7c2d12",
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
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 9, 10, 13, 15, 18],
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
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 8, 10, 12, 15, 16],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#b91c1c",
      "circle-stroke-width": ["case", ["==", ["get", "l"], 1], 1.5, 2.5],
      "circle-stroke-opacity": ["case", ["==", ["get", "dim"], 1], 0.25, 1],
    },
  });
  // Trains: arrows pointing where they're heading (a dot if unknown).
  map.addLayer({
    id: "trains",
    type: "symbol",
    source: "trains",
    layout: {
      "icon-image": ["case", ["==", ["get", "sch"], 1], "arrow-hollow", ["has", "b"], "arrow", "dot"],
      "icon-rotate": ["coalesce", ["get", "b"], 0],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      // Filled arrows read smaller than the hollow OUIGO ones (no outline):
      // draw them a third bigger.
      "icon-size": [
        "interpolate", ["linear"], ["zoom"],
        4, ["case", ["==", ["get", "sch"], 1], 0.45, 0.62],
        8, ["case", ["==", ["get", "sch"], 1], 0.6, 0.82],
        12, ["case", ["==", ["get", "sch"], 1], 0.85, 1.1],
        15, ["case", ["==", ["get", "sch"], 1], 1.1, 1.4],
      ],
      "symbol-sort-key": ["get", "c"],
    },
    paint: {
      "icon-color": [
        "case",
        ["==", ["get", "sch"], 1],
        SCHEDULED_COLOR,
        ["match", ["get", "c"], 0, COLORS[0], 1, COLORS[1], 2, COLORS[2], COLORS[3]],
      ],
      "icon-halo-color": "#ffffff",
      "icon-halo-width": 1.2,
      // Old GPS fixes fade a little; trains outside a highlighted line fade a lot.
      "icon-opacity": ["case", ["==", ["get", "dim"], 1], 0.18, [">", ["get", "a"], 600], 0.65, 1],
    },
  });
}

/** Turn engine.positions() into GeoJSON. `highlight` (a Set of indexes) dims
 * every other train; `hidden(flags)` filters trains out entirely. */
export function trainsGeoJson(flat, highlight = null, hidden = () => false) {
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
      dim: highlight && !highlight.has(i) ? 1 : 0,
    };
    if (!Number.isNaN(flat[o + 3])) props.b = flat[o + 3];
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
