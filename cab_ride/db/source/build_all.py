"""Builds the TrainRadar cab-ride database (Spain + UK/Ireland) from the verified YouTube data.
usage: python build_all.py <spain_dir> <uk_dir> <pt_dir> <europe_dir> <outdir>
"""
import json, re, csv, sqlite3, sys, os, unicodedata, collections, datetime, glob
sys.path.insert(0, os.path.dirname(__file__))
from classify import CLASS as CLASS_ES
from overrides import CHAPTER_MAP, UPPER_IS_STATION, UPPER_IS_WAYPOINT, SEQ as SEQ_ES, ANCHORS
import classify_uk
from overrides_uk import SEQ_UK, NO_STOPS
from classify_pt import CLASS as CLASS_PT, SEQ_PT
import europe

ES, UK, PT, EU, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
os.makedirs(OUT, exist_ok=True)
TODAY = datetime.date.today().isoformat()

CRS = {'KGX': "London King's Cross", 'SVG': 'Stevenage', 'PBO': 'Peterborough', 'GRA': 'Grantham', 'NNG': 'Newark North Gate',
       'RET': 'Retford', 'DON': 'Doncaster', 'YRK': 'York', 'NTR': 'Northallerton', 'DAR': 'Darlington', 'DHM': 'Durham',
       'NCL': 'Newcastle', 'LDS': 'Leeds', 'WKF': 'Wakefield Westgate', 'MPT': 'Morpeth', 'ALM': 'Alnmouth',
       'BWK': 'Berwick-upon-Tweed', 'RSN': 'Reston', 'DUN': 'Dunbar', 'EDB': 'Edinburgh Waverley'}

ALIAS = {
 'madrid chamartin clara campoamor': 'madrid chamartin', 'montserrat monestir': 'montserrat',
 'alacant terminal': 'alicante terminal', 'port bou': 'portbou', 'amara donostia': 'donostia amara',
 'zazpikaleak casco viejo': 'casco viejo', 'bilbao atxuri': 'atxuri', 'madrid atocha': 'madrid puerta de atocha',
 'atocha': 'madrid puerta de atocha', 'chamartin': 'madrid chamartin', 'barcelona sants station': 'barcelona sants',
 'paseo de gracia': 'barcelona passeig de gracia', 'barcelona sant andreu': 'sant andreu comtal',
 'elx av': 'elche av', 'hendaia hendaye': 'hendaia', 'ribes enllac': 'ribes de freser', 'albacete': 'albacete los llanos',
 'valencia': 'valencia nord',
 # PT
 'campolide a': 'campolide', 'santo amaro de oeiras': 'santo amaro', 'porto sao bento': 'porto sao bento',
 'faro station': 'faro', 'carregado alenquer': 'carregado',
 # UK
 'london kings cross': 'london kings cross', 'kings cross': 'london kings cross', 'euston': 'london euston',
 'waterloo': 'london waterloo', 'paddington': 'london paddington', 'marylebone': 'london marylebone',
 'fenchurch street': 'london fenchurch street', 'london st pancras international': 'london st pancras',
 'st pancras international': 'london st pancras', 'edinburgh': 'edinburgh waverley', 'haymarket': 'haymarket',
 'edinburgh haymarket': 'haymarket', 'exeter st davids': 'exeter st davids', 'newark northgate': 'newark north gate',
 'kings cross st pancras': 'kings cross st pancras', 'newcastle central': 'newcastle', 'carlisle citadel': 'carlisle',
 'glasgow queen street low level': 'glasgow queen street', 'dublin connolly station': 'dublin connolly',
 'connolly station': 'dublin connolly', 'heathrow central': 'heathrow terminals 2 3', 'whittlesea': 'whittlesea',
 'mediacityuk': 'mediacityuk', 'media city uk': 'mediacityuk', 'llandaf': 'llandaff', 'saltire': 'saltaire',
 'piccadilly': 'manchester piccadilly', 'leeds lds': 'leeds',
}
# Tube / metro stations share names with National Rail stations (e.g. 'Stratford', 'Paddington'); keep them separate
METRO_CATS = {'metro', 'tram'}

