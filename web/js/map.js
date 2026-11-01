// MapLibre map with the train and station layers.
import * as maplibregl from "../vendor/maplibre/maplibre-gl.mjs";

export const COLORS = ["#1a9850", "#f39c12", "#d7301f", "#8c8c8c"]; // on time, 5–14, 15+, unknown
export const STRIDE = 5; // engine.positions(): lon, lat, class, bearing, fix age

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

export function addLayers(map) {
  map.addSource("stations", { type: "geojson", data: empty() });
  map.addSource("trains", { type: "geojson", data: empty() });
  map.addSource("selected", { type: "geojson", data: empty() });

  map.addLayer({
    id: "stations",
    type: "circle",
    source: "stations",
    minzoom: 9,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2, 14, 5],
      "circle-color": "#ffffff",
      "circle-stroke-color": "#555",
      "circle-stroke-width": 1,
    },
  });
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
  map.addLayer({
    id: "trains",
    type: "circle",
    source: "trains",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 8, 5, 12, 7, 15, 9],
      "circle-color": ["match", ["get", "c"], 0, COLORS[0], 1, COLORS[1], 2, COLORS[2], COLORS[3]],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 12, 1.5],
      // Old GPS fixes fade a little: the position is an estimate.
      "circle-opacity": ["case", [">", ["get", "a"], 600], 0.65, 1],
      "circle-stroke-opacity": ["case", [">", ["get", "a"], 600], 0.65, 1],
    },
  });
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

/** Turn engine.positions() into GeoJSON. */
export function trainsGeoJson(flat) {
  const features = [];
  for (let i = 0; i * STRIDE < flat.length; i++) {
    const o = i * STRIDE;
    features.push({
      type: "Feature",
      id: i,
      geometry: { type: "Point", coordinates: [flat[o], flat[o + 1]] },
      properties: { i, c: flat[o + 2], a: flat[o + 4] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function pointGeoJson(lon, lat) {
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} }],
  };
}

export { empty as emptyGeoJson, maplibregl };
