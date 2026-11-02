#!/usr/bin/env bash
# One-off probe (not part of the app). Never prints secrets.
set -u
echo "== NAP dataset 1515 update date"
curl -s -H "ApiKey: $NAP_API_KEY" -H "Accept: application/json" https://nap.transportes.gob.es/api/Fichero/1515 \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ('fechaActualizacion','fechaCreacion')});[print(f.get('ficheroId'),f.get('nombre'),f.get('fechaActualizacion'),f.get('tipoFichero')) for f in d.get('ficherosDto',[])]"
echo "== IDEE catalogue records (Adif rail network)"
for id in 8d185f60-78f3-4355-8aa3-153757cdb663 191574be-5eca-4315-b4b4-756dc50ac553; do
  for base in https://www.idee.es/csw-codsi-idee/srv/api/records https://inspire-geoportal.ec.europa.eu/srv/api/records; do
    rm -f rec.xml; curl -sS -L -m 30 -H "Accept: application/xml" "$base/$id/formatters/xml" -o rec.xml || true
    [ -s rec.xml ] && break
  done
  echo "-- $id ($(wc -c < rec.xml 2>/dev/null) bytes from $base)"
  grep -oE "https?://[^<\" ]*(wfs|WFS|wms|WMS|ideadif)[^<\" ]*" rec.xml 2>/dev/null | sed 's/&amp;/\&/g' | sort -u | head -10 | tee -a urls.txt
  python3 - <<'PY'
import re,os
if not os.path.exists('rec.xml'): raise SystemExit
t=open('rec.xml',encoding='utf-8',errors='replace').read()
for tag in ('useLimitation','otherConstraints','accessConstraints'):
    for m in re.findall(r'<[^>]*'+tag+r'[^>]*>(.*?)</[^>]*'+tag+r'>', t, re.S):
        s=re.sub(r'<[^>]+>',' ',m); s=re.sub(r'\s+',' ',s).strip()
        if s: print(tag+':', s[:500])
PY
done
echo "== Try service capabilities"
for u in $(grep -iE "wfs|wms" urls.txt 2>/dev/null | sort -u | head -4); do
  case "$u" in *GetCapabilities*|*getcapabilities*) q="$u";; *) q="$u?service=WFS&request=GetCapabilities";; esac
  code=$(curl -sS -L -m 30 -o cap.xml -w "%{http_code}" "$q" || true); echo "$q -> HTTP $code $(wc -c < cap.xml 2>/dev/null)"
  grep -oE "<(wfs:)?Name>[^<]+</(wfs:)?Name>|<Name>[^<]+</Name>|AccessConstraints>[^<]+|Fees>[^<]+" cap.xml 2>/dev/null | head -30
done