def norm(name):
    n = unicodedata.normalize('NFKD', name.lower())
    n = ''.join(c for c in n if not unicodedata.combining(c))
    n = n.replace('&', ' ').replace("'", '').replace('’', '')
    n = re.sub(r"^(estacion|estacio|apeadero) de ", '', n)
    n = re.sub(r"[^a-z0-9]+", ' ', n).strip()
    return ALIAS.get(n, n)

SKIP = re.compile(r'^(preview|intro|presentaci|drive time|route preview|credits)', re.I)
FEATURE = re.compile(r'\b(river|riu|bridge|tunel|túnel|tunnel|highway|junction|gauge|class \d|emu|beach|workshops?|waiting|viaduct|viaducto|cargo|bay of|passing loop|bypass|motorway|line \(|high-speed line|from |to barcelona|turning|still under)\b', re.I)
KEEP_STATION = re.compile(r'(?i)junction$|^.*\bjunction\b(?!.*(diverges|north|east|west|south))')  # e.g. 'Watford Junction', 'Clapham Junction'

def titlecase(n):
    if n.isupper() and len(n) >= 3:
        small = {'de','del','la','las','los','el','i','y','da','do','das','dos','sur','a'}
        cap = lambda x, i: x if (x in small and i) else x[:1].upper() + x[1:]
        w = n.lower().split(' ')
        out = ' '.join('-'.join(cap(y, i + j) if not (y == 'a' and i == len(w) - 1) else 'A' for j, y in enumerate(x.split('-'))) for i, x in enumerate(w)).replace('Sur-', 'sur-').replace('-Sur-', '-sur-')
        return re.sub(r'\((\w+)\)', lambda m: '(' + m.group(1).upper() + ')' if len(m.group(1)) <= 4 else m.group(0), out)
    return n

def is_station_name(n):
    if re.search(r'(?i)\b(junction|jn)\b', n) and re.match(r'(?i)^(watford|clapham|willesden|stourbridge|lichfield|yeovil|georgemas|limerick|llandudno|ribes|meadowhall|ely)', n):
        return True
    return not FEATURE.search(n)

def parse_chapters(vid, rows, channel):
    out, final = [], None
    for s, n in rows:
        n = n.strip()
        if SKIP.match(n): continue
        typ = 'S'
        if n.startswith('W:'):
            out.append((s, n[2:].strip(), 'W')); final = None; continue
        m = re.match(r'^([A-Z]{3})-([A-Z]{3})$', n)
        if m and m.group(1) in CRS:
            out.append((s, CRS[m.group(1)], 'S')); final = CRS.get(m.group(2)); continue
        m = re.match(r'^(.+?) to (.+)$', n)
        if m and len(m.group(1)) < 45:
            out.append((s, m.group(1).strip(), 'S')); final = m.group(2).strip(); continue
        if channel == 'ItzAlfredoYT':
            if n.lower().startswith('estación de '): n = n[12:]
            else:
                m = re.match(r'^(.+?) - (.+)$', n)
                if m: n = m.group(1)
        if vid in UPPER_IS_STATION: typ = 'S' if n.isupper() else 'W'
        elif vid in UPPER_IS_WAYPOINT: typ = 'W' if n.isupper() else 'S'
        if not is_station_name(n): typ = 'W'
        out.append((s, titlecase(n), typ)); final = None
    if final: out.append((None, final, 'S'))
    ded = []
    for p in out:
        if ded and norm(ded[-1][1]) == norm(p[1]):
            if len(ded) == 1: ded[-1] = p
            continue
        ded.append(p)
    return ded

def fill_times(pts, dur, anchors=None):
    """pts: list of [t or None, name, type]; returns list of (t, real?)"""
    n = len(pts)
    lead = tail = round(min(60, dur * 0.02))
    known = {i: p[0] for i, p in enumerate(pts) if p[0] is not None}
    for nm, t in (anchors or {}).items():
        for i, p in enumerate(pts):
            if norm(p[1]) == norm(nm): known[i] = t; break
    real = set(known)
    if 0 not in known: known[0] = lead
    if n - 1 not in known: known[n - 1] = max(known[0] + 1, dur - tail) if n > 1 else lead
    ks = sorted(known)
    res = []
    for i in range(n):
        if i in known: res.append((known[i], i in real)); continue
        a = max(k for k in ks if k < i); b = min(k for k in ks if k > i)
        res.append((round(known[a] + (known[b] - known[a]) * (i - a) / (b - a)), False))
    return res

