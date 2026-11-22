import json, re, csv, sqlite3, sys, os, unicodedata, collections, datetime
sys.path.insert(0, os.path.dirname(__file__))
from classify import CLASS
from overrides import CHAPTER_MAP, UPPER_IS_STATION, UPPER_IS_WAYPOINT, SEQ, ANCHORS

W = sys.argv[1]; OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

meta = {}
for l in open(f'{W}/yt_meta.tsv', encoding='utf-8'):
    vid, s, ch, t = l.rstrip('\n').split('\t')
    meta[vid] = dict(duration_s=int(s), channel=ch, title=t)

chap = {}
for f in ['yt_chapters_1.txt', 'yt_chapters_2.txt']:
    cur = None
    for l in open(f'{W}/{f}', encoding='utf-8'):
        l = l.rstrip('\n')
        if l.startswith('#'): cur = l[1:].strip(); chap[cur] = []
        elif l.strip():
            s, name = l.split(' ', 1); chap[cur].append((int(s), name.strip()))

gem = json.load(open(f'{W}/gem_seq.json', encoding='utf-8'))
parsed = json.load(open(f'{W}/parsed.json', encoding='utf-8'))
gem_ctx = {v['id']: v['occ'][0] for v in parsed['videos']}

def key(name):
    n = unicodedata.normalize('NFKD', name.lower())
    n = ''.join(c for c in n if not unicodedata.combining(c))
    n = re.sub(r"^(estacion|estacio|apeadero) de ", '', n)
    n = re.sub(r"[^a-z0-9]+", ' ', n).strip()
    return ALIAS.get(n, n)

ALIAS = {
 'madrid chamartin clara campoamor': 'madrid chamartin', 'montserrat monestir': 'montserrat',
 'alacant terminal': 'alicante terminal', 'port bou': 'portbou', 'amara donostia': 'donostia amara',
 'zazpikaleak casco viejo': 'casco viejo', 'bilbao atxuri': 'atxuri', 'madrid atocha': 'madrid puerta de atocha',
 'atocha': 'madrid puerta de atocha', 'chamartin': 'madrid chamartin', 'madrid atocha cercanias': 'madrid atocha cercanias',
 'barcelona sants station': 'barcelona sants', 'granollers centre': 'granollers centre', 'pesues': 'pesues',
 'paseo de gracia': 'barcelona passeig de gracia', 'barcelona sant andreu': 'sant andreu comtal',
 'granada station': 'granada', 'elx av': 'elche av', 'hendaia hendaye': 'hendaia', 'ribes enllac': 'ribes de freser',
 'puerto de navacerrada': 'puerto de navacerrada', 'albacete': 'albacete los llanos', 'valencia': 'valencia nord',
}

SKIP = re.compile(r'^(preview|intro|presentaci|drive time|route preview)', re.I)
FEATURE = re.compile(r'\b(river|riu|bridge|tunel|túnel|highway|junction|gauge|class \d|emu|beach|workshops?|waiting|viaduct|viaducto|cargo|bay of|passing loop|bypass|motorway|line \(|high-speed line|from |to barcelona|turning|still under)\b', re.I)

def titlecase(n):
    if n.isupper():
        small = {'de','del','la','las','los','el','i','y','da','do','das','dos','sur','a'}
        w = n.lower().split(' ')
        cap = lambda x, i: x if (x in small and i) else x[:1].upper() + x[1:]
        return ' '.join('-'.join(cap(y, i + j) for j, y in enumerate(x.split('-'))) for i, x in enumerate(w)).replace('Sur-', 'sur-').replace('-Sur-', '-sur-')
    return n

def auto_chapters(vid):
    out = []
    for s, n in chap[vid]:
        if SKIP.match(n): continue
        typ = 'S'
        m = re.match(r'^(.+?) - (.+)$', n)
        if meta[vid]['channel'] == 'ItzAlfredoYT':
            if n.lower().startswith('estación de '): n = n[12:]
            elif m: n = m.group(1)
        if vid in UPPER_IS_STATION:
            typ = 'S' if n.isupper() else 'W'
        elif vid in UPPER_IS_WAYPOINT:
            typ = 'W' if n.isupper() else 'S'
        if FEATURE.search(n):
            typ = 'W'
        out.append((s, titlecase(n), typ))
    # drop duplicates of same station back-to-back
    ded = []
    for p in out:
        if ded and key(ded[-1][1]) == key(p[1]):
            if len(ded) == 1: ded[-1] = p
            continue
        ded.append(p)
    return ded

