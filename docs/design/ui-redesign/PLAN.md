# TrainRadar UI redesign — brief for Claude Code

Source: UI review of www.mytrainradar.com (1440×900, 768×1024, 375×812, light + dark) and the Google Play listing, 26 Nov 2026.
Design mockups: `docs/design/ui-redesign/mockups/*.dc.html` (exported from the Claude Design canvas; Main.dc.html is the full review). Open them in a browser as visual reference only; do not copy their markup.
Live canvas (best way to view them): https://claude.ai/artifact/Eb7jb5AMoNGGYwSvfBVPwu . Opened straight from disk they render roughly, without the canvas runtime (`support.js`).

## Goal
The phone UI (bottom nav, sheets, delay cards) is the target design language. Make tablet and desktop use it too, fix the bugs below, then redo the Play Store screenshots.

## Findings (P1 = first)
- P1 Tablet 768 px: legend wraps and overlaps the search box.
- P1 Map blank 10–15 s on load and on country switch, no loading state; in dark mode the blank area is light grey.
- P1 Attribution box expanded on load (covers ~1/3 of phone map, full strip on desktop).
- P1 Desktop/tablet still use old floating widgets (search, native "Ir a…" select, "▶ Capas"); three different UIs overall.
- P1 Play Store screenshots show old UI, tiny text, no captions; feature graphic is stock photo.
- P2 Not country-aware: title says Renfe but desktop opened on GB; Capas shows Cercanías/AVE/OUIGO while on UK; "Acerca de" lists only Spanish sources; check Avisos badge refreshes on country change.
- P2 Stats copy: "mediana A su hora" casing; NI Railways count wraps; phone chip truncates ("mediana 191 …").
- P2 Desktop right panels (Retrasos/Avisos/Acerca) cover the zoom-out button.
- P2 Desktop train popup hides train + route; 11-row table with inner scroll and empty rows.
- P2 Phone train sheet: "C10 75172" shown twice; oversized full-width Guardar button.
- P2 Markers: small dots at country zoom, hollow purple circles not in legend, teardrops at city zoom, labels like "75172 · 1434" unexplained.
- P3 Station sheet uses native "dd/mm/yyyy --:--" input.
- P3 Reload reopens last train sheet over the map.
- P3 Dark mode link contrast low.
- P3 system-ui font; no tabular numerals.

## Design tokens
```css
:root{
  --tr-brand:#1D4ED8; --tr-ink:#0F172A; --tr-muted:#475569;
  --tr-surface:#FFFFFF; --tr-ground:#F1F5F9; --tr-line:#E2E8F0;
  --tr-ontime:#15803D; --tr-minor:#B45309; --tr-major:#B91C1C; --tr-nodata:#64748B;
  --tr-radius-sm:10px; --tr-radius:16px; --tr-radius-sheet:24px;
  --tr-shadow:0 4px 16px rgba(15,23,42,.12);
  --tr-font:Inter,system-ui,sans-serif;
}
@media (prefers-color-scheme:dark){:root{
  --tr-ink:#F1F5F9; --tr-muted:#94A3B8; --tr-surface:#0F172A;
  --tr-ground:#020617; --tr-line:#1E293B; --tr-brand:#60A5FA;
}}
```
Delay pills: <5 green, 5–14 amber, 15+ red, no data grey. Links on dark surfaces: #93C5FD.

## Plan (do in order, one commit each)
1. **Tokens.** Add the variables; replace hard-coded colours, radii, shadows. Load Inter; `font-variant-numeric: tabular-nums` on times and delays.
2. **Quick fixes.** Attribution collapsed by default (i button). Map container background `var(--tr-ground)`. Skeleton + "Cargando trenes…" chip until first positions. Fix "mediana A su hora" casing. Stats as two chips: "N trenes" and "Mediana +X min"; NI count moves to detail.
3. **One responsive shell.** <900 px: current phone layout (bottom nav Mapa·Cerca·Avisos·Favoritos·Más; sheet with peek / half / full). ≥900 px: left side panel 380–392 px (logo + language, search with country button, the same five tabs as a segmented control, panel content below); map fills the rest. Remove old floating search / select / Capas widgets.
4. **Train detail component**, used in both sheet and side panel: header (line badge, number → destination, sub-line with origin/time or service/vía/GPS age, delay pill); actions Guardar · Seguir · Compartir (icon); stop timeline (passed grey, current ring in brand blue with "Ahora: entre X e Y", upcoming hollow, per-stop delay); previous/next train cards. Hide empty fields.
5. **Map controls.** Zoom, layers, locate stacked on the right; offset by the open panel or sheet height so nothing is ever covered. Legend = small bottom-left card (delay dots + service lines), collapsible; on phone it lives in the Capas sheet.
6. **Country awareness.** Layers, legend, data sources, page title and alerts driven by selected country.
7. **Markers.** Delay-coloured disc with white heading arrow, size scales with zoom, selected = brand halo; label "LINE · +delay".
8. **Station sheet.** Chips Ahora · Hoy · Mañana + time picker; Salidas/Llegadas segmented; rows = time, line badge, destination (ellipsis), vía + train no., delay pill.
9. **Phone launch.** Open on the map; if a train was being followed show a dark chip "Seguir C10 75172" instead of reopening the sheet.
10. **Play Store.** Capture new UI at 1080×2340; frame with 5–7 word headline per image. Order: map · train detail · station · alerts · Pro (alerts + widget) · UK · dark mode · no account / no ads. Feature graphic = map + logo. Add English listing.

## Acceptance (every step)
Test at 375, 768, 1024, 1440 px, light and dark. No control covered by a panel, sheet or legend. No text truncated in stats chips. Lighthouse accessibility ≥ 95; text contrast ≥ 4.5:1; touch targets ≥ 44 px.