def load_meta(path):
    meta = {}
    for l in open(path, encoding='utf-8'):
        vid, s, ch, t = l.rstrip('\n').split('\t')
        meta[vid] = dict(duration_s=int(s), channel=ch, title=t)
    return meta

def load_chapters(files):
    chap, cur = {}, None
    for f in files:
        for l in open(f, encoding='utf-8'):
            l = l.rstrip('\n')
            if l.startswith('#'): cur = l[1:].strip(); chap[cur] = []
            elif l.strip():
                s, name = l.split(' ', 1); chap[cur].append((int(s), name.strip()))
    return chap

def first_ctx(parsed):
    return {v['id']: v['occ'][0] for v in parsed['videos']}

videos, stops = [], []
seq_by_video = {}

def add_video(vid, m, c, pts, src, country, ctx_section, anchors=None):
    dur = m['duration_s']
    pts = [(None if (p[0] is not None and p[0] > dur) else p[0], p[1], p[2]) for p in pts]
    timed = fill_times([list(p) for p in pts], dur, anchors) if pts else []
    nreal = sum(1 for _, r in timed if r)
    if src == 'youtube_chapters':
        times = [p[0] for p in pts if p[0] is not None]
        rounded = len(times) >= 3 and sum(1 for t in times if t % 60 == 0) / len(times) > 0.6
        nst = sum(1 for p in pts if p[2] == 'S')
        tq = 'approximate' if rounded or nst < 3 else 'precise'
    elif anchors:
        tq = 'approximate'
    elif src == 'research_doc_times':
        tq = 'unverified'
    elif pts:
        tq = 'estimated'
    else:
        tq = 'none'
    for i, (p, (t, real)) in enumerate(zip(pts, timed)):
        tsrc = 'uploader_chapter' if real and src in ('youtube_chapters', 'curated_sequence') else ('research_doc_unverified' if real else 'even_spacing_estimate')
        stops.append(dict(video_id=vid, seq=i + 1, name=p[1], station_key=norm(p[1]),
                          point_type='station' if p[2] == 'S' else 'waypoint', t_seconds=t, t_source=tsrc,
                          deep_link=f'https://www.youtube.com/watch?v={vid}&t={t}s'))
    seq_by_video[vid] = pts
    videos.append(dict(video_id=vid, url=f'https://www.youtube.com/watch?v={vid}', title=m['title'], channel=m['channel'],
        duration_s=dur, country=country, category=c['category'], operator=c['operator'], line_or_route=c['route'],
        origin=c['origin'], destination=c['destination'], view_type=c['view'], coverage=c['coverage'],
        app_scope=c['scope'], timestamp_quality=tq, stops_source=src, n_stops=len(pts), notes=c.get('note', ''),
        research_doc=ctx_section[0], research_section=ctx_section[1], verified_on='2026-11-21'))

# ---------------- SPAIN ----------------
meta_es = load_meta(f'{ES}/yt_meta.tsv')
chap_es = load_chapters([f'{ES}/yt_chapters_1.txt', f'{ES}/yt_chapters_2.txt'])
gem_es = json.load(open(f'{ES}/gem_seq.json', encoding='utf-8'))
ctx_es = first_ctx(json.load(open(f'{ES}/parsed.json', encoding='utf-8')))

def clean_gem(name):
    name = re.sub(r'^(?:~?\d{1,2}:\d{2}(?::\d{2})?\s+|0+\s+)', '', name).strip(' .,)(—–-')
    return re.sub(r'\s*\.\s*/.*$', '', name)

