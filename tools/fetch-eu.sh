#!/usr/bin/env bash
# Download an M2 country's sources for the reference data into gtfs/<cc>/
# (gitignored):  tools/fetch-eu.sh fi|no|nl|sk|ee|ch|se|pl|at|cz|it|dk|hu|de|be|au-nsw|au-vic|au-osm|nz-wlg|nz-akl|nz-osm|sg|pt|pt-lis|jp-tyo|jp-kch|jp-aom|jp-ygt|jp-tym|jp-gif|jp-mie|jp-tks|jp-kmm [--no-osm]
#   gtfs.zip          the country's trains in one GTFS:
#                     fi  Digitraffic's (Fintraffic), CC BY 4.0, daily,
#                         platforms merged into stations
#                     no  Entur's rail operators (Vy, Go-Ahead Nordic,
#                         SJ Norge, Flytoget), NLOD, daily, merged and
#                         cut to trains by tools/gtfs-rail.py
#                     nl  OVapi's national GTFS (CC0 timetables, ODbL
#                         shapes), about 280 MB, cut to trains likewise
#                     sk  ŽSR's GTFS on data.slovensko.sk (CC BY), for the
#                         timetable year
#                     ee  Elron's GTFS from the public transport register
#                         (Ministry of Regional Affairs and Agriculture)
#                     ch  opentransportdata.swiss's GTFS for the timetable
#                         year (about 300 MB, no key), cut to trains
#                     se  Trafiklab's GTFS Sweden 3 (CC0), cut to trains;
#                         needs SE_TRAFIKLAB_STATIC_KEY
#                     pl  PKP PLK's schedules as GTFS (tools/plk-gtfs.py);
#                         needs PL_PLK_API_KEY
#                     at  Mobilitätsverbünde Österreich's rail GTFS
#                         (dataset 66, "Fahrplandaten Eisenbahn (GTFS) -
#                         aktuell"); needs AT_MVO_USERNAME, AT_MVO_PASSWORD
#                     cz  CIS JŘ's national timetable (Ministry of Transport),
#                         NeTEx and CZPTT cancellations, as GTFS by
#                         tools/cisjr-gtfs.py, stations placed from
#                         OpenStreetMap (so cz needs the OSM extract); its
#                         downloads are kept in gtfs/cz/cisjr/ (CI caches it)
#                     dk  Rejseplanen's NeTEx (Dataudveksleren dataset 242),
#                         trains as GTFS by tools/netex-gtfs.py; needs
#                         DK_NAP_CLIENT_SECRET (the service account)
#                     it  Italy: Trenitalia's and Italo's NeTEx from the national access
#                         point (CCISS, no key; tools/netex-gtfs.py) as
#                         gtfs.zip, and Trenord's GTFS (dati.lombardia.it,
#                         CC BY 4.0, cut to trains) as trenord.zip when its
#                         portal serves it
#                     hu  MÁV Group's GTFS (MÁV-START, GYSEV and the
#                         Children's Railway; daily), given on registration;
#                         needs HU_MAV_USERNAME, HU_MAV_PASSWORD
#                     de  DELFI's national GTFS (opendata-oepnv.de, CC BY 4.0,
#                         weekly), cut to trains; needs DE_DELFI_USERNAME,
#                         DE_DELFI_PASSWORD (tools/delfi-fetch.py logs in)
#                     be  SNCB's GTFS through the Belgian Mobility Company's
#                         gateway, cut to trains; needs BE_SNCB_KEY (sent in
#                         the Ocp-Apim-Subscription-Key header only)
#                     au-nsw  Transport for NSW's GTFS: Sydney Trains, NSW
#                         TrainLink and Sydney Metro, merged and cut to
#                         trains; needs AU_NSW_API_KEY ("apikey" header)
#                     au-vic  Transport Victoria's GTFS Schedule: V/Line and
#                         Metro Trains (tools/au/vic-fetch.py), merged
#                     nz-wlg  Metlink's GTFS (Wellington), cut to trains; no
#                         key for the timetable
#                     nz-akl  Auckland Transport's GTFS, cut to trains; no key
#                         for the timetable
#                     nz-osm  only New Zealand's OSM track (for both regions)
#                     sg  Singapore's MRT and LRT: an estimated timetable from
#                         OpenStreetMap's routes and tools/sg/lines.tsv
#                         (tools/sg/osm-gtfs.py); LTA publishes none. The
#                         track is in it: use --no-osm
#                     pt-lis  Lisbon: Fertagus (CC BY 4.0) and Lisbon Metro
#                         (dados.gov.pt, CC BY), ids prefixed and merged; no key
#                     pt  CP's national timetable: built only with PT_CP=1
#                         (CP hasn't licensed reuse yet: docs/europe/pt.md)
#                     jp-tyo  Tokyo: Toei's subway, Toden Arakawa tram and
#                         Nippori-Toneri Liner (ODPT, CC BY 4.0), English and
#                         Japanese names; no key. The track is the stations'
#                         straight lines: use --no-osm
#                     jp-kch  Kōchi: Tosaden's trams (ODPT, CC BY 4.0); its
#                         own shapes: use --no-osm
#                     jp-aom|jp-ygt|jp-tym|jp-gif|jp-mie|jp-tks|jp-kmm
#                         Japan's regional railways and trams from the GTFS
#                         Data Repository (gtfs-data.jp, no key; CC BY 4.0,
#                         CC BY 2.1 JP or CC0, each feed its own): Aomori,
#                         Yamagata, Toyama, Gifu, Mie, Tokushima, Kumamoto
#                         (docs/world/jp.md); use --no-osm
#   sources.tsv       name, url, etag, last-modified (for the manifest)
#   rail.geojsonseq   the country's OpenStreetMap track (needs osmium-tool;
#                     skipped with --no-osm)
# Clients name themselves in a header: a generic name. Keys (Sweden,
# Poland) come from the environment and are never printed or written: the
# URLs in sources.tsv (which the manifest publishes) are without them.
set -euo pipefail
cd "$(dirname "$0")/.."
cc="${1:-}"
osm=1
[ "${2:-}" = "--no-osm" ] && osm=0
dir="gtfs/$cc"
mkdir -p "$dir"
client="Metranos-TrainRadar"
: >"$dir/sources.tsv"

