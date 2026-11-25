#!/usr/bin/env bash
# Germany: one call to DELFI's GTFS-RT trip updates on Mobilithek with the
# machine account's TLS client certificate (mutual TLS), and what came back:
#
#   DE_MOBILITHEK_CERT_P12=… DE_MOBILITHEK_CERT_PASSWORD=… tools/de/mobilithek-probe.sh TRIPS.txt OUT_DIR
#
# The certificate (base64 of the .p12) and its password come from the
# environment (AGENTS.md); the PEM files exist only in a private temporary
# directory removed on exit, and nothing secret is printed. TRIPS.txt lists
# the timetable's (trains-only) trip ids, to count how many updates are
# trains we have.
set -euo pipefail
trips="${1:?TRIPS.txt}"
out="${2:-samples/de}"
url="https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription?subscriptionID=1062396266817671168"
if [ -z "${DE_MOBILITHEK_CERT_P12:-}" ] || [ -z "${DE_MOBILITHEK_CERT_PASSWORD:-}" ]; then
  echo "de: DE_MOBILITHEK_CERT_P12 or DE_MOBILITHEK_CERT_PASSWORD is not set: skipped."
  exit 0
fi
mkdir -p "$out"
tmp=$(mktemp -d)
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT
printf '%s' "$DE_MOBILITHEK_CERT_P12" | base64 -d >"$tmp/c.p12"
# OpenSSL 3 needs -legacy for older .p12 files: try without, then with.
for extra in "" "-legacy"; do
  if openssl pkcs12 $extra -in "$tmp/c.p12" -passin env:DE_MOBILITHEK_CERT_PASSWORD -clcerts -nokeys -out "$tmp/cert.pem" 2>/dev/null &&
    openssl pkcs12 $extra -in "$tmp/c.p12" -passin env:DE_MOBILITHEK_CERT_PASSWORD -nocerts -nodes -out "$tmp/key.pem" 2>/dev/null; then
    echo "de: certificate opened${extra:+ (legacy)}: $(openssl x509 -in "$tmp/cert.pem" -noout -subject -enddate | tr '\n' ' ')"
    break
  fi
done
[ -s "$tmp/key.pem" ] || { echo "de: the certificate didn't open (wrong password, or not a .p12)"; exit 1; }
code=$(curl -sS --retry 2 --cert "$tmp/cert.pem" --key "$tmp/key.pem" -A "Metranos-TrainRadar" \
  -D "$tmp/headers" -o "$out/mobilithek.bin" -w '%{http_code}' "$url" || true)
echo "de: mobilithek: HTTP $code, $(wc -c <"$out/mobilithek.bin") bytes, $(grep -i '^content-type:' "$tmp/headers" | tr -d '\r' | cut -d' ' -f2-)"
echo "de: first bytes: $(head -c 24 "$out/mobilithek.bin" | od -An -tx1 | tr -s ' ' | head -c 80)"
if [ "$code" = 401 ] || [ "$code" = 403 ]; then
  echo "de: refused: link the machine account to the subscription (Mobilithek, My Subscriptions)."
  exit 0
fi
[ "$code" = 200 ] || exit 0
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fields, str, sub } from "./backend-eu/src/protobuf.js";
let b = readFileSync(process.argv[1]);
if (b[0] === 0x1f && b[1] === 0x8b) { b = gunzipSync(b); console.log(`de: gzip, ${b.length} bytes unpacked`); }
const known = new Set(readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean));
let n = 0, tu = 0, rail = 0, first = [];
try {
  for (const f of fields(new Uint8Array(b))) {
    if (f.field !== 2 || f.wire !== 2) continue;
    n++;
    const t = sub(f.value, 3);
    if (!t) continue;
    tu++;
    const id = str(sub(t, 1), 1);
    if (known.has(id)) rail++;
    if (first.length < 3) first.push(id);
  }
  console.log(`de: ${n} entities, ${tu} trip updates, ${rail} of them trains in the timetable (${tu ? Math.round(100 * rail / tu) : 0} %); first ids ${first.join(" ")}`);
} catch (e) {
  console.log(`de: not plain GTFS-RT (${e.message}): a container to unwrap? start: ${JSON.stringify(b.subarray(0, 200).toString("latin1"))}`);
}
' "$out/mobilithek.bin" "$trips"