for vid, m in meta_es.items():
    c = dict(CLASS_PT[vid]) if vid in CLASS_PT else dict(CLASS_ES[vid])
    pts, src = [], 'none'
    if c['scope'] != 'out' and c['coverage'] not in ('clip', 'compilation'):
        if vid in CHAPTER_MAP:
            pts = list(CHAPTER_MAP[vid]); src = 'youtube_chapters'
        elif vid in chap_es and vid not in ANCHORS:
            pts = parse_chapters(vid, chap_es[vid], m['channel']); src = 'youtube_chapters'
        elif vid in SEQ_ES and SEQ_ES[vid]:
            pts = [(None, x[2:], 'W') if x.startswith('W:') else (None, x, 'S') for x in SEQ_ES[vid].split('|')]; src = 'curated_sequence'
        elif vid not in SEQ_ES and len(gem_es.get(vid, [])) >= 2:
            pts = [(None, clean_gem(n), 'S') for _, n in gem_es[vid] if clean_gem(n)]; src = 'gemini_sequence'
        if not pts and c['origin'] and c['destination'] and c['origin'] != c['destination']:
            pts = [(None, c['origin'], 'S'), (None, c['destination'], 'S')]; src = 'route_endpoints'
    g = ctx_es.get(vid)
    add_video(vid, m, c, pts, src, 'PT' if vid in CLASS_PT else 'ES', ('Renfe Cab Ride Videos.docx', g['h2'] if g else 'listed only in a Sources list'), ANCHORS.get(vid))

# ---------------- UK / IRELAND / EUROPE ----------------
meta_uk = load_meta(f'{UK}/yt_meta_uk.tsv')
chap_uk = load_chapters([f'{UK}/ch1.txt', f'{UK}/ch2.txt', f'{UK}/ch3.txt'])
gem_uk = json.load(open(f'{UK}/gem_uk.json', encoding='utf-8'))
ctx_uk = first_ctx(json.load(open(f'{UK}/parsed.json', encoding='utf-8')))

for vid, m in meta_uk.items():
    if vid in meta_es: continue      # i3m30LG6llY appears in both docs
    ctx = ctx_uk.get(vid) or {}
    c = classify_uk.classify(vid, ctx, m)
    pts, src = [], 'none'
    if c['scope'] != 'out' and c['coverage'] not in ('clip', 'compilation') and vid not in NO_STOPS:
        if vid in chap_uk:
            pts = parse_chapters(vid, chap_uk[vid], m['channel']); src = 'youtube_chapters'
        elif SEQ_UK.get(vid):
            pts = [(None, x[2:], 'W') if x.startswith('W:') else (None, x, 'S') for x in SEQ_UK[vid].split('|')]; src = 'curated_sequence'
        elif gem_uk.get(vid, {}).get('kind') in ('table', 'times'):
            seq = [(t if (t is None or t <= m['duration_s']) else None, n) for t, n in gem_uk[vid]['seq']]
            pts = [(t, n, 'S' if is_station_name(n) else 'W') for t, n in seq if n]; src = 'research_doc_times'
        if not pts and c['origin'] and c['destination'] and c['origin'] != c['destination'] and c['coverage'] == 'full':
            pts = [(None, c['origin'], 'S'), (None, c['destination'], 'S')]; src = 'route_endpoints'
    if pts:
        st = [p[1] for p in pts if p[2] == 'S'] or [p[1] for p in pts]
        c['origin'], c['destination'] = st[0], st[-1]
    add_video(vid, m, c, pts, src, c['country'], ('UK Train Cab Videos & Timestamps.docx', ctx.get('h2', 'listed only in a Sources list') if ctx else 'listed only in a Sources list'))

