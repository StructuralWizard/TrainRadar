"""Automatic classification + stop extraction for the pan-European YouTube harvest.
Input: the JSON saved by the browser: {"db": {id: {q:[cc..], gem:1?}}, "det": {id: {st,t,c,s,ch:[lines],d1,kw,date}}}
"""
import re

COUNTRIES = ['AT','CH','DE','FR','IT','NL','BE','LU','DK','NO','SE','FI','PL','CZ','SK','HU','SI','HR','RS','BA','ME','MK',
             'AL','GR','BG','RO','MD','UA','EE','LV','LT','IE','TR','BY','XK','LI','ES','PT','GB']
FLAGS = {chr(0x1F1E6 + ord(a) - 65) + chr(0x1F1E6 + ord(b) - 65): a + b for a, b in
         [(c[0], c[1]) for c in COUNTRIES + ['UK']]}
FLAGS = {k: ('GB' if v == 'UK' else v) for k, v in FLAGS.items()}

# (regex, country) — operators and country names in several languages. Order matters (more specific first).
HINTS = [
 (r'\b(Liechtenstein|Schaan|Vaduz|Nendeln|Buchs.{0,25}Feldkirch|Feldkirch.{0,25}Buchs)', 'LI'),
 (r'\b(Salvan|Martigny|Finhaut|Le Châble|RhB|BLS|SBB|CFF|FFS|SOB|Zentralbahn|zb\b|MGB|Matterhorn|Gornergrat|Jungfrau|Pilatus|Rigi|Schweiz|Switzerland|Suisse|Svizzera|Zürich|Zurich|Bern\b|Basel|Luzern|Lucerne|Gen[eè]v|Lausanne|Chur|Gotthard|Lötschberg|Bernina|Albula|Brig\b|Interlaken|Zermatt|St\. ?Moritz|Davos|Appenzell)', 'CH'),
 (r'\b(ÖBB|OEBB|Railjet|Österreich|Austria|Autriche|Wien|Vienna|Salzburg|Innsbruck|Graz|Linz|Villach|Klagenfurt|Arlberg|Semmering|Tauern|Mariazell|Zillertal|Bregenz|Tirol|Steiermark|Kärnten)', 'AT'),
 (r'\b(Chamonix|Vallorcine|Saint-Gervais|Train Jaune|SNCF|TER\b|TGV|Intercit[ée]s|Transilien|RER\b|Ouigo|Frankreich|France|Francia|Paris|Lyon|Marseille|Bordeaux|Toulouse|Lille|Nantes|Strasbourg|Nice|Montpellier|Rennes|Grenoble|Chamonix|Corse|Corsica|Brest|Rouen|Dijon|Clermont|Limoges|Perpignan|Normandie|Bretagne|Occitanie|Alsace|Savoie|Provence)', 'FR'),
 (r'\b(Trenitalia|Frecciarossa|Frecciargento|Italo|RFI|Trenord|Italien|Italy|Italia|Italie|Roma|Rome|Milano|Milan|Napoli|Torino|Firenze|Venezia|Bologna|Genova|Verona|Bolzano|Bozen|Brennero|Sardegna|Sardinia|Sassari|Cagliari|Tempio|Sicilia|Sicily|Palermo|Bari|Trieste|Circumvesuviana|Vigezzina)', 'IT'),
 (r'\b(Nederland|Netherlands|Niederlande|Pays-Bas|Amsterdam|Rotterdam|Utrecht|Den Haag|Eindhoven|Groningen|Arnhem|Sprinter|NS\b|cabinerit)', 'NL'),
 (r'\b(SNCB|NMBS|Belgi[eë]|Belgium|Belgique|Belgien|Bruxelles|Brussel|Brussels|Antwerpen|Anvers|Gent|Gand|Liège|Luik|Namur|Charleroi|Oostende|Ostende)', 'BE'),
 (r'\b(CFL|Luxemb(ou|u|o)rg)', 'LU'),
 (r'\b(DSB|Danmark|Denmark|Dänemark|København|Copenhagen|Kopenhagen|Aarhus|Odense|Aalborg|Esbjerg|førerrum)', 'DK'),
 (r'\b(Vy\b|NSB|Norge|Norway|Norwegen|Oslo|Bergen|Bergensbanen|Flåm|Flam|Trondheim|Bodø|Dovre|Rauma|Nordland|Ofoten|Narvik|Stavanger|førerrom)', 'NO'),
 (r'\b(SJ\b|Sverige|Sweden|Schweden|Stockholm|Göteborg|Gothenburg|Malmö|Kiruna|Inlandsbanan|Norrland|Uppsala|förarhytt)', 'SE'),
 (r'\b(VR\b|Suomi|Finland|Finnland|Helsinki|Tampere|Turku|Oulu|Rovaniemi|ohjaamo)', 'FI'),
 (r'\b(PKP|Polska|Poland|Polen|Pologne|Warszawa|Warsaw|Kraków|Krakow|Gdańsk|Gdansk|Wrocław|Poznań|Katowice|Szczecin|Łódź|Zakopane|maszynist)', 'PL'),
 (r'\b(ČD|České dráhy|Česk|Czech|Tschechien|Praha|Prague|Prag\b|Brno|Ostrava|Plzeň|strojvedouc|[Pp]ohled z kabiny|Praha|Prague)', 'CZ'),
 (r'\b(ZSSK|ŽSR|Prešov|Bardejov|Poprad|Zvolen|Banská|Nitra|Trnava|Slovensk|Slovakia|Slowakei|Bratislava|Košice|Žilina|Tatra|rušňovod)', 'SK'),
 (r'\b(MÁV|MAV\b|GySEV|Magyar|Hungary|Ungarn|Budapest|Debrecen|Szeged|Pécs|Balaton|vezetőáll)', 'HU'),
 (r'\b(SŽ\b|Sloven(ija|ia|ien)|Ljubljana|Maribor|Bohinj|Koper)', 'SI'),
 (r'\b(HŽ\b|Hrvatsk|Croatia|Kroatien|Zagreb|Split|Rijeka|Osijek)', 'HR'),
 (r'\b(Srbij|Serbia|Serbien|Beograd|Belgrade|Novi Sad|Niš|Šargan|Sargan)', 'RS'),
 (r'\b(Bosn|Sarajevo|Mostar|Banja Luka|ŽFBH|ŽRS)', 'BA'),
 (r'\b(Crna Gora|Montenegro|Podgorica|Bar\b|ŽPCG)', 'ME'),
 (r'\b(Macedonia|Makedonij|Skopje)', 'MK'),
 (r'\b(Kosov|Prishtin|Pristina|Priština|Pej[ëe]\b|Trainkos|Fush[ëe] Kosov)', 'XK'),
 (r'\b(Albania|Shqip|Tirana|Durrës|HSH)', 'AL'),
 (r'\b(Greece|Greek|Hellenic|Griechenland|Grèce|Ελλ|Athens|Athen|Thessaloniki|Kalavrita|Diakopto|OSE\b)', 'GR'),
 (r'\b(BDŽ|BDZ|България|Bulgaria|Bulgarien|Sofia|Plovdiv|Varna|Burgas|Septemvri)', 'BG'),
 (r'\b(CFR\b|România|Romania|Rumänien|Bucure|Bucharest|Cluj|Brașov|Brasov|Timișoara|Iași|mecanicului|Mocăniț)', 'RO'),
 (r'\b(Moldova|Chișinău|Chisinau)', 'MD'),
 (r'\b(Ukrain|Україн|Укрзалізниц|Kyiv|Kiev|Lviv|Odesa|Kharkiv|Uzhhorod)', 'UA'),
 (r'\b(Elron|Eesti|Estonia|Estland|Tallinn|Tartu)', 'EE'),
 (r'\b(Latvij|Latvia|Lettland|Riga|Rīga|Pasažieru vilciens)', 'LV'),
 (r'\b(Lietuv|Lithuania|Litauen|Vilnius|Kaunas|Klaipėda)', 'LT'),
 (r'\b(Irish Rail|Iarnród|Ireland|Éire|Dublin|Cork|Galway|Limerick|DART|Luas|Belfast|Derry|NIR\b)', 'IE'),
 (r'\b(Belarus|Беларус|БЧ\b|BCh\b|Minsk|Мінск|Минск|Gomel|Homel|Гомел|Grodno|Hrodna|Гродн|Vitebsk|Віцебск|Витебск|Mogilev|Магілёў|Могилев|Orsha|Орша)', 'BY'),
 (r'\b(TCDD|Türkiye|Turkey|Türkei|Istanbul|İstanbul|Ankara|Marmaray)', 'TR'),
 (r'\b(HSB|Selketalbahn|Brockenbahn|Konstanz|Seehas|DB\b|Deutsche Bahn|ICE\b|S-Bahn|Regionalbahn|Regionalexpress|RE ?\d|RB ?\d|Deutschland|Germany|Allemagne|Hbf|Berlin|Hamburg|München|Munich|Köln|Frankfurt|Stuttgart|Düsseldorf|Dresden|Leipzig|Hannover|Nürnberg|Bremen|Harz|Schwarzwald|Sylt|Rügen|Mosel|Erzgebirge|Allgäu|Westerwald|Eifel|Thüringen|Sachsen|Bayern)', 'DE'),
]