get() { # name url out [header]
  local headers
  headers=$(mktemp)
  curl -fsSL --retry 4 --retry-delay 15 --retry-all-errors --compressed -D "$headers" ${4:+-H "$4"} \
    -A "$client (+https://mytrainradar.com)" -o "$3.part" "$2"
  mv "$3.part" "$3"
  local etag modified
  etag=$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)
  modified=$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)
  rm -f "$headers"
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$etag" "$modified" >>"$dir/sources.tsv"
  echo "$(basename "$3"): $(du -h "$3" | cut -f1), last modified ${modified:-unknown}"
}

getkey() { # name url-without-key out key — the key in the URL only for curl,
  # through its config on stdin (not the command line, not sources.tsv).
  local headers
  headers=$(mktemp)
  printf 'url = "%s?key=%s"\n' "$2" "$4" | curl -fsSL --retry "${retries:-4}" --retry-delay 15 --compressed -D "$headers" \
    -A "$client (+https://mytrainradar.com)" -o "$3.part" -K - || { rm -f "$3.part" "$headers"; return 1; }
  mv "$3.part" "$3"
  local modified
  modified=$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)
  rm -f "$headers"
  printf '%s\t%s\t\t%s\n' "$1" "$2" "$modified" >>"$dir/sources.tsv"
  echo "$(basename "$3"): $(du -h "$3" | cut -f1), last modified ${modified:-unknown}"
}