# ---------------- PORTUGAL ----------------
meta_pt = load_meta(f'{PT}/yt_meta_pt.tsv')
chap_pt = load_chapters([f'{PT}/ch_pt.txt'])
ctx_pt = first_ctx(json.load(open(f'{PT}/parsed.json', encoding='utf-8')))
for vid, m in meta_pt.items():
    c = dict(CLASS_PT[vid])
    pts, src = [], 'none'
    if c['scope'] != 'out' and c['coverage'] not in ('clip', 'compilation'):
        if vid in chap_pt:
            pts = parse_chapters(vid, chap_pt[vid], m['channel']); src = 'youtube_chapters'
        elif SEQ_PT.get(vid):
            pts = [(None, x[2:], 'W') if x.startswith('W:') else (None, x, 'S') for x in SEQ_PT[vid].split('|')]; src = 'curated_sequence'
        if not pts and c['origin'] and c['destination'] and c['origin'] != c['destination']:
            pts = [(None, c['origin'], 'S'), (None, c['destination'], 'S')]; src = 'route_endpoints'
    g = ctx_pt.get(vid)
    add_video(vid, m, c, pts, src, 'PT', ('Portuguese Train Cab Ride Videos.docx', g['h2'] if g else 'listed only in a Sources list'))

# ---------------- REST OF EUROPE (automatic) ----------------
eu = json.load(open(f'{EU}/europe_harvest.json', encoding='utf-8'))
# Extra Gemini country lists (Benelux etc.): {country_by_id} + browser-read details
for extra in sorted(glob.glob(f'{EU}/gemini_*_ids.json')):
    ids_ = json.load(open(extra, encoding='utf-8'))
    det_path = extra.replace('_ids.json', '_details.json')
    dets_ = json.load(open(det_path, encoding='utf-8')) if os.path.exists(det_path) else {}
    for vid_, cc_ in ids_.items():
        if vid_ not in eu['db']:
            eu['db'][vid_] = {'q': [cc_], 'gem': 1, 't': '', 'c': '', 'l': ''}
        else:
            eu['db'][vid_]['gem'] = 1
        if vid_ in dets_ and vid_ not in eu['det']:
            eu['det'][vid_] = dets_[vid_]
# Targeted YouTube searches to fill coverage gaps: {id: cc} + details. Not Gemini-vetted, so no leniency.
for extra in sorted(glob.glob(f'{EU}/search_*_ids.json')):
    ids_ = json.load(open(extra, encoding='utf-8'))
    det_path = extra.replace('_ids.json', '_details.json')
    dets_ = json.load(open(det_path, encoding='utf-8')) if os.path.exists(det_path) else {}
    for vid_, cc_ in ids_.items():
        if vid_ not in eu['db']:
            eu['db'][vid_] = {'q': [cc_], 'gapsearch': 1, 't': '', 'c': '', 'l': ''}
            if 'picked' in extra: eu['db'][vid_]['picked'] = 1   # hand-checked search result
        if vid_ in dets_ and vid_ not in eu['det']:
            eu['det'][vid_] = dets_[vid_]
# Gemini FR/CH/IE videos confirmed via YouTube oEmbed (title/channel only; length unknown until enrichment).
# The 4th column may end with a classification hint word added by hand; it is stripped from the displayed title.
HINT = re.compile(r'\s(documentary|window|spotting|vlog|archive|cab view|cab|zahnrad|metro|reportage|announcements|compilation)$')
if os.path.exists(f'{EU}/gemini_oembed.tsv'):
    for l in open(f'{EU}/gemini_oembed.tsv', encoding='utf-8'):
        vid_, cc_, ch_, t_ = (l.rstrip('\n').split('\t') + ['', '', '', ''])[:4]
        if vid_ in eu['det']: continue
        if ch_ == 'GONE':
            eu['det'][vid_] = {'st': 'GONE'}; continue
        shown = t_
        while HINT.search(shown): shown = HINT.sub('', shown)
        shown = shown.replace(' metro - 4K', ' - 4K').replace('| MGB', '| M').replace('MVR zahnrad', 'MVR')
        eu['det'][vid_] = {'st': 'OK', 't': t_, 't_show': shown, 'c': ch_, 's': 0, 'ch': [], 'kw': '', 'd1': '', 'oembed': 1}