RIDE = re.compile(r'(?i)pohled na trať|pogled|widok z kabiny|kabinból|cab|führerstand|fuhrerstand|mitfahrt|führerraum|cabine|cabina|kabin|driver|cabview|front ?(window|view|seat)|pov|lokführer|machinist|strojved|maszynist|förarhytt|førerrom|førerrum|ohjaamo|vezetőáll|rušňovod|mecanic|full (journey|route|ride)|komplett|ganze strecke|intégral|vista cabina|führerstandsmitfahrt|train ride|zugfahrt|mitfahrt|en cabine|in cabina|z kabiny|lokovision|streckenkunde|tram ride|u-bahn|metro|ride on|Mitfahrt|кабін|кабин|машиніст|машинист|καμπίνα|θέση οδηγού|makinist|mozdony|ohjaamo|kabinos|kabīn|kabiin|vedjun|pogled iz|Поглед|Кабина|Кабіна')
NOT_RIDE = re.compile(r'(?i)announcements|ansagen|lecture|greenway|drone|trainspotting|spotting|\bzugverkehr\b|durchfahrt|bahnübergang|level crossing|passage à niveau|\bvlog\b|review|unboxing|model railway|modellbahn|modelleisenbahn|h0\b|n-scale|train sim|simulator|tsw|train simulator|msts|openbts|zusi|roblox|minecraft|doku|documentary|reportage|news|compilation|zusammenschnitt|best of|shorts')
TRAM = re.compile(r'(?i)\bM\d{1,2}\b.*straße|\btram|straßenbahn|strassenbahn|tramway|tranvia|tranvía|tramwaj|villamos|električk|tramvaj|sporvogn|spårvagn|raitiovaun|\bstadtbahn\b|\bluas\b')
METRO = re.compile(r'(?i)u-bahn|\bmetro\b|métro|subway|underground|metropolitana|metrou|\bt-bane|tunnelbana|metroo')
RACK = re.compile(r'(?i)zahnrad|rack railway|crémaillère|cremagliera|funicul|standseilbahn|gornergrat|pilatus|rigi|jungfrau|wengernalp|brienz rothorn|zugspitz|schafberg|montenvers|mont-blanc')
HERITAGE = re.compile(r'(?i)dampf|steam|vapeur|vapore|museum|nostalgi|historic|histori|heritage|schmalspur|narrow gauge|oldtimer|sonderfahrt|railtour|parowóz|gőz|(19[0-9]{2})')
FREIGHT = re.compile(r'(?i)güterzug|gueterzug|freight|fret\b|cargo|merci\b|godstog|godståg|towarow|nákladn|tehervonat|marfa')
TEST = re.compile(r'(?i)messzug|test train|inspection|iris ?320|mauzin|diagnost')
HSR = re.compile(r'(?i)\bICE\b|\bTGV\b|frecciarossa|frecciargento|\bitalo\b|railjet|high[- ]speed|\bLGV\b|hochgeschwindigkeit|schnellfahrstrecke|\bSFS\b|300 ?km|320 ?km|\bAVE\b|ouigo|thalys|eurostar|pendolino|\bX2000\b|allegro|\bIC4\b|giruno|velaro')
SUBURBAN = re.compile(r'(?i)s-bahn|\bRER\b|transilien|\bS ?\d{1,2}\b|sprinter|suburban|cercan|pendeltåg|lokaltog|\bSKM\b|\bSKA\b|esko|rodalies|\bSPR\b')
WATCH_PASSENGER = re.compile(r'(?i)passenger|\bwindow\b(?! view: europe)|onboard|on board|im zug|sitzplatz|fenster|reisebericht|trip report|first class|1st class|2nd class|business class')

