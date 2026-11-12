// National Rail Knowledgebase incidents (Rail Data Marketplace, product
// P-cf16832d-d971-46e7-8883-4fca2101d3fa) → uk/rt/incidents.json, the UK's
// "Avisos" (plan 3, phase 3e). The XML is NRE's incident schema v5:
//
//   <Incidents xmlns="http://nationalrail.co.uk/xml/incident" xmlns:com=…>
//     <PtIncident>
//       <CreationTime/> <ChangeHistory><com:LastChangedDate/></ChangeHistory>
//       <IncidentNumber/> <Version/>
//       <ValidityPeriod><com:StartTime/><com:EndTime/></ValidityPeriod>…
//       <Planned>true</Planned> <ClearedIncident>…
//       <Summary><![CDATA[…]]></Summary> <Description><![CDATA[<p>html</p>]]>
//       <InfoLinks><InfoLink><Uri/><Label/></InfoLink></InfoLinks>
//       <Affects><Operators><AffectedOperator><OperatorRef/><OperatorName/>…
//                <RoutesAffected><![CDATA[<p>…</p>]]></RoutesAffected></Affects>
//       <IncidentPriority/>
//
// Workers have no DOM parser, so this reads the few elements it needs with
// regular expressions (namespace prefixes ignored). The texts are untrusted:
// HTML is reduced to plain text here and the app shows it as text only.
//
// Licence (docs/licenses/): free; credit the Rail Delivery Group as the
// source without implying endorsement, and pass on an accuracy notice.

export const KB_URL = "https://api1.raildata.org.uk/1010-knowlegebase-incidents-xml-feed1_0/incidents.xml";
export const KB_EVERY_MS = 5 * 60_000;
export const KB_SOURCE = "Rail Delivery Group (National Rail Knowledgebase), via the Rail Data Marketplace";
export const KB_NOTICE =
  "Information from National Rail may be incomplete or out of date. Check with National Rail Enquiries or your train operator before you travel.";
/** Links kept only to National Rail's own pages. */
const LINK_OK = /^https:\/\/www\.nationalrail\.co\.uk\//;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Element contents (CDATA unwrapped), ignoring namespace prefixes. */
function all(xml, name) {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "g");
  return [...xml.matchAll(re)].map((m) => {
    const inner = m[1].trim();
    const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
    return cdata ? cdata[1] : decode(inner);
  });
}
const one = (xml, name) => all(xml, name)[0] ?? "";

/** HTML → plain text: paragraphs, headings and list items on their own lines. */
export function htmlToText(html) {
  const t = html
    .replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\/\s*(p|h\d|li|ul|ol|div)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decode(t)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const time = (s) => {
  const ms = Date.parse(s || "");
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
};

/** All incidents in the XML, as plain objects. */
export function parseIncidents(xml) {
  const out = [];
  for (const block of all(xml, "PtIncident")) {
    const periods = all(block, "ValidityPeriod").map((p) => [time(one(p, "StartTime")), time(one(p, "EndTime"))]);
    const cleared = one(block, "ClearedIncident").toLowerCase() === "true";
    const link = all(block, "Uri").find((u) => LINK_OK.test(u.trim()));
    out.push({
      id: one(block, "IncidentNumber"),
      version: one(block, "Version"),
      summary: htmlToText(one(block, "Summary")),
      text: htmlToText(one(block, "Description")),
      routes: htmlToText(one(block, "RoutesAffected")),
      operators: all(block, "AffectedOperator").map((o) => ({ code: one(o, "OperatorRef"), name: one(o, "OperatorName") })),
      planned: one(block, "Planned").toLowerCase() === "true",
      priority: Number(one(block, "IncidentPriority")) || null,
      from: periods.length ? Math.min(...periods.map((p) => p[0] ?? Infinity)) : null,
      until: periods.some((p) => p[1] === null) ? null : periods.length ? Math.max(...periods.map((p) => p[1])) : null,
      updated: time(one(block, "LastChangedDate")) ?? time(one(block, "CreationTime")),
      url: link ? link.trim() : null,
      cleared,
    });
  }
  return out;
}

/** What the app shows: not cleared, not over; unplanned first, then by priority and start. */
export function activeIncidents(list, nowS) {
  return list
    .filter((i) => i.id && !i.cleared && (i.until === null || i.until >= nowS))
    .map(({ cleared: _cleared, ...i }) => {
      if (!Number.isFinite(i.from)) i.from = null;
      return i;
    })
    .sort((a, b) => Number(a.planned) - Number(b.planned) || (a.priority ?? 9) - (b.priority ?? 9) || (b.from ?? 0) - (a.from ?? 0));
}

/** The document published at uk/rt/incidents.json. */
export function incidentsDoc(list, now) {
  return {
    updatedAt: new Date(now).toISOString(),
    source: KB_SOURCE,
    notice: KB_NOTICE,
    incidents: activeIncidents(list, Math.round(now / 1000)),
  };
}

/** Fetch and publish, if a key is set and it's time. Returns a status, or null when not due. */
export async function refreshIncidents({ state, env, fetchFn = fetch, now = Date.now() }) {
  const key = env.NATIONAL_RAIL_KB_KEY;
  if (!key) return null;
  if (now - (state.kbAt || 0) < KB_EVERY_MS) return null;
  state.kbAt = now;
  try {
    const res = await fetchFn(KB_URL, { headers: { "x-apikey": key, accept: "application/xml" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = incidentsDoc(parseIncidents(await res.text()), now);
    await env.LIVE.put("uk/rt/incidents.json", JSON.stringify(doc), {
      httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=120" },
    });
    state.kb = { ok: true, at: doc.updatedAt, incidents: doc.incidents.length };
  } catch (e) {
    state.kb = { ok: false, at: new Date(now).toISOString(), error: String(e?.message || e).slice(0, 200) };
  }
  return state.kb;
}