case "$cc" in
  fi)
    get "Fintraffic (digitraffic.fi)" https://rata.digitraffic.fi/api/v1/trains/gtfs-passenger.zip \
      "$dir/all.zip" "Digitraffic-User: $client"
    # Its stops are platforms (HKI_0…HKI_19): merged into their station.
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=finland ;;
  no)
    base=https://storage.googleapis.com/marduk-production/outbound/gtfs
    parts=()
    for op in vyg goa sjn flt; do
      get "Entur ($op)" "$base/rb_${op}-aggregated-gtfs.zip" "$dir/$op.zip"
      parts+=("$dir/$op.zip")
    done
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "${parts[@]}" --parents
    rm -f "${parts[@]}"
    region=norway ;;
  nl)
    get "OVapi (NDOV)" https://gtfs.ovapi.nl/nl/gtfs-nl.zip "$dir/all.zip"
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=netherlands ;;
  sk)
    # The national catalogue's download address for ŽSR's dataset
    # ("Grafikon vlakovej dopravy vo formáte GTFS").
    get "ŽSR (data.slovensko.sk)" "https://data.slovensko.sk/download?id=556da5af-9e8a-4674-95f8-d0005299fe90" "$dir/gtfs.zip"
    region=slovakia ;;
  ee)
    get "Elron (public transport register)" https://eu-gtfs.remix.com/elron.zip "$dir/gtfs.zip"
    region=estonia ;;
  ch)
    # One GTFS per timetable year (mid-December to mid-December): from
    # 6 December, next year's, so the week ahead is in it.
    year=$(date -u +%Y)
    [ "$(date -u +%m%d)" -ge 1206 ] && year=$((year + 1))
    get "opentransportdata.swiss (timetable $year)" \
      "https://data.opentransportdata.swiss/dataset/timetable-$year-gtfs2020/permalink" "$dir/all.zip"
    # Its stops are platforms (8503000:0:3): merged into their station.
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=switzerland ;;
  se)
    [ -n "${SE_TRAFIKLAB_STATIC_KEY:-}" ] || { echo "SE_TRAFIKLAB_STATIC_KEY is not set" >&2; exit 2; }
    # The key allows 50 downloads a month: the workflows keep sweden.zip in
    # their cache, one download a day at most (SE_GTFS_REUSE=1: a copy from
    # the cache is used as it is). No retries: a refusal (HTTP 429, the
    # month's quota) won't pass in 15 s, and each try counts.
    if [ "${SE_GTFS_REUSE:-}" = 1 ] && [ -s "$dir/sweden.zip" ]; then
      echo "sweden.zip: from the cache, $(du -h "$dir/sweden.zip" | cut -f1)"
      printf '%s\t%s\t\t%s\n' "Samtrafiken (Trafiklab, GTFS Sweden 3)" https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip \
        "$(date -u -r "$dir/sweden.zip" '+%a, %d %b %Y %H:%M:%S GMT')" >>"$dir/sources.tsv"
    elif ! retries=0 getkey "Samtrafiken (Trafiklab, GTFS Sweden 3)" https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip \
      "$dir/sweden.zip" "$SE_TRAFIKLAB_STATIC_KEY"; then
      [ -s "$dir/sweden.zip" ] || { echo "GTFS Sweden 3: download failed and no earlier copy" >&2; exit 1; }
      echo "::warning::GTFS Sweden 3: download failed; using the earlier copy from the cache"
      printf '%s\t%s\t\t%s\n' "Samtrafiken (Trafiklab, GTFS Sweden 3)" https://opendata.samtrafiken.se/gtfs-sweden/sweden.zip \
        "$(date -u -r "$dir/sweden.zip" '+%a, %d %b %Y %H:%M:%S GMT')" >>"$dir/sources.tsv"
    fi
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/sweden.zip" --parents
    region=sweden ;;
  pl)
    [ -n "${PL_PLK_API_KEY:-}" ] || { echo "PL_PLK_API_KEY is not set" >&2; exit 2; }
    python3 -I tools/plk-gtfs.py "$dir/gtfs.zip"
    printf '%s\t%s\t\t%s\n' "PKP PLK (Otwarte Dane Kolejowe)" https://pdp-api.plk-sa.pl/api/v1/schedules \
      "$(date -u '+%a, %d %b %Y %H:%M:%S GMT')" >>"$dir/sources.tsv"
    region=poland ;;
  at)
    [ -n "${AT_MVO_USERNAME:-}" ] && [ -n "${AT_MVO_PASSWORD:-}" ] || { echo "AT_MVO_USERNAME and AT_MVO_PASSWORD are not set" >&2; exit 2; }
    # Log in to the portal (its Keycloak, as the website does), then
    # download with the short-lived token. The password goes only in the
    # login request's body; neither it nor the token is printed or
    # written anywhere, nor put on a command line.
    token=$(python3 -I -c '
import json, os, sys, urllib.parse, urllib.request
body = urllib.parse.urlencode({"client_id": "dbp-public-ui", "grant_type": "password", "scope": "openid",
    "username": os.environ["AT_MVO_USERNAME"], "password": os.environ["AT_MVO_PASSWORD"]}).encode()
req = urllib.request.Request("https://user.mobilitaetsverbuende.at/auth/realms/dbp-public/protocol/openid-connect/token",
    data=body, headers={"User-Agent": "Metranos-TrainRadar"})
try:
    print(json.load(urllib.request.urlopen(req, timeout=60))["access_token"])
except Exception as e:
    sys.exit("Mobilitätsverbünde login failed: " + str(getattr(e, "code", "")) + " " + type(e).__name__)
')
    api=https://data.mobilitaetsverbuende.at/api/public/v1/data-sets/66
    # The file is per timetable year; from mid-December, next year's.
    year=$(date -u +%Y)
    got=""
    for y in "$year" $((year + 1)) $((year - 1)); do
      if printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -fsSL --retry 3 --retry-delay 15 \
          -A "$client (+https://mytrainradar.com)" -o "$dir/download.zip" -K - "$api/$y/file"; then
        got=$y; break
      fi
    done
    unset token
    [ -n "$got" ] || { echo "Mobilitätsverbünde: no file for $year or around it" >&2; exit 1; }
    printf '%s\t%s\t\t%s\n' "Mobilitätsverbünde Österreich OG (data.mobilitaetsverbuende.at)" "$api/$got/file" \
      "$(date -u '+%a, %d %b %Y %H:%M:%S GMT')" >>"$dir/sources.tsv"
    echo "download.zip: $(du -h "$dir/download.zip" | cut -f1), timetable year $got"
    # The GTFS itself, or a zip holding it.
    if unzip -l "$dir/download.zip" | grep -q ' stops.txt$'; then
      mv "$dir/download.zip" "$dir/all.zip"
    else
      inner=$(unzip -Z1 "$dir/download.zip" | grep -i '\.zip$' | head -1)
      [ -n "$inner" ] || { echo "Mobilitätsverbünde: no GTFS in the download" >&2; unzip -l "$dir/download.zip" >&2; exit 1; }
      unzip -p "$dir/download.zip" "$inner" >"$dir/all.zip"
      rm -f "$dir/download.zip"
    fi
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=austria ;;
  cz)
    # CIS JŘ has no coordinates: stations come from OpenStreetMap, so the
    # extract is needed here (the track below reuses it).
    # (A weekly copy, cached by CI with rail.geojsonseq, is used as is.)
    region=czech-republic
    if [ ! -s "$dir/stations.geojsonseq" ]; then
      out="$dir/$region.osm.pbf"
      curl -fsSL --retry 6 --retry-delay 20 --retry-all-errors --speed-limit 100000 --speed-time 60 -o "$out" \
        "https://download.geofabrik.de/europe/$region-latest.osm.pbf" ||
        { echo "OSM: the Czech extract failed: no station positions, no timetable" >&2; exit 1; }
      osmium tags-filter --overwrite -o "$dir/stations.osm.pbf" "$out" n/railway=station,halt n/public_transport=station
      osmium export --overwrite -f geojsonseq --geometry-types=point -o "$dir/stations.geojsonseq" "$dir/stations.osm.pbf"
      rm -f "$dir/stations.osm.pbf"
    fi
    echo "stations.geojsonseq: $(wc -l <"$dir/stations.geojsonseq") OSM stations and halts"
    python3 -I tools/cisjr-gtfs.py "$dir/gtfs.zip" "$dir/stations.geojsonseq" --cache "$dir/cisjr" --sources "$dir/sources.tsv" 63 ;;
  it)
    # The national access point (CCISS): "OAP Trenitalia - NeTEx Livello 1",
    # asset 1080596, one .xml.gz updated about monthly ("No licence - No
    # contract"; the Ministry confirmed no agreement is needed).
    get "Trenitalia (Punto di Accesso Nazionale, CCISS)" \
      "https://www.cciss.it/nap/mmtis/public/api/v1/download/blob/Asset/1080596/resource" "$dir/trenitalia.xml.gz"
    # Italo, from the same access point ("OAP Italo - NeTEx Livello 1",
    # asset 1814124, same terms), joined to Trenitalia's stations.
    get "Italo (Punto di Accesso Nazionale, CCISS)" \
      "https://www.cciss.it/nap/mmtis/public/api/v1/download/blob/Asset/1814124/resource" "$dir/italo.xml.gz"
    python3 -I tools/netex-gtfs.py "$dir/gtfs.zip" "$dir/trenitalia.xml.gz" 63 --profile it --add "$dir/italo.xml.gz:italo"
    rm -f "$dir/trenitalia.xml.gz" "$dir/italo.xml.gz"
    # Lombardy: Regione Lombardia's "Orario Ferroviario Regionale Gtfs"
    # (Trenord and Malpensa Express, CC BY 4.0), with its replacement buses
    # cut out. Its portal's download is sometimes broken: Italy is built
    # without Lombardy's Trenord trains then.
    rm -f "$dir/all.zip"
    if get "Trenord (dati.lombardia.it)" "https://www.dati.lombardia.it/download/3z4k-mxz9/application%2Fzip" "$dir/all.zip" && [ -s "$dir/all.zip" ]; then
      python3 -I tools/gtfs-rail.py "$dir/trenord.zip" "$dir/all.zip"
    else
      echo "::warning::Trenord's GTFS couldn't be downloaded: Italy without Lombardy's Trenord trains." >&2
    fi
    rm -f "$dir/all.zip"
    region=italy ;;
  dk)
    [ -n "${DK_NAP_CLIENT_SECRET:-}" ] || { echo "DK_NAP_CLIENT_SECRET is not set" >&2; exit 2; }
    # Log in as the service account (Entra ID client credentials; scope =
    # its own id), then download with the short-lived token. The secret goes
    # only in the login request's body; neither it nor the token is printed,
    # written or put on a command line.
    token=$(python3 -I -c '
import json, os, sys, urllib.parse, urllib.request
tenant = os.environ.get("DK_NAP_TENANT_ID") or "f1044067-8c60-4022-98d8-69306c5f7238"
client = os.environ.get("DK_NAP_CLIENT_ID") or "a63b12fe-eeae-489c-b1ca-be8a135289f5"
body = urllib.parse.urlencode({"client_id": client, "client_secret": os.environ["DK_NAP_CLIENT_SECRET"],
    "scope": client + "/.default", "grant_type": "client_credentials"}).encode()
req = urllib.request.Request("https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token", data=body,
    headers={"User-Agent": "Metranos-TrainRadar"})
try:
    print(json.load(urllib.request.urlopen(req, timeout=60))["access_token"])
except Exception as e:
    sys.exit("Dataudveksleren login refused: " + str(getattr(e, "code", "")) + " " + type(e).__name__ + " (a lost secret needs a new service account)")
')
    url=https://distribution.dataudveksler.app.vd.dk/api/dataset/242/latest/Zip
    printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -fsSL --retry 3 --retry-delay 15 \
      -A "$client (+https://mytrainradar.com)" -o "$dir/netex.zip" -K - "$url"
    unset token
    printf '%s\t%s\t\t%s\n' "Rejsekort & Rejseplan A/S, NeTEx (Dataudveksleren dataset 242)" "$url" \
      "$(date -u '+%a, %d %b %Y %H:%M:%S GMT')" >>"$dir/sources.tsv"
    echo "netex.zip: $(du -h "$dir/netex.zip" | cut -f1)"
    python3 -I tools/netex-gtfs.py "$dir/gtfs.zip" "$dir/netex.zip" 63 --profile dk
    rm -f "$dir/netex.zip"
    region=denmark ;;
  hu)
    [ -n "${HU_MAV_USERNAME:-}" ] && [ -n "${HU_MAV_PASSWORD:-}" ] || { echo "HU_MAV_USERNAME and HU_MAV_PASSWORD are not set" >&2; exit 2; }
    # HTTP basic authentication. The login goes to curl on its standard
    # input (a config line), never on a command line, in a URL or a file.
    url=https://www.mavcsoport.hu/gtfs/gtfsMavMenetrend.zip
    headers=$(mktemp)
    python3 -I -c 'import json, os; print("user = " + json.dumps(os.environ["HU_MAV_USERNAME"] + ":" + os.environ["HU_MAV_PASSWORD"]))' |
      curl -fsSL --retry 4 --retry-delay 15 -D "$headers" -A "$client (+https://mytrainradar.com)" \
        -o "$dir/gtfs.zip.part" -K - "$url" ||
      { echo "MÁV GTFS: download refused or failed (HTTP 401 = the login is wrong)" >&2; rm -f "$headers"; exit 1; }
    mv "$dir/gtfs.zip.part" "$dir/gtfs.zip"
    printf '%s\t%s\t%s\t%s\n' "MÁV Group GTFS (mavcsoport.hu)" "$url" \
      "$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)" \
      "$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)" >>"$dir/sources.tsv"
    rm -f "$headers"
    echo "gtfs.zip: $(du -h "$dir/gtfs.zip" | cut -f1)"
    region=hungary ;;
  de)
    python3 -I tools/delfi-fetch.py "$dir/all.zip" "$dir/sources.tsv"
    echo "all.zip: $(du -h "$dir/all.zip" | cut -f1)"
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    echo "gtfs.zip (trains): $(du -h "$dir/gtfs.zip" | cut -f1)"
    region=germany ;;
  be)
    [ -n "${BE_SNCB_KEY:-}" ] || { echo "BE_SNCB_KEY is not set" >&2; exit 2; }
    url=https://api-management-opendata-production.azure-api.net/api/gtfs/feed/nmbssncb/static
    headers=$(mktemp)
    # The key in a header, through curl's config on stdin.
    printf 'header = "Ocp-Apim-Subscription-Key: %s"\n' "$BE_SNCB_KEY" |
      curl -fsSL --retry 4 --retry-delay 15 -D "$headers" -A "$client (+https://mytrainradar.com)" \
        -o "$dir/all.zip" -K - "$url" ||
      { echo "SNCB GTFS: download refused or failed (HTTP 401 = the key)" >&2; rm -f "$headers"; exit 1; }
    printf '%s\t%s\t%s\t%s\n' "SNCB/NMBS GTFS (Belgian Mobility Company)" "$url" \
      "$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)" \
      "$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)" >>"$dir/sources.tsv"
    rm -f "$headers"
    echo "all.zip: $(du -h "$dir/all.zip" | cut -f1) ($(head -c 2 "$dir/all.zip" | od -An -c | tr -d ' '))"
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=belgium ;;
  au-nsw)
    [ -n "${AU_NSW_API_KEY:-}" ] || { echo "AU_NSW_API_KEY is not set" >&2; exit 2; }
    # Each operator's schedule, v2 where it exists, else v1; the key in a
    # header through curl's config on stdin.
    parts=()
    for op in sydneytrains nswtrains metro; do
      got=""
      for v in v2 v1; do
        url="https://api.transport.nsw.gov.au/$v/gtfs/schedule/$op"
        if printf 'header = "Authorization: apikey %s"\n' "$AU_NSW_API_KEY" |
            curl -fsSL --retry 3 --retry-delay 15 -A "$client (+https://mytrainradar.com)" \
              -o "$dir/$op.zip" -K - "$url" && [ "$(head -c 2 "$dir/$op.zip")" = "PK" ]; then
          got=$v; break
        fi
      done
      if [ -z "$got" ]; then echo "TfNSW $op: no schedule (v2 or v1)" >&2; rm -f "$dir/$op.zip"; continue; fi
      echo "$op.zip ($got): $(du -h "$dir/$op.zip" | cut -f1)"
      printf '%s\t%s\t\t%s\n' "Transport for NSW, $op GTFS ($got)" "https://api.transport.nsw.gov.au/$got/gtfs/schedule/$op" \
        "$(date -u '+%a, %d %b %Y %H:%M:%S GMT')" >>"$dir/sources.tsv"
      parts+=("$dir/$op.zip")
    done
    [ ${#parts[@]} -gt 0 ] || { echo "TfNSW: no schedule downloaded (the key?)" >&2; exit 1; }
    # Sydney Metro is a metro (route type 401 or 1) in its own file: kept.
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "${parts[@]}" --parents --also=401,1
    rm -f "${parts[@]}"
    region=australia-oceania/australia ;;
  au-osm)
    # Only the OSM track for Australia (shared by its states' builds).
    region=australia-oceania/australia ;;
  au-vic)
    python3 -I tools/au/vic-fetch.py "$dir" "$dir/sources.tsv"
    parts=()
    for op in vline metro; do [ -s "$dir/$op.zip" ] && parts+=("$dir/$op.zip"); done
    # Metro Trains' routes aren't route type 2 (Nov 2026: none kept): its
    # file is trains only, so the metro types are kept too.
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "${parts[@]}" --parents --also=400,401,1
    rm -f "${parts[@]}"
    region=australia-oceania/australia ;;
  nz-wlg)
    url=https://static.opendata.metlink.org.nz/v1/gtfs/full.zip
    headers=$(mktemp)
    curl -fsSL --retry 4 --retry-delay 15 -D "$headers" -A "$client (+https://mytrainradar.com)" \
      -o "$dir/all.zip" "$url" || { echo "Metlink GTFS: download failed" >&2; rm -f "$headers"; exit 1; }
    printf '%s\t%s\t%s\t%s\n' "Metlink GTFS (Greater Wellington Regional Council)" "$url" \
      "$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)" \
      "$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)" >>"$dir/sources.tsv"
    rm -f "$headers"
    echo "all.zip: $(du -h "$dir/all.zip" | cut -f1)"
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=australia-oceania/new-zealand ;;
  nz-akl)
    url=https://gtfs.at.govt.nz/gtfs.zip
    headers=$(mktemp)
    curl -fsSL --retry 4 --retry-delay 15 -D "$headers" -A "$client (+https://mytrainradar.com)" \
      -o "$dir/all.zip" "$url" || { echo "Auckland Transport GTFS: download failed" >&2; rm -f "$headers"; exit 1; }
    printf '%s\t%s\t%s\t%s\n' "Auckland Transport GTFS" "$url" \
      "$(grep -i '^etag:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r"' || true)" \
      "$(grep -i '^last-modified:' "$headers" | tail -1 | cut -d' ' -f2- | tr -d '\r' || true)" >>"$dir/sources.tsv"
    rm -f "$headers"
    echo "all.zip: $(du -h "$dir/all.zip" | cut -f1)"
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/all.zip" --parents
    rm -f "$dir/all.zip"
    region=australia-oceania/new-zealand ;;
  sg)
    # Geofabrik's Malaysia, Singapore and Brunei; Singapore's box; the
    # MRT/LRT route relations with their stops and track, as OPL.
    pbf="$dir/msb.osm.pbf"
    curl -fsSL --retry 6 --retry-delay 20 --retry-all-errors -A "$client (+https://mytrainradar.com)" -o "$pbf" \
      https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf
    printf '%s\t%s\t\t%s\n' "OpenStreetMap (Geofabrik), MRT and LRT routes" \
      https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf "$(date -u '+%a, %d %b %Y %H:%M:%S GMT')" >>"$dir/sources.tsv"
    osmium extract --overwrite -b 103.55,1.13,104.15,1.50 --strategy=smart -o "$dir/sg.osm.pbf" "$pbf"
    osmium tags-filter --overwrite -o "$dir/routes.osm.pbf" "$dir/sg.osm.pbf" r/route=subway,light_rail,monorail,train
    osmium cat --overwrite -f opl -o "$dir/routes.opl" "$dir/routes.osm.pbf"
    rm -f "$pbf" "$dir/sg.osm.pbf" "$dir/routes.osm.pbf"
    python3 -I tools/sg/osm-gtfs.py "$dir/routes.opl" tools/sg/lines.tsv "$dir/gtfs.zip" 70
    rm -f "$dir/routes.opl"
    region=asia/malaysia-singapore-brunei ;;
  pt-lis)
    # Fertagus (Lisbon-Setúbal across the 25 de Abril bridge) and Lisbon
    # Metro, ids prefixed so they don't clash, merged; the metro kept (type 1).
    get "Fertagus GTFS (CC BY 4.0)" https://www.fertagus.pt/GTFSTMLzip/Fertagus_GTFS.zip "$dir/fertagus.zip"
    # Lisbon Metro's file has a new address with each version: the newest
    # zip of its dados.gov.pt dataset.
    ml=$(curl -fsSL --retry 4 --retry-delay 15 -A "$client (+https://mytrainradar.com)" \
        https://dados.gov.pt/api/1/datasets/gtfs-do-metropolitano-de-lisboa/ |
      python3 -I -c "import json,sys; d=json.load(sys.stdin); r=sorted((x for x in d['resources'] if x['url'].endswith('.zip')), key=lambda x: x.get('last_modified') or '', reverse=True); print(r[0]['url'] if r else '')")
    [ -n "$ml" ] || { echo "Lisbon Metro: no GTFS in its dataset" >&2; exit 1; }
    get "Metropolitano de Lisboa GTFS (dados.gov.pt, CC BY)" "$ml" "$dir/ml.zip"
    python3 -I tools/gtfs-tidy.py "$dir/fertagus.zip" "$dir/ft.zip" --prefix=ft:
    python3 -I tools/gtfs-tidy.py "$dir/ml.zip" "$dir/mlx.zip" --prefix=ml:
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/ft.zip" "$dir/mlx.zip" --parents --also=1
    rm -f "$dir/fertagus.zip" "$dir/ml.zip" "$dir/ft.zip" "$dir/mlx.zip"
    region=portugal ;;
  pt)
    # CP's timetable, published for anyone at publico.cp.pt but with no
    # licence stated (CP's reply to our letter is pending): built with PT_CP=1,
    # which the deploy sets unless PT_CP_ENABLED is "false" (docs/europe/pt.md).
    [ "${PT_CP:-}" = "1" ] || { echo "CP: not built (PT_CP is not 1: PT_CP_ENABLED is false, docs/europe/pt.md)" >&2; exit 3; }
    get "CP – Comboios de Portugal GTFS" https://publico.cp.pt/gtfs/gtfs.zip "$dir/cp.zip"
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/cp.zip"
    rm -f "$dir/cp.zip"
    region=portugal ;;
  jp-tyo)
    # Toei (Tokyo Metropolitan Bureau of Transportation): four subway lines,
    # the Toden Arakawa tram (type 0) and the Nippori-Toneri Liner, CC BY 4.0
    # on ODPT's public API (no key). Trip ids kept: Toei's GTFS-Realtime
    # names trips by them. Stations "Shinjuku 新宿" (its translations.txt).
    get "Toei Train GTFS (ODPT, CC BY 4.0)" https://api-public.odpt.org/api/v4/files/Toei/data/Toei-Train-GTFS.zip "$dir/toei.zip"
    python3 -I tools/gtfs-tidy.py "$dir/toei.zip" "$dir/toei-en.zip" --keep-trips --lang=en --bilingual \
      --short=1:A,2:I,3:S,4:E,5:NT,6:SA
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/toei-en.zip" --also=0,1
    rm -f "$dir/toei.zip" "$dir/toei-en.zip"
    region=asia/japan ;;
  jp-kch)
    # Tosaden Traffic (Kōchi): its tram network, CC BY 4.0 on ODPT's public
    # API; the current timetable ("?date=current"). Stops have kana readings
    # only (romaji from them) and one platform per direction (merged).
    get "Tosaden Traffic streetcar GTFS (ODPT, CC BY 4.0)" \
      "https://api-public.odpt.org/api/v4/files/odpt/TosadenTraffic/Streetcar.zip?date=current" "$dir/tosaden.zip"
    python3 -I tools/gtfs-tidy.py "$dir/tosaden.zip" "$dir/tosaden-en.zip" --lang=en --bilingual --merge-platforms \
      --short=東西線上り_A:East-West,東西線下り_A:East-West,南北線上り_A:North-South,南北線下り_A:North-South
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "$dir/tosaden-en.zip" --also=0
    rm -f "$dir/tosaden.zip" "$dir/tosaden-en.zip"
    region=asia/japan ;;
  jp-aom|jp-ygt|jp-tym|jp-gif|jp-mie|jp-tks|jp-kmm)
    # Japan's regional railways and trams, from the GTFS Data Repository
    # (gtfs-data.jp: operators' own GTFS-JP files, no key). Only feeds under
    # CC BY 4.0, CC BY 2.1 JP or CC0; each one's licence is in its label (the
    # credits). Names "Hirosaki 弘前" from each feed's translations (English,
    # else romaji from the kana reading). Toyama's tram and Asa's DMV are
    # filed as buses (3): set to tram (0) and rail (2).
    jpfeed() { # label org feed out [gtfs-tidy options]
      local label=$1 org=$2 feed=$3 out=$4
      shift 4
      get "$label" "https://api.gtfs-data.jp/v2/organizations/$org/feeds/$feed/files/feed.zip?rid=current" "$dir/raw.zip"
      python3 -I tools/gtfs-tidy.py "$dir/raw.zip" "$out" --lang=en --bilingual "$@"
      rm -f "$dir/raw.zip"
    }
    parts=("$dir/a.zip")
    case "$cc" in
      jp-aom) jpfeed "Kōnan Railway GTFS (Hirosaki City, gtfs-data.jp, CC BY 4.0)" hirosakicity kounan-tetsudou "$dir/a.zip" ;;
      jp-ygt) jpfeed "Yamagata Railway GTFS (gtfs-data.jp, CC BY 4.0)" yamagatatetsudo flowerliner "$dir/a.zip" ;;
      jp-tym) jpfeed "Toyama Chihō Railway city tram GTFS (gtfs-data.jp, CC0 1.0)" chitetsu chitetsushinaidensha "$dir/a.zip" \
                --route-type=0 --merge-platforms ;;
      jp-gif) jpfeed "Akechi Railway GTFS (gtfs-data.jp, CC BY 4.0)" aketetsu akechirailway "$dir/a.zip" ;;
      jp-mie) jpfeed "Ise Railway GTFS (gtfs-data.jp, CC BY 4.0)" isetetu iserailway "$dir/a.zip" ;;
      jp-tks) jpfeed "Asa Seaside Railway GTFS (gtfs-data.jp, CC BY 4.0)" asatetu asakaigantetsudo "$dir/a.zip" --route-type=2 ;;
      jp-kmm)
        # The city tram and Kumamoto Electric Railway, ids prefixed, merged.
        jpfeed "Kumamoto City Transportation Bureau tram GTFS (gtfs-data.jp, CC BY 2.1 JP)" kumamoto-shiden kumamotoshiden \
          "$dir/a.zip" --prefix=ks: --merge-platforms
        jpfeed "Kumamoto Electric Railway GTFS (gtfs-data.jp, CC0 1.0)" kumamotodentetsu kumamotodentetsu "$dir/b.zip" --prefix=kd:
        parts+=("$dir/b.zip") ;;
    esac
    python3 -I tools/gtfs-rail.py "$dir/gtfs.zip" "${parts[@]}" --parents --also=0
    rm -f "${parts[@]}"
    region=asia/japan ;;
  nz-osm)
    # Only the OSM track for New Zealand (shared by its regions' builds).
    region=australia-oceania/new-zealand ;;
  *) echo "usage: $0 fi|no|nl|sk|ee|ch|se|pl|at|cz|it|dk|hu|de|be|au-nsw|au-vic|au-osm|nz-wlg|nz-akl|nz-osm|sg|pt|pt-lis|jp-tyo|jp-kch|jp-aom|jp-ygt|jp-tym|jp-gif|jp-mie|jp-tks|jp-kmm [--no-osm]" >&2; exit 2 ;;