LI_RX = re.compile(r'Liechtenstein|Schaan|Vaduz|Nendeln|Buchs.{0,25}Feldkirch|Feldkirch.{0,25}Buchs')
def detect_country(text, qcc):
    if LI_RX.search(text): return 'LI'   # the Feldkirch–Buchs line runs through Liechtenstein
    found = [(text.find(fl), cc) for fl, cc in FLAGS.items() if fl in text]
    if found:
        return min(found)[1]
    for pat, cc in HINTS:
        if re.search(pat, text):
            return cc
    return qcc

GAP_RIDE = re.compile(r'(?i)cab|kabin|kabín|кабин|кабін|führerstand|mitfahrt|driver|pov|front|full (journey|ride)|complete|komplett|whole|cała|przejazd|trasą|linja \d|linie \d|line \d|\bM\d\b|ride (from|on)|journey|tram ride|train ride|förarhytt|førerrom|in cabina|en cabine|makinist|vista')
GAP_BAD = re.compile(r'(?i)guide|how to|explained|walkthrough|inaugura|télécabine|evolution|episode|action|movie|escalator|elevator|tickets|building|stations?\b.*\b(tour|várias)|várias|dentro do|history|blew my|\b101\b|first impressions|least known|would you')
def classify(vid, rec, det):
    t = det.get('t') or ''
    text = ' '.join([t, det.get('kw', ''), det.get('d1', '')])
    country = detect_country(t, None) or detect_country(det.get('kw', ''), None) or rec['q'][0]
    dur = det.get('s') or 0
    cat = 'regional'
    if RACK.search(t): cat = 'rack'
    elif TRAM.search(t): cat = 'tram'
    elif METRO.search(t): cat = 'metro'
    elif TEST.search(t): cat = 'test_train'
    elif FREIGHT.search(t): cat = 'freight'
    elif HERITAGE.search(t) and not HSR.search(t): cat = 'heritage'
    elif HSR.search(t): cat = 'hsr'
    elif SUBURBAN.search(t): cat = 'suburban'
    view = 'passenger' if WATCH_PASSENGER.search(t) else ('front' if cat in ('metro', 'tram') and re.search(r'(?i)front|pov', t) else 'cab')
    cov = 'full'
    if re.search(r'(?i)\b(part|teil|partie|parte|del)\s*\d|\(\d/\d\)|\b\d/\d\b', t): cov = 'partial'
    if dur and dur < 400:
        o_, d_ = endpoints(t)
        # short but genuine: a cab ride over one named section (e.g. one metro or branch-line leg)
        cov = 'partial' if (dur >= 120 and RIDE.search(t) and o_ and d_ and not NOT_RIDE.search(t)) else 'clip'
    ride = bool(RIDE.search(text)) or rec.get('gem') or rec.get('picked') or bool(det.get('ch')) or bool(rec.get('gapsearch') and GAP_RIDE.search(t))
    bad = bool(NOT_RIDE.search(t))
    if det.get('st') != 'OK':
        scope = 'out'
    elif rec.get('gapsearch') and not rec.get('picked') and (GAP_BAD.search(t) or not GAP_RIDE.search(t)):
        scope = 'out'       # targeted search results: only clear front/cab rides, no guides, news or station tours
    elif bad or not ride or cov == 'clip':
        scope = 'out'
    elif cat in ('metro', 'tram', 'rack', 'heritage'):
        scope = 'extended'
    else:
        scope = 'core'
    o, d = endpoints(t)
    return dict(category=cat, operator='', route='', origin=o, destination=d, view=view, coverage=cov,
                scope=scope, note='auto-classified' + ('; from Gemini doc' if rec.get('gem') else '') + ('; from targeted gap search' if rec.get('gapsearch') else ''), country=country)

