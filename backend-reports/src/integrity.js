// Google Play Integrity (backend-reports): only the real app, from Google
// Play, on a real phone, can send a report. The app asks Play for a token
// bound to the report (the nonce, rules.js nonceText); this Worker has
// Google decode it, with the service account in the Worker secret
// PLAY_INTEGRITY_CREDENTIALS and only the Play Integrity scope, and checks
// the verdict. Neither the credential nor the token is logged or returned.

export const PACKAGE = "com.metranos.trainradar";
const SCOPE = "https://www.googleapis.com/auth/playintegrity";

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

let cached = null; // { token, until }

/** An OAuth access token for the service account (JWT bearer grant), reused for 50 min. */
export async function accessToken(saJson, fetchFn = fetch, now = Date.now()) {
  if (cached && cached.until > now) return cached.token;
  const sa = JSON.parse(saJson);
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlText(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 }),
  )}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google token: HTTP ${r.status}`);
  cached = { token: j.access_token, until: now + 50 * 60_000 };
  return j.access_token;
}

/** Why a decoded verdict isn't good enough, or null when it is. */
export function verdictProblem(p, nonce, now) {
  const req = p?.requestDetails || {};
  if (req.requestPackageName !== PACKAGE) return "package";
  if (req.nonce !== nonce) return "nonce";
  if (!(Math.abs(now - Number(req.timestampMillis)) < 10 * 60_000)) return "stale";
  if (p.appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") return "app";
  if (!(p.deviceIntegrity?.deviceRecognitionVerdict || []).includes("MEETS_DEVICE_INTEGRITY")) return "device";
  return null;
}

/** Decode `token` with Google and check it: null when good, else why not. */
export async function checkIntegrity(token, nonce, env, fetchFn = fetch, now = Date.now()) {
  if (!env.PLAY_INTEGRITY_CREDENTIALS) return "not configured";
  try {
    const bearer = await accessToken(env.PLAY_INTEGRITY_CREDENTIALS, fetchFn, now);
    const r = await fetchFn(`https://playintegrity.googleapis.com/v1/${PACKAGE}:decodeIntegrityToken`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ integrity_token: token }),
    });
    if (!r.ok) return `decode HTTP ${r.status}`;
    const j = await r.json();
    return verdictProblem(j.tokenPayloadExternal, nonce, now);
  } catch {
    return "decode failed";
  }
}