have = {v['video_id'] for v in videos}
for vid, rec in eu['db'].items():
    if vid in have: continue
    det = eu['det'].get(vid)
    if not det or det.get('st') in ('err', 'noparse'):
        if not rec.get('t'):
            continue      # Gemini-only id not yet read on YouTube: added once enrichment runs
        def _len(x):
            p_ = [int(y) for y in x.split(':') if y.isdigit()]
            return p_[0] * 3600 + p_[1] * 60 + p_[2] if len(p_) == 3 else (p_[0] * 60 + p_[1] if len(p_) == 2 else 0)
        det = {'st': 'OK', 't': rec['t'], 'c': rec['c'], 's': _len(rec.get('l', '')), 'ch': [], 'kw': '', 'd1': '', 'search_only': 1}
    elif det.get('st') != 'OK':
        continue          # unplayable / removed on YouTube
    c = europe.classify(vid, rec, det)
    m = dict(duration_s=int(det.get('s') or 0), channel=det.get('c') or '', title=det.get('t_show') or det.get('t') or '')
    pts, src = [], 'none'
    if c['scope'] != 'out' and c['coverage'] not in ('clip', 'compilation'):
        pts = europe.stops_from_chapters(det.get('ch') or [], m['duration_s'])
        if pts: src = 'youtube_chapters'
        elif not m['duration_s']: pass      # length unknown: no estimated stops
        elif c['origin'] and c['destination'] and norm(c['origin']) != norm(c['destination']):
            pts = [(None, c['origin'], 'S'), (None, c['destination'], 'S')]; src = 'route_endpoints'
    if pts:
        st_ = [p[1] for p in pts if p[2] == 'S'] or [p[1] for p in pts]
        c['origin'], c['destination'] = st_[0], st_[-1]
    if det.get('search_only'): c['note'] += '; search-result metadata only (chapters not read yet)'
    if det.get('oembed'): c['note'] += '; confirmed via oEmbed only (length and chapters not read yet)'
    if pts and src == 'youtube_chapters':
        pts = [(t_, titlecase(n_), ty_) for t_, n_, ty_ in pts]
    c['origin'], c['destination'] = titlecase(c['origin']), titlecase(c['destination'])
    add_video(vid, m, c, pts, src, c['country'], ('YouTube search 2026-11-21' if not rec.get('gem') else 'Gemini country doc + YouTube check', ','.join(rec['q'])))

# ---------------- borrow sequences for endpoint-only rides ----------------
vmap = {v['video_id']: v for v in videos}
borrowed = 0
for v in videos:
    if v['stops_source'] != 'route_endpoints': continue
    o, d = norm(v['origin']), norm(v['destination'])
    best = None
    for oid, pts in seq_by_video.items():
        if oid == v['video_id'] or vmap[oid]['stops_source'] not in ('youtube_chapters', 'curated_sequence'): continue
        if vmap[oid]['country'] != v['country']: continue
        keys = [norm(p[1]) for p in pts]
        if o in keys and d in keys:
            i, j = keys.index(o), keys.index(d)
            sub = pts[i:j + 1] if i < j else list(reversed(pts[j:i + 1]))
            if len(sub) > 2 and (best is None or len(sub) > len(best)): best = sub
    if best:
        vid = v['video_id']
        stops[:] = [s for s in stops if s['video_id'] != vid]
        timed = fill_times([[None, p[1], p[2]] for p in best], v['duration_s'])
        for i, (p, (t, _)) in enumerate(zip(best, timed)):
            stops.append(dict(video_id=vid, seq=i + 1, name=p[1], station_key=norm(p[1]),
                              point_type='station' if p[2] == 'S' else 'waypoint', t_seconds=t, t_source='even_spacing_estimate',
                              deep_link=f'https://www.youtube.com/watch?v={vid}&t={t}s'))
        v['stops_source'] = 'borrowed_sequence'; v['n_stops'] = len(best); v['timestamp_quality'] = 'estimated'
        borrowed += 1

# metro stations get a separate key namespace so 'Stratford' (Jubilee) != 'Stratford' (National Rail)
for s in stops:
    if vmap[s['video_id']]['category'] in METRO_CATS and vmap[s['video_id']]['country'] != 'ES':
        s['station_key'] = 'm:' + s['station_key']

