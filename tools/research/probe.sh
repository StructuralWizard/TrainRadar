#!/usr/bin/env bash
# One-off probe (not part of the app). Never prints secrets.
set -u
echo "== NAP API (key present: $([ -n "${NAP_API_KEY:-}" ] && echo yes || echo no))"
code=$(curl -s -o nap-meta.json -w "%{http_code}" -H "ApiKey: $NAP_API_KEY" -H "Accept: application/json" https://nap.transportes.gob.es/api/Fichero/1515)
echo "metadata HTTP $code"; head -c 1500 nap-meta.json | tr -d '\r'; echo
code=$(curl -s -o ouigo.zip -w "%{http_code}" -H "ApiKey: $NAP_API_KEY" https://nap.transportes.gob.es/api/Fichero/download/1766)
echo "download HTTP $code, $(wc -c < ouigo.zip) bytes"
python3 -c "import zipfile;z=zipfile.ZipFile('ouigo.zip');print({i.filename:i.compress_type for i in z.infolist()})" || true

echo "== IDEAdif WFS"
W="https://ideadif.adif.es/services/wfs"
for u in "$W?service=WFS&request=GetCapabilities&version=2.0.0" "https://ideadif.adif.es/gservices/Tramificacion/wfs?service=WFS&request=GetCapabilities"; do
  code=$(curl -s -L -o cap.xml -w "%{http_code}" "$u"); echo "$u -> HTTP $code $(wc -c < cap.xml) bytes"
  grep -oE "<(wfs:)?Name>[^<]+</(wfs:)?Name>|<ows:Title>[^<]+</ows:Title>|AccessConstraints>[^<]+|Fees>[^<]+" cap.xml | head -40
done
echo "== IDEAdif catalog metadata (licence)"
curl -s -L "http://ideadif.adif.es/catalog/srv/eng/xml.metadata.get?id=117213" | grep -oE "(useLimitation|otherConstraints|accessConstraints)[^<]*<[^>]*>[^<]{0,400}" | head -10
echo "== Copernicus DEM (AWS open data) sample tile"
curl -s -o /dev/null -w "HTTP %{http_code} %{size_download}\n" -r 0-1023 "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N40_00_W004_00_DEM/Copernicus_DSM_COG_10_N40_00_W004_00_DEM.tif"