SEP = r'(?:\s+(?:-|–|—|~)\s+|\s*(?:→|➔|⇒|>|<>)\s*|\s+(?:nach|to|à|a|bis|verso|naar|do|till|til)\s+)'
def endpoints(t):
    s = re.sub(r'[\[\(].*?[\]\)]', ' ', t)
    s = re.sub(r'[\U0001F000-\U0001FFFF★⁴ᴷ⁶⁰]', ' ', s)
    s = re.sub(r'(?i)\b(4K|UHD|HD|HDR|60 ?fps|cab ?ride|cabride|cabview|cab view|führerstandsmitfahrt|mitfahrt|train driver.?s view|driver.?s view|full journey|complete|komplett|en cabine|vista cabina|z kabiny|ohjaamosta)\b', ' ', s)
    s = re.sub(r'(?i)\b(RE|RB|IRE|S|IC|EC|ICE|BR|TER|U|R|RER|MEX|ME|Linie|line|ligne)\s?\d+[a-z]?\b', ' ', s)
    m = re.search(r'(?i)\b(?:von|de|from|da|z|od|van)\s+([A-ZÀ-ÖØ-ÞŁŚŻŹĆŃČŠŽŘĽŤĎŇ][\w\'’.\-/ ]{1,40}?)\s+(?:nach|à|to|a|do|naar|till|til|bis)\s+([A-ZÀ-ÖØ-ÞŁŚŻŹĆŃČŠŽŘĽŤĎŇ][\w\'’.\-/]+(?:\s(?!via|über|par|mit|with|en|in|im|auf|on|und|and|et|der|den|dem|des)[A-ZÀ-ÖØ-ÞŁŚŻŹĆŃČŠŽŘĽŤĎŇ(][\w\'’.\-/)]+){0,3})', s)
    if m:
        return m.group(1).strip(' -'), m.group(2).strip(' -')
    for part in re.split(r'\s[|:]\s|\s\|\s|\|', s):
        m = re.search(r'(?i)(?:von |de |da |from |z |od )?([A-ZÀ-ÖØ-ÞŁŚŻŹĆŃČŠŽŘĽŤĎŇ][\w\'’.\-/ ]{1,40}?)' + SEP + r'([A-ZÀ-ÖØ-ÞŁŚŻŹĆŃČŠŽŘĽŤĎŇ][\w\'’.\-/ ]{1,40}?)\s*(?:$|\s(?:via|über|par|per|mit|with|en|in|im|auf|on|und|and|et)\b|,)', part.strip())
        if m:
            o, d = m.group(1).strip(' -'), m.group(2).strip(' -')
            o = re.sub(r'(?i)^.*\b(?:Schwarzwaldbahn|Bahn|Express|bahn)\s+', '', o) if len(o.split()) > 3 else o
            if 2 < len(o) < 40 and 2 < len(d) < 40 and not re.match(r'(?i)^(the|der|die|das|le|la|il|un|a)\b', o):
                return o, d
    return '', ''