# ---------------- stations ----------------
st = collections.OrderedDict()
for s in stops:
    if s['point_type'] != 'station': continue
    e = st.setdefault(s['station_key'], dict(names=collections.Counter(), videos=set()))
    e['names'][s['name']] += 1; e['videos'].add(s['video_id'])
stations = []
for k, e in st.items():
    vs = [vmap[x] for x in e['videos']]
    scopes = {x['app_scope'] for x in vs}
    stations.append(dict(station_key=k, display_name=e['names'].most_common(1)[0][0],
        name_variants=' | '.join(sorted(e['names'])), country=collections.Counter(x['country'] for x in vs).most_common(1)[0][0],
        n_videos=len(e['videos']), categories=','.join(sorted({x['category'] for x in vs})),
        app_scope='core' if 'core' in scopes else 'extended', network_stop_id='', lat='', lon=''))
stations.sort(key=lambda x: (x['country'], -x['n_videos'], x['station_key']))
stops.sort(key=lambda s: (s['video_id'], s['seq']))

# ---------------- write ----------------
def wcsv(name, rows):
    with open(f'{OUT}/{name}', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
wcsv('videos.csv', videos); wcsv('video_stops.csv', stops); wcsv('stations.csv', stations)

dbp = f'{OUT}/cab_rides.db'
if os.path.exists(dbp): os.remove(dbp)
db = sqlite3.connect(dbp)
db.executescript(open(os.path.join(os.path.dirname(__file__), 'schema.sql'), encoding='utf-8').read())
db.executemany('INSERT INTO videos VALUES (%s)' % ','.join('?' * len(videos[0])), [tuple(v.values()) for v in videos])
db.executemany('INSERT INTO video_stops (video_id,seq,name,station_key,point_type,t_seconds,t_source,deep_link) VALUES (?,?,?,?,?,?,?,?)',
               [(s['video_id'], s['seq'], s['name'], s['station_key'], s['point_type'], s['t_seconds'], s['t_source'], s['deep_link']) for s in stops])
db.executemany('INSERT INTO stations VALUES (%s)' % ','.join('?' * len(stations[0])), [tuple(s.values()) for s in stations])
db.commit(); db.close()

by_vid = collections.defaultdict(list)
for s in stops: by_vid[s['video_id']].append(s)
EUROPE = tuple(sorted({v['country'] for v in videos} - {'ES', 'PT', 'GB', 'NI', 'IE', 'IM'}))
for country, fname in [('ES', 'cab_rides.json'), ('PT', 'cab_rides_pt.json'), (('GB', 'NI', 'IE', 'IM'), 'cab_rides_uk_ie.json'), (EUROPE, 'cab_rides_europe.json')]:
    cs = (country,) if isinstance(country, str) else country
    b = dict(version=2, generated=TODAY, countries=list(cs),
             note='t = seconds into the video. q = timestamp quality. stops: [station_key, name, t, is_station, t_is_real]',
             videos=[], stations={})
    keys = set()
    for v in videos:
        if v['country'] not in cs or v['app_scope'] == 'out' or not v['n_stops']: continue
        vs = by_vid[v['video_id']]
        b['videos'].append(dict(id=v['video_id'], title=v['title'], ch=v['channel'], dur=v['duration_s'], country=v['country'],
            cat=v['category'], op=v['operator'], route=v['line_or_route'], view=v['view_type'], cov=v['coverage'],
            scope=v['app_scope'], q=v['timestamp_quality'],
            stops=[[s['station_key'], s['name'], s['t_seconds'], 1 if s['point_type'] == 'station' else 0, 1 if s['t_source'] == 'uploader_chapter' else 0] for s in vs]))
        keys |= {s['station_key'] for s in vs if s['point_type'] == 'station'}
    b['stations'] = {s['station_key']: s['display_name'] for s in stations if s['station_key'] in keys}
    json.dump(b, open(f'{OUT}/{fname}', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

print(len(videos), 'videos;', len(stops), 'stops;', len(stations), 'stations; borrowed', borrowed)
print(collections.Counter((v['country'], v['app_scope']) for v in videos))
print(collections.Counter((v['country'] in ('ES',), v['timestamp_quality']) for v in videos if v['app_scope'] != 'out'))
