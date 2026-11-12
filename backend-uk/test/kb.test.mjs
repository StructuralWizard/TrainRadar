import { test } from "node:test";
import assert from "node:assert/strict";
import { KB_EVERY_MS, KB_SOURCE, KB_URL, activeIncidents, htmlToText, incidentsDoc, parseIncidents, refreshIncidents } from "../src/kb.js";

// The shape of the real feed (UK feed check, 2026-11-12), shortened.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<Incidents xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:com="http://nationalrail.co.uk/xml/common" xmlns="http://nationalrail.co.uk/xml/incident">
  <PtIncident>
    <CreationTime>2025-12-09T10:55:49.337Z</CreationTime>
    <ChangeHistory>
      <com:ChangedBy>NRE CMS Editor</com:ChangedBy>
      <com:LastChangedDate>2026-10-08T09:54:45.679Z</com:LastChangedDate>
    </ChangeHistory>
    <IncidentNumber>C9289151915F4695BE0B50DC85518B83</IncidentNumber>
    <Version>20261008095445</Version>
    <ValidityPeriod>
      <com:StartTime>2025-12-09T00:00:00.000+00:00</com:StartTime>
      <com:EndTime>2027-05-15T23:59:00.000+01:00</com:EndTime>
    </ValidityPeriod>
    <Planned>true</Planned>
    <Summary><![CDATA[Bransty Tunnel track renewal: buses replace trains between Corkickle and Whitehaven until further notice]]></Summary>
    <Description><![CDATA[<p>During pre-planned <a href="https://www.nationalrail.co.uk/x/" title="">engineering work</a> in Bransty Tunnel, the line is closed.
</p><h4><strong>Customer advice:</strong></h4><ul><li>Buses replace trains</li><li>Allow 60 minutes &amp; more</li></ul><script>alert(1)</script>]]></Description>
    <InfoLinks>
      <InfoLink><Uri>https://www.nationalrail.co.uk/engineering-works/corkickle-9-dec-20251209/</Uri><Label>Incident detail page</Label></InfoLink>
    </InfoLinks>
    <Affects>
      <Operators>
        <AffectedOperator><OperatorRef>NT</OperatorRef><OperatorName>Northern</OperatorName></AffectedOperator>
      </Operators>
      <RoutesAffected><![CDATA[<p>Between Lancaster / Barrow-in-Furness and Carlisle </p>]]></RoutesAffected>
    </Affects>
    <IncidentPriority>2</IncidentPriority>
  </PtIncident>
  <PtIncident>
    <IncidentNumber>LIVE1</IncidentNumber>
    <ValidityPeriod><com:StartTime>2026-11-12T18:00:00.000Z</com:StartTime></ValidityPeriod>
    <Planned>false</Planned>
    <Summary><![CDATA[Disruption between Reading and London Paddington]]></Summary>
    <Description><![CDATA[<p>A points failure.</p>]]></Description>
    <InfoLinks><InfoLink><Uri>javascript:alert(1)</Uri></InfoLink></InfoLinks>
    <Affects><Operators>
      <AffectedOperator><OperatorRef>GW</OperatorRef><OperatorName>Great Western Railway</OperatorName></AffectedOperator>
      <AffectedOperator><OperatorRef>XR</OperatorRef><OperatorName>Elizabeth line</OperatorName></AffectedOperator>
    </Operators></Affects>
    <IncidentPriority>1</IncidentPriority>
  </PtIncident>
  <PtIncident>
    <IncidentNumber>OVER</IncidentNumber>
    <ValidityPeriod><com:StartTime>2026-01-01T00:00:00Z</com:StartTime><com:EndTime>2026-02-01T00:00:00Z</com:EndTime></ValidityPeriod>
    <Planned>true</Planned><Summary>Old works</Summary>
  </PtIncident>
  <PtIncident>
    <IncidentNumber>CLEARED</IncidentNumber><ClearedIncident>true</ClearedIncident>
    <Planned>false</Planned><Summary>Cleared</Summary>
  </PtIncident>