esac

if [ "$osm" = 1 ] && [ ! -s "$dir/rail.geojsonseq" ]; then
  start=$SECONDS
  # A Geofabrik region in Europe ("germany"), or its full path elsewhere
  # ("australia-oceania/australia").
  case "$region" in */*) path=$region ;; *) path=europe/$region ;; esac
  out="$dir/$(basename "$region").osm.pbf"
  mkdir -p "$(dirname "$out")"
  url="https://download.geofabrik.de/$path-latest.osm.pbf"
  [ -s "$out" ] || curl -fsSL --retry 6 --retry-delay 20 --retry-all-errors --speed-limit 100000 --speed-time 60 -o "$out" "$url" ||
    { echo "::warning::OSM: $url failed: built without the track this time (straight lines)." >&2; rm -f "$out"; exit 0; }
  osmium tags-filter --overwrite -o "$dir/rail.osm.pbf" "$out" w/railway=rail,narrow_gauge,disused
  rm "$out"
  osmium export --overwrite -f geojsonseq --geometry-types=linestring \
    -o "$dir/rail.geojsonseq.part" "$dir/rail.osm.pbf"
  mv "$dir/rail.geojsonseq.part" "$dir/rail.geojsonseq"
  echo "rail.geojsonseq: $(wc -l <"$dir/rail.geojsonseq") ways, in $((SECONDS - start)) s"
fi
rm -f "$dir/$(basename "$region").osm.pbf"
