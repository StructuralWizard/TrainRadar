// Interface strings. Spanish is the default; English on request.

export const LANGS = ["es", "en"];

export const STRINGS = {
  es: {
    title: "TrainRadar · trenes de Renfe en directo",
    loading: "Cargando…",
    loadError: "No se pudieron cargar los datos. Reintentando…",
    feedError: "Sin respuesta de Renfe. Reintentando…",
    updated: "Actualizado {age}",
    trains: "{n} trenes",
    delayed: "{n} con retraso",
    median: "mediana {delay}",
    onTime: "A su hora",
    early: "{m} min antes",
    late: "+{m} min",
    unknown: "—",
    legendOnTime: "< 5 min",
    legendMinor: "5–14 min",
    legendMajor: "15+ min",
    legendUnknown: "sin datos",
    delayedList: "Retrasos",
    delayedTitle: "Llegadas con retraso",
    noDelays: "Ningún tren con 5 min o más de retraso.",
    close: "Cerrar",
    language: "English",
    languageLabel: "Change language to English",
    from: "Origen",
    to: "Destino",
    nextStop: "Próxima parada",
    at: "a las {time}",
    delay: "Retraso",
    sourceRenfe: "según Renfe",
    sourceEstimated: "estimado",
    position: "Posición",
    gpsAgo: "GPS {age}",
    estimatedPos: "estimada · último GPS {age}",
    ago: "hace {t}",
    ahead: "Tren anterior",
    behind: "Tren siguiente",
    gap: "{time} · {dist}",
    none: "—",
    platform: "Vía {p}",
    canceled: "Cancelado",
    unmatched: "Sin horario: solo posición GPS",
    cercanias: "Cercanías {region}",
    attribution:
      'Datos: © <a href="https://data.renfe.com" target="_blank" rel="noopener">Renfe</a> (CC BY 4.0) · Vías: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL) · Sin relación con Renfe ni Adif',
  },
  en: {
    title: "TrainRadar · live Renfe trains",
    loading: "Loading…",
    loadError: "Couldn't load the data. Retrying…",
    feedError: "No response from Renfe. Retrying…",
    updated: "Updated {age}",
    trains: "{n} trains",
    delayed: "{n} delayed",
    median: "median {delay}",
    onTime: "On time",
    early: "{m} min early",
    late: "+{m} min",
    unknown: "—",
    legendOnTime: "< 5 min",
    legendMinor: "5–14 min",
    legendMajor: "15+ min",
    legendUnknown: "no data",
    delayedList: "Delays",
    delayedTitle: "Delayed arrivals",
    noDelays: "No trains 5 min or more late.",
    close: "Close",
    language: "Español",
    languageLabel: "Cambiar el idioma a español",
    from: "From",
    to: "To",
    nextStop: "Next stop",
    at: "at {time}",
    delay: "Delay",
    sourceRenfe: "from Renfe",
    sourceEstimated: "estimated",
    position: "Position",
    gpsAgo: "GPS {age}",
    estimatedPos: "estimated · last GPS {age}",
    ago: "{t} ago",
    ahead: "Train ahead",
    behind: "Train behind",
    gap: "{time} · {dist}",
    none: "—",
    platform: "Platform {p}",
    canceled: "Cancelled",
    unmatched: "No timetable: GPS position only",
    cercanias: "Cercanías {region}",
    attribution:
      'Data: © <a href="https://data.renfe.com" target="_blank" rel="noopener">Renfe</a> (CC BY 4.0) · Track: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> (ODbL) · Not affiliated with Renfe or Adif',
  },
};

/** Translate `key`, filling `{name}` placeholders from `vars`. */
export function t(lang, key, vars = {}) {
  const s = (STRINGS[lang] || STRINGS.es)[key] ?? STRINGS.es[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Spanish unless the user picked English before. */
export function pickLang(stored) {
  return LANGS.includes(stored) ? stored : "es";
}