def clean_gem(name):
    name = re.sub(r'^(?:~?\d{1,2}:\d{2}(?::\d{2})?\s+|0+\s+)', '', name).strip(' .,)(—–-')
    name = re.sub(r'\s*\.\s*/.*$', '', name)
    return name

def direction_fix(names, c):
    if not names or not c['origin']: return names
    o, d = key(c['origin']), key(c['destination'])
    f, l = key(names[0][0]), key(names[-1][0])
    def near(a, b): return a and b and (a in b or b in a or a.split(' ')[0] == b.split(' ')[0])
    if near(f, d) and near(l, o) and not near(f, o): return names[::-1]
    return names

videos, stops = [], []
for vid, m in meta.items():
    c = CLASS[vid]
    pts, src = [], 'none'
    if c['scope'] != 'out' and c['coverage'] not in ('clip', 'compilation'):
        if vid in CHAPTER_MAP:
            pts = [(s, n, t) for s, n, t in CHAPTER_MAP[vid]]; src = 'youtube_chapters'
        elif vid in chap and vid not in ANCHORS:
            pts = auto_chapters(vid); src = 'youtube_chapters'
        elif vid in SEQ and SEQ[vid]:
            pts = [(None, x[2:], 'W') if x.startswith('W:') else (None, x, 'S') for x in SEQ[vid].split('|')]; src = 'curated_sequence'
        elif vid not in SEQ and len(gem.get(vid, [])) >= 2:
            names = [(clean_gem(n), 'S') for _, n in gem[vid] if clean_gem(n)]
            names = direction_fix(names, c)
            pts = [(None, n, t) for n, t in names]; src = 'gemini_sequence'
        if not pts and c['origin'] and c['destination'] and c['origin'] != c['destination']:
            pts = [(None, c['origin'], 'S'), (None, c['destination'], 'S')]; src = 'route_endpoints'
    # time quality
    times = [p[0] for p in pts if p[0] is not None]
    if src == 'youtube_chapters':
        rounded = len(times) >= 3 and sum(1 for t in times if t % 60 == 0) / len(times) > 0.6
        nst = sum(1 for p in pts if p[2] == 'S')
        tq = 'approximate' if rounded or nst < 3 else 'precise'
    elif vid in ANCHORS:
        tq = 'approximate'
    elif src in ('gemini_sequence', 'curated_sequence', 'route_endpoints'):
        tq = 'estimated'
    else:
        tq = 'none'
    # estimated times by even spacing for sequences (first stop ~ 0, last ~ end)
    dur = m['duration_s']
    est = []
    if src in ('gemini_sequence', 'curated_sequence', 'route_endpoints') and pts:
        n = len(pts)
        lead, tail = min(60, dur * 0.02), min(60, dur * 0.02)
        anc = {}
        for nm, t in ANCHORS.get(vid, {}).items():
            idx = [i for i, p in enumerate(pts) if key(p[1]) == key(nm)]
            if idx: anc[idx[0]] = t
        anc.setdefault(0, round(lead)); anc.setdefault(n - 1, round(dur - tail))
        ks = sorted(anc)
        for i in range(n):
            if i in anc: est.append(anc[i]); continue
            a = max(k for k in ks if k < i); b = min(k for k in ks if k > i)
            est.append(round(anc[a] + (anc[b] - anc[a]) * (i - a) / (b - a)))
        anchored = {i for i in anc if pts[i][1] in ANCHORS.get(vid, {})}
    for i, p in enumerate(pts):
        t = p[0]
        stops.append(dict(video_id=vid, seq=i + 1, name=p[1], station_key=key(p[1]),
                          point_type='station' if p[2] == 'S' else 'waypoint',
                          t_seconds=t if t is not None else est[i],
                          t_source='uploader_chapter' if (t is not None or (vid in ANCHORS and p[1] in ANCHORS[vid])) else 'even_spacing_estimate',
                          deep_link=f'https://www.youtube.com/watch?v={vid}&t={t if t is not None else est[i]}s'))
    g = gem_ctx.get(vid)
    videos.append(dict(
        video_id=vid, url=f'https://www.youtube.com/watch?v={vid}', title=m['title'], channel=m['channel'],
        duration_s=dur, category=c['category'], operator=c['operator'], line_or_route=c['route'],
        origin=c['origin'], destination=c['destination'], view_type=c['view'], coverage=c['coverage'],
        app_scope=c['scope'], timestamp_quality=tq, stops_source=src, n_stops=len(pts),
        notes=c['note'], research_section=(g['h2'] if g else 'listed only in a Sources list'),
        verified_on=datetime.date.today().isoformat()))