</Incidents>`;

const NOW = Date.parse("2026-11-12T21:00:00Z");

test("kb: parses NRE incident v5 XML", () => {
  const list = parseIncidents(XML);
  assert.equal(list.length, 4);
  const [a, b] = list;
  assert.equal(a.id, "C9289151915F4695BE0B50DC85518B83");
  assert.match(a.summary, /^Bransty Tunnel track renewal/);
  assert.equal(a.planned, true);
  assert.equal(a.priority, 2);
  assert.deepEqual(a.operators, [{ code: "NT", name: "Northern" }]);
  assert.equal(a.routes, "Between Lancaster / Barrow-in-Furness and Carlisle");
  assert.equal(a.from, Date.parse("2025-12-09T00:00:00Z") / 1000);
  assert.equal(a.until, Date.parse("2027-05-15T22:59:00Z") / 1000);
  assert.equal(a.updated, Math.round(Date.parse("2026-10-08T09:54:45.679Z") / 1000));
  assert.equal(a.url, "https://www.nationalrail.co.uk/engineering-works/corkickle-9-dec-20251209/");
  // HTML to text: no tags, no script, entities decoded, list items on lines.
  assert.ok(!/[<>]/.test(a.text), a.text);
  assert.ok(!a.text.includes("alert"));
  assert.match(a.text, /• Allow 60 minutes & more/);
  assert.match(a.text, /Customer advice:/);
  // Open-ended, and an unsafe link dropped.
  assert.equal(b.until, null);
  assert.equal(b.url, null);
  assert.equal(b.operators.length, 2);
});

test("kb: active list: not over, not cleared; unplanned first", () => {
  const active = activeIncidents(parseIncidents(XML), NOW / 1000);
  assert.deepEqual(active.map((i) => i.id), ["LIVE1", "C9289151915F4695BE0B50DC85518B83"]);
  assert.ok(!("cleared" in active[0]));
  const doc = incidentsDoc(parseIncidents(XML), NOW);
  assert.equal(doc.source, KB_SOURCE);
  assert.match(doc.notice, /out of date/);
  assert.equal(htmlToText("a&nbsp;<b>b</b>&#233;&#x41;"), "a béA");
});

test("kb: refresh fetches with the key every few minutes, publishes, reports errors", async () => {
  const objects = new Map();
  const env = { NATIONAL_RAIL_KB_KEY: "k3y", LIVE: { put: async (k, v, o) => objects.set(k, { v, o }) } };
  const calls = [];
  const fetchFn = async (url, init) => (calls.push([url, init.headers["x-apikey"]]), new Response(XML, { status: 200 }));
  const state = {};
  const st = await refreshIncidents({ state, env, fetchFn, now: NOW });
  assert.equal(st.ok, true);
  assert.equal(st.incidents, 2);
  assert.deepEqual(calls, [[KB_URL, "k3y"]]);
  const doc = JSON.parse(objects.get("uk/rt/incidents.json").v);
  assert.equal(doc.incidents.length, 2);
  assert.ok(!JSON.stringify(doc).includes("k3y"));
  // Not again within the interval.
  assert.equal(await refreshIncidents({ state, env, fetchFn, now: NOW + 60_000 }), null);
  // An error is reported, the last file kept.
  const bad = async () => new Response("no", { status: 401 });
  const st2 = await refreshIncidents({ state, env, fetchFn: bad, now: NOW + KB_EVERY_MS });
  assert.equal(st2.ok, false);
  assert.match(st2.error, /401/);
  assert.equal(JSON.parse(objects.get("uk/rt/incidents.json").v).incidents.length, 2);
  // No key: nothing.
  assert.equal(await refreshIncidents({ state: {}, env: { LIVE: env.LIVE }, fetchFn, now: NOW }), null);
});
