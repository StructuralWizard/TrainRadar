// The dashboard only answers people Cloudflare Access let in (backend-ops):
// Access puts a signed token in Cf-Access-Jwt-Assertion; it's checked here
// too (signature with Access's keys, audience, issuer, expiry), so a route
// that skipped Access still shows nothing. Without ACCESS_TEAM_DOMAIN and
// ACCESS_AUD, nothing is served.

let keys = null; // { at, team, jwks }

const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function jwks(team, fetchFn, now) {
  if (keys && keys.team === team && now - keys.at < 3600_000) return keys.jwks;
  const r = await fetchFn(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`Access certs: HTTP ${r.status}`);
  keys = { at: now, team, jwks: (await r.json()).keys || [] };
  return keys.jwks;
}

/** The signed-in email if the request carries a valid Access token, else null. */
export async function accessUser(request, env, fetchFn = fetch, now = Date.now()) {
  const team = (env.ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const aud = env.ACCESS_AUD || "";
  if (!team || !aud) return null;
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || "";
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(b64urlBytes(h)));
    const body = JSON.parse(new TextDecoder().decode(b64urlBytes(p)));
    if (head.alg !== "RS256") return null;
    const jwk = (await jwks(team, fetchFn, now)).find((k) => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
    const auds = Array.isArray(body.aud) ? body.aud : [body.aud];
    const t = now / 1000;
    if (!ok || !auds.includes(aud) || body.iss !== `https://${team}` || !(body.exp > t) || (body.nbf && body.nbf > t + 60)) return null;
    return body.email || body.sub || "signed in";
  } catch {
    return null;
  }
}