# stations table
st = collections.OrderedDict()
for s in stops:
    if s['point_type'] != 'station': continue
    k = s['station_key']
    e = st.setdefault(k, dict(station_key=k, names=collections.Counter(), videos=set(), categories=set()))
    e['names'][s['name']] += 1; e['videos'].add(s['video_id'])
cat = {v['video_id']: v for v in videos}
stations = []
for k, e in st.items():
    cats = sorted({cat[v]['category'] for v in e['videos']})
    scopes = {cat[v]['app_scope'] for v in e['videos']}
    stations.append(dict(station_key=k, display_name=e['names'].most_common(1)[0][0],
                         name_variants=' | '.join(sorted(e['names'])), n_videos=len(e['videos']),
                         categories=','.join(cats), app_scope='core' if 'core' in scopes else 'extended',
                         renfe_stop_id='', adif_code='', lat='', lon=''))
stations.sort(key=lambda x: (-x['n_videos'], x['station_key']))

# ---- write CSVs
def wcsv(name, rows):
    with open(f'{OUT}/{name}', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
wcsv('videos.csv', videos); wcsv('video_stops.csv', stops); wcsv('stations.csv', stations)

# ---- SQLite
dbp = f'{OUT}/cab_rides.db'
if os.path.exists(dbp): os.remove(dbp)
db = sqlite3.connect(dbp)
schema = open(os.path.join(os.path.dirname(__file__), 'schema.sql'), encoding='utf-8').read()
db.executescript(schema)
db.executemany('INSERT INTO videos VALUES (%s)' % ','.join('?' * len(videos[0])), [tuple(v.values()) for v in videos])
db.executemany('INSERT INTO video_stops (video_id,seq,name,station_key,point_type,t_seconds,t_source,deep_link) VALUES (?,?,?,?,?,?,?,?)',
               [(s['video_id'], s['seq'], s['name'], s['station_key'], s['point_type'], s['t_seconds'], s['t_source'], s['deep_link']) for s in stops])
db.executemany('INSERT INTO stations VALUES (%s)' % ','.join('?' * len(stations[0])), [tuple(s.values()) for s in stations])
db.commit(); db.close()

# ---- compact app bundle (core + extended rides with stops)
bundle = dict(version=1, generated=datetime.date.today().isoformat(),
              note='Spanish cab-ride videos for TrainRadar. t = seconds into the video. q = timestamp quality.',
              videos=[], stations={})
for v in videos:
    if v['app_scope'] == 'out' or not v['n_stops']: continue
    vs = [s for s in stops if s['video_id'] == v['video_id']]
    bundle['videos'].append(dict(id=v['video_id'], title=v['title'], ch=v['channel'], dur=v['duration_s'],
        cat=v['category'], op=v['operator'], route=v['line_or_route'], view=v['view_type'],
        cov=v['coverage'], scope=v['app_scope'], q=v['timestamp_quality'],
        stops=[[s['station_key'], s['name'], s['t_seconds'], 1 if s['point_type'] == 'station' else 0, 1 if s['t_source'] == 'uploader_chapter' else 0] for s in vs]))
for s in stations:
    bundle['stations'][s['station_key']] = s['display_name']
json.dump(bundle, open(f'{OUT}/cab_rides.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

print(len(videos), 'videos;', len(stops), 'stops;', len(stations), 'stations;', len(bundle['videos']), 'in bundle')
print(collections.Counter((v['app_scope'], v['timestamp_quality']) for v in videos))