TSX = re.compile(r'((?:\d{1,2}:)?\d{1,2}:\d{2})')
def tosec(x):
    p = list(map(int, x.split(':')));
    return p[0] * 3600 + p[1] * 60 + p[2] if len(p) == 3 else p[0] * 60 + p[1]

JUNK = re.compile(r'(?i)^(intro\w*|outro|preview|vorschau|start|ende|end|credits|abspann|einleitung|begin|fin|inhalt|chapters?|kapitel|timestamps?|stations?|stops?|music|musik|song|drive time|fahrzeit|departure time|arrival time|abfahrt|ankunft)\b')
WAY = re.compile(r'(?i)tunnel|viadu|brücke|bridge|pont\b|ponte\b|most\b|bro\b|abzw|abzweig|junction|bif\b|bifurcation|bivio|\bkm\b|pass\b|summit|scheitel|col\b|lake|see\b|lac\b|lago\b|river|fluss|rivière|fiume|gorge|schlucht|valley|tal\b|vallée|loop|kreuzung|grenze|border|frontière|confine|track|gleis|signal|speed|geschwindigkeit|km/h')

def stops_from_chapters(lines, dur):
    out = []
    for raw in lines:
        l = raw.strip()
        m = re.match(r'^[^\w\d]{0,4}((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[)\]]?\s*[-–—:|.•>]*\s*(.+)$', l)
        if m:
            t, n = tosec(m.group(1)), m.group(2)
        else:
            m = re.match(r'^(.+?)\s*[-–—:|(\[]*\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[)\]]?$', l)
            if not m: continue
            n, t = m.group(1), tosec(m.group(2))
        n = re.sub(r'^[^\wÀ-ÿ]+', '', n)
        n = re.sub(r'\s*[\(\[].*?[\)\]]\s*$', '', n)
        n = re.sub(r'(?i)^(abfahrt|ankunft|arrivée|départ|partenza|arrivo|arrival|departure|halt|passing|durchfahrt)\s*(in|à|a|at|from|von|de)?\s*[:\-–]?\s*', '', n).strip(' -–—:|.')
        n = TSX.sub('', n).strip(' -–—:|.')
        if not n or len(n) > 60 or JUNK.match(n): continue
        if dur and t > dur: continue
        typ = 'W' if WAY.search(n) else 'S'
        out.append((t, n, typ))
    out.sort(key=lambda x: x[0])
    ded = []
    for p in out:
        if ded and (ded[-1][1].lower() == p[1].lower()): continue
        ded.append(p)
    return ded if sum(1 for p in ded if p[2] == 'S') >= 2 else []

