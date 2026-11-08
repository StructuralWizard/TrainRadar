// Inline SVG icons (24×24, stroke = currentColor), built with DOM calls so
// the CSP and the textContent-only rule hold. Decorative: aria-hidden, the
// button or link around an icon carries the label.
const NS = "http://www.w3.org/2000/svg";

// [tag, attrs] parts per icon; `fill` icons are solid shapes.
const ICONS = {
  search: [["circle", { cx: 11, cy: 11, r: 7 }], ["path", { d: "M20 20l-3.5-3.5" }]],
  chevronDown: [["path", { d: "M6 9l6 6 6-6" }]],
  chevronLeft: [["path", { d: "M15 18l-6-6 6-6" }]],
  chevronRight: [["path", { d: "M9 6l6 6-6 6" }]],
  close: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
  map: [["path", { d: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" }], ["path", { d: "M9 4v14M15 6v14" }]],
  pin: [["circle", { cx: 12, cy: 10, r: 3 }], ["path", { d: "M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" }]],
  warning: [["path", { d: "M12 3L2 20h20L12 3z" }], ["path", { d: "M12 10v4M12 17v.5" }]],
  star: [["path", { d: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z" }]],
  menu: [["path", { d: "M4 7h16M4 12h16M4 17h16" }]],
  layers: [["path", { d: "M12 3l9 5-9 5-9-5 9-5z" }], ["path", { d: "M3 13l9 5 9-5" }]],
  locate: { fill: true, parts: [["path", { d: "M21 3L3 10.5l7.5 2.5 2.5 7.5L21 3z" }]] },
  bell: [["path", { d: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" }], ["path", { d: "M10.3 21a1.9 1.9 0 0 0 3.4 0" }]],
  share: [["path", { d: "M4 12v8h16v-8" }], ["path", { d: "M12 3v12M8 7l4-4 4 4" }]],
  chart: [["path", { d: "M4 20V10M10 20V4M16 20v-7M22 20H2" }]],
  info: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 11v5M12 8v.5" }]],
  globe: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" }]],
  settings: [["circle", { cx: 12, cy: 12, r: 3 }], ["path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" }]],
  arrowRight: [["path", { d: "M5 12h14M13 6l6 6-6 6" }]],
  swap: [["path", { d: "M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" }]],
  play: { fill: true, parts: [["path", { d: "M8 5v14l11-7z" }]] },
  pause: { fill: true, parts: [["path", { d: "M7 5h4v14H7zM13 5h4v14h-4z" }]] },
  replay: [["path", { d: "M3 12a9 9 0 1 0 3-6.7L3 8" }], ["path", { d: "M3 3v5h5" }], ["path", { d: "M12 8v4l3 2" }]],
  suitcase: [["rect", { x: 3, y: 7, width: 18, height: 13, rx: 2 }], ["path", { d: "M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" }]],
  accessible: [["circle", { cx: 12, cy: 4.5, r: 1.5 }], ["path", { d: "M9 8h6M12 8v6h4l2 5M12 14a5 5 0 1 0 2.5 4.3" }]],
};

export const ICON_NAMES = Object.keys(ICONS);

/** An inline SVG icon element; `size` in px. */
export function icon(name, size = 24, extra = {}) {
  const def = ICONS[name];
  if (!def) throw new Error(`no icon ${name}`);
  const parts = Array.isArray(def) ? def : def.parts;
  const solid = !Array.isArray(def) && def.fill;
  const s = document.createElementNS(NS, "svg");
  const attrs = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: solid ? "currentColor" : "none",
    stroke: solid ? "none" : "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    class: `icon icon-${name}`,
    ...extra,
  };
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, String(v));
  for (const [tag, a] of parts) {
    const p = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) p.setAttribute(k, String(v));
    s.append(p);
  }
  return s;
}
