#!/usr/bin/env bash
# One-off probe (not part of the app). Never prints secrets.
set -u
echo "== NAP dataset 1515 update date"
curl -s -H "ApiKey: $NAP_API_KEY" -H "Accept: application/json" https://nap.transportes.gob.es/api/Fichero/1515 \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print({k:d.get(k) for k in ('fechaActualizacion','fechaCreacion')});[print(f.get('ficheroId'),f.get('nombre'),f.get('fechaActualizacion'),f.get('tipoFichero')) for f in d.get('ficherosDto',[])]"
echo "== INSPIRE records (Adif rail network)"
for id in 8d185f60-78f3-4355-8aa3-153757cdb663 62c487b1-6816-4594-a800-218abe896994; do
  curl -s -L -H "Accept: application/xml" "https://inspire-geoportal.ec.europa.eu/srv/api/records/$id/formatters/xml" -o rec.xml
  echo "-- $id ($(wc -c < rec.xml) bytes)"
  grep -oE "https?://[^<\" ]*(wfs|WFS|wms|WMS|ideadif)[^<\" ]*" rec.xml | sort -u | head -12
  python3 - <<'PY'
import re
t=open('rec.xml',encoding='utf-8',errors='replace').read()
for tag in ('useLimitation','otherConstraints','accessConstraints','useConstraints'):
    for m in re.findall(r'<[^>]*'+tag+r'[^>]*>(.*?)</[^>]*'+tag+r'>', t, re.S):
        s=re.sub(r'<[^>]+>',' ',m); s=re.sub(r'\s+',' ',s).strip()
        if s: print(tag+':', s[:500])
PY
done
echo "== Try WFS capabilities found"
for u in $(grep -ohE "https?://[^<\" ]*ideadif[^<\" ]*" rec.xml 2>/dev/null | grep -iE "wfs" | sed 's/&amp;/\&/g' | sort -u | head -4); do
  code=$(curl -s -L -o cap.xml -w "%{http_code}" "$u"); echo "$u -> HTTP $code $(wc -c < cap.xml)"
  grep -oE "<(wfs:)?Name>[^<]+</(wfs:)?Name>|AccessConstraints>[^<]+|Fees>[^<]+" cap.xml | head -30
done