PARTICLES = {'am','an','im','de','du','la','le','les','sur','en','del','di','della','upon','ob','bei','in','an der','d','des','dos','da','do','al'}
def trim_place(x):
    w = x.split()
    out = []
    for i, tok in enumerate(w):
        if tok[:1].islower() or tok[:1] in "&+":
            nxt = w[i + 1] if i + 1 < len(w) else ''
            if tok in PARTICLES and nxt[:1].isupper():
                out.append(tok); continue
            break
        out.append(tok)
    return ' '.join(out).strip(' -,.')

_endpoints = endpoints
def endpoints(t):
    t = re.sub(r'(?i)^(viaggio in cabina|viaggio|cabine rit|cabinerit|pohled na trať|vožnja)\s*', '', t.strip())
    o, d = _endpoints(t)
    if not o:
        core = re.sub(r'[\[\(].*?[\]\)]|[|:].*$', '', t)
        core = re.sub(r'(?i)(führerstandsmitfahrt|cab ?ride|cabview|4k|hd)', '', core).strip(' -')
        parts = [x.strip() for x in core.split('-')]
        if len(parts) == 2 and all(re.match(r'^[A-ZÀ-ÖØ-ÞŁŚŻŹĆŃČŠŽŘĽŤĎŇ]', x) for x in parts):
            o, d = parts
    return trim_place(o), trim_place(d)

NOISE = re.compile(r'(?i)^(SLT|SNG|VIRM|ICM|ICNG|ICE|IC|DDZ|MS\d*|AM\d*|BREAK|SNCB|NMBS|CFL|NS|DB|SBB|ÖBB|TER|TGV|Sprinter|Intercity|Regio|Cabinerit|cabride|treintrip|trip|train|zug|cab|ride)$')
COUNTRYW = re.compile(r'(?i)^(Belgium|Belgique|België|Netherlands|Nederland|Holland|Luxembourg|Luxemburg|Germany|Deutschland|France|Italy|Italia|Switzerland|Schweiz|Austria|Österreich)\b[ ,]*')
def _clean_place(x, last=False):
    x = COUNTRYW.sub('', x.strip())
    segs = [s_.strip() for s_ in re.split(r'\s+[-–]\s+', x) if s_.strip()]
    if segs: x = segs[-1] if last else segs[0]
    out = []
    for tok in x.split():
        if re.search(r'\d', tok) or NOISE.match(tok): break
        out.append(tok)
    return ' '.join(out).strip(' -,.')

_endpoints2 = endpoints
def endpoints(t):
    o, d = _endpoints2(t)
    o, d = _clean_place(o), _clean_place(d, last=True)
    if not o or not d or o.lower() == d.lower():
        return '', ''
    return o, d
