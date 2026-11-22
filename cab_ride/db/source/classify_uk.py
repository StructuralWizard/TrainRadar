# Rule-based classification of the UK / Ireland / Europe videos, with per-video overrides.
import re

# prompt keyword -> (default category, default country, default operator)
PROMPT_RULES = [
    ('as many youtube train cab videos from UK', 'intercity', 'GB', ''),
    ('London Underground driver cab', 'metro', 'GB', 'London Underground'),
    ('Scottish Highlands', 'regional', 'GB', ''),
    ('Elizabeth line, Docklands', 'suburban', 'GB', 'TfL'),
    ('Eurostar and High Speed 1', 'intercity', 'GB', ''),
    ('Pendolino', 'intercity', 'GB', 'Avanti West Coast'),
    ('Midland Main Line and CrossCountry', 'intercity', 'GB', ''),
    ('TransPennine Express and Northern', 'regional', 'GB', ''),
    ('Greater Anglia and East Midlands', 'regional', 'GB', ''),
    ('Southern, Southeastern, and South Western', 'suburban', 'GB', ''),
    ('Thameslink cross-London', 'suburban', 'GB', ''),
    ('Great Western Railway (GWR) and Transport for Wales', 'regional', 'GB', ''),
    ('Chiltern Railways and West Midlands', 'regional', 'GB', ''),
    ('Merseyrail and North Wales', 'regional', 'GB', ''),
    ('ScotRail Central Belt', 'suburban', 'GB', 'ScotRail'),
    ('ScotRail Far North', 'regional', 'GB', 'ScotRail'),
    ('Northern Ireland Railways', 'regional', 'NI', 'NI Railways'),
    ('Manchester Metrolink, Tyne and Wear', 'tram', 'GB', ''),
    ('New Measurement Train', 'test_train', 'GB', 'Network Rail'),
    ('railtour and preserved diesel', 'heritage', 'GB', ''),
    ('heritage railway steam', 'heritage', 'GB', ''),
    ('AC electric locomotive', 'intercity', 'GB', ''),
    ('1980s and 1990s British Rail archival', 'archive', 'GB', 'British Rail (archive)'),
    ('freight train cab ride', 'freight', 'GB', ''),
    ('Glasgow Subway and 1990s Tyne', 'metro', 'GB', ''),
    ('Irish Rail DART', 'suburban', 'IE', 'Iarnród Éireann'),
    ('Irish Rail InterCity', 'intercity', 'IE', 'Iarnród Éireann'),
    ('European high-speed TGV', 'foreign', 'EU', ''),
    ('miniature railway and Snowdon', 'heritage', 'GB', ''),
]

OPERATOR_HINTS = [
    (r'London North Eastern|LNER|King\'s Cross|Class 91|InterCity 225|Flying Scotsman', 'LNER'),
    (r'Avanti|Pendolino|Euston to (Crewe|Birmingham)|West Coast Main Line', 'Avanti West Coast / WCML'),
    (r'GWR|Great Western|Paddington', 'GWR'),
    (r'ScotRail', 'ScotRail'), (r'TransPennine', 'TransPennine Express'), (r'Northern', 'Northern'),
    (r'Greater Anglia', 'Greater Anglia'), (r'Southeastern|Javelin|395', 'Southeastern'),
    (r'South Western|Waterloo', 'South Western Railway'), (r'Thameslink', 'Thameslink'),
    (r'Gatwick Express', 'Gatwick Express'), (r'Transport for Wales|Treherbert|Aberdare|Valleys', 'Transport for Wales'),
    (r'Chiltern|Marylebone', 'Chiltern Railways'), (r'West Midlands Railway|Cross City', 'West Midlands Railway'),
    (r'Merseyrail', 'Merseyrail'), (r'Elizabeth Line|Crossrail', 'Elizabeth line'), (r'DLR|Docklands', 'DLR'),
    (r'Windrush|Suffragette|Watford DC|North & West London|Overground', 'London Overground'),
    (r'c2c|C2C', 'c2c'), (r'Metrolink', 'Manchester Metrolink'), (r'Tyne and Wear|Tyne & Wear|Metrocar', 'Tyne and Wear Metro'),
    (r'Edinburgh Trams', 'Edinburgh Trams'), (r'Blackpool', 'Blackpool Tramway'), (r'Supertram', 'Sheffield Supertram'),
    (r'Tramlink|London Trams', 'London Trams'), (r'Glasgow Subway|Glasgow Metro', 'Glasgow Subway'),
    (r'Translink|TranslinkNI', 'NI Railways'), (r'Enterprise', 'Enterprise (NIR/IÉ)'), (r'DART', 'Iarnród Éireann DART'),
    (r'Eurostar|Eurotunnel', 'Eurostar / Eurotunnel'), (r'TGV', 'SNCF'), (r'ICE', 'DB'), (r'SBB', 'SBB'),
    (r'Snowdon', 'Snowdon Mountain Railway'), (r'Snaefell', 'Snaefell Mountain Railway'),
    (r'Romney', 'RH&DR'), (r'Ravenglass', 'Ravenglass & Eskdale'), (r'Bure Valley', 'Bure Valley Railway'),
    (r'CrossCountry|Cross Country|Crosscountry', 'CrossCountry'), (r'Merseyrail', 'Merseyrail'),
    (r'New Measurement Train|Test Train', 'Network Rail'), (r'Freight|Class 66|Class 70', 'Freight'),
]

UNDERGROUND = r'Underground|Circle Line|District Line|Hammersmith & City|Metropolitan Line|Bakerloo|Victoria Line|Jubilee|Central Line|Northern Line|Piccadilly Line'

# per-video overrides: field=value pairs separated by ';'
OVERRIDES = {
    'pg34JpOIC4M': 'category=heritage;operator=Welsh Highland Railway',
    'vSdUJPL1QJI': 'category=freight;operator=Freight (Class 66)',
    '8W06Z7k0Cw4': 'category=archive', 'IXb00Poh3Q4': 'category=suburban',
    'WA4PS4CGEVg': 'category=test_train;operator=Network Rail', 'jgM5c6t71sU': 'category=test_train;operator=Network Rail',
    'Np86PUbHkzY': 'category=test_train;operator=Network Rail', 'URAke-x2fwA': 'category=test_train;operator=Network Rail',
    'GPtmygWOhjU': 'category=test_train;operator=Network Rail', 'USCKAIxX6Qw': 'category=test_train;operator=Network Rail',
    'tNj1tobDaps': 'category=metro;view=front', '1hZiirxA8ko': 'category=metro;view=front', 'lcf1O9ER3aQ': 'category=metro;view=front',
    'qR2Gr5aVZ4Y': 'category=metro', 'IMjf3YBQ-e0': 'category=metro;view=front', 'uFef2OovGqM': 'category=metro',
    'Tz0nnWGj21g': 'category=metro', 'qtcaiEbRzxc': 'category=metro',
    'UrF8D05tlUE': 'country=FR;category=foreign;coverage=partial', 'Qj16HZpVbHw': 'country=FR;category=foreign;coverage=partial',
    'bWPvd0wIN-c': 'country=FR;category=foreign;coverage=partial', 'lxOJx0lUxHg': 'country=FR;category=foreign;coverage=partial',
    '6WvE0vjmDTU': 'country=FR;category=foreign', 'mIEjWY9-23U': 'country=FR;category=foreign',
    'izxEyA-Fclc': 'category=intercity;operator=Eurotunnel;coverage=partial',
    'cvoh9l895rE': 'country=IE', 'mZ4TbHFXWis': 'country=NI;view=passenger', 'w-BB5evy4CA': 'country=IE;view=passenger',
    'kvPXMKhaYgg': 'country=NI;category=heritage', 'LREohW0975s': 'country=IM;category=rack', 'GrWXmMXq-ck': 'country=IM;category=rack',
    'elcpMHIv0_Y': 'category=rack', 'kHQXnLjiNZ8': 'category=rack', 'Cz6J5YfYUp8': 'category=rack;view=passenger',
    'KQ6Kj6dTgJU': 'category=rack', 'aLcZp3FhxP4': 'category=intercity;operator=LNER',
    'OSaAuSO9hM8': 'view=passenger', 'Ugf4aSWNbMw': 'view=passenger', 'K0sFARTElnA': 'view=passenger', 'gd9uOf_nmis': 'view=passenger',
    'HNprLC0r-mI': 'view=passenger', 'eQwO68W7QLI': 'view=passenger', 'EOl7xWma390': 'view=passenger', 'fuJhCMFxd7Y': 'view=passenger',
    'I6xccflC8Ms': 'view=passenger', '-OYnDPdLgO4': 'view=passenger', '-PEaCcrGblA': 'view=passenger', 'G8bpMij_nkw': 'view=passenger',
    'YgOJGhUon1E': 'view=passenger', 'I8QRZUTUQY4': 'view=passenger', 'YCiKqMVY4SQ': 'view=passenger', 'OQQdzJ3Frac': 'view=passenger',
    'gJpgnn7xwAo': 'view=passenger', 'IQ10YOIUoUE': 'view=passenger', 'i8si3-9WRes': 'view=passenger', 'dPElPanKtVA': 'view=passenger',
    'ub6F1ipcxuI': 'view=passenger;coverage=compilation', 'XEtELaIaVXs': 'coverage=compilation;scope=out',
    'x-rX0OgwrXo': 'category=heritage', 'Ociic-nIr_8': 'category=heritage;operator=Class 37 railtour',
    'HbiB6nGb94E': 'category=heritage;operator=Class 37 railtour',
    'jI3Yo-MA__o': 'coverage=partial', 'PFcDvWzR-80': 'coverage=partial', 'pg34JpOIC4M_': '',
    'LAnQsoX_oqg': 'category=archive;operator=London Underground (archive)', 'ERa84X3GNjg': 'category=suburban;operator=Merseyrail',
    'aVNR9O9hI2k': 'scope=out', 'C0Kmlk9jgCI': 'scope=out', 'JVdtmuiMnEo': 'scope=out', 'XCM5KpBtuSQ': 'scope=out',
    'h4WY5nOIVNc': 'scope=out', 'KcMMWNtrcfQ': 'scope=out', 'uFHgH3c8QTo': 'scope=out', 'T3-zFMWYBAQ': 'scope=out',
    '95KWQsrKAnc': 'scope=out', 'tnkTPm0NYBI': 'scope=out', 'jUhS0etllSM': 'scope=out', 'E2G2HuqnRjY': 'scope=out',
    'qMEikRAnMHM': 'scope=out', 'ijWA3_xeWWA': 'scope=out', 'yFNcWT3Qbpw': 'scope=out', 'NApTOIuLjfw': 'scope=out',
    'm9dVuHyc8tw': 'scope=out', '6wwO_9xKYQk': 'coverage=partial', 'nqZFB1iTpb0': 'coverage=partial',
    'BOIRCKW7-fw': 'scope=out', 'BCd2hwdfbyE': 'coverage=partial', 'HFH625LVmno': 'scope=out', '_i4Iirc-nKQ': 'scope=out',
    'ZL1a6c-RMko': 'scope=out', 'eK-nM2ZLgGg': 'scope=out', '3-oFQk_P7jg': 'scope=out', 'pmyHJ11Ylb4': 'scope=out',
    'NzBf2YwbngA': 'coverage=full', 'CSTVMuDjnxY': 'country=IE;category=suburban;operator=Iarnród Éireann DART',
    'nqZFB1iTpb0': 'category=tram;operator=London Trams', 'KQ6Kj6dTgJU': 'category=rack', '4_qqO6_I_Z0': 'scope=out',
    '0e9oN1jEZRQ': 'category=suburban;operator=Merseyrail', 'YgOJGhUon1E': 'category=suburban;operator=Merseyrail',
    'ztTpk1MbWKw': 'category=suburban;operator=West Midlands Railway', '-YNFC401LsE': 'category=suburban;operator=London Overground',
    'PFcDvWzR-80': 'category=suburban;operator=c2c;coverage=partial', 'eQwO68W7QLI': 'category=intercity;operator=CrossCountry',
    'izxEyA-Fclc': 'category=intercity;operator=Eurotunnel;coverage=partial', 'IFEDUYtpW2Y': 'category=tram;operator=Sheffield Supertram (archive)',
    'dh1plj2a4V4': 'category=archive', 'XiO9FuP8Yqo': 'category=archive', 'NjOXhhKa6XM': 'category=archive',
    '5ZcQH0eKTlQ': 'category=archive', 'x7ereuN6tX8': 'category=archive', '2KO0zaIlHgs': 'category=archive',
    'Jl9wBpvu86U': 'category=archive', '3bgbjx3aI7c': 'category=archive',
    'f9YqL6B74Yc': 'category=heritage;operator=Flying Scotsman (railtour)', 'dHypQlbrSzU': 'category=heritage;operator=Flying Scotsman (railtour)',
    'WPNp9IzqdpY': 'category=heritage', 'Krwqp1pUj-Y': 'category=heritage', '6GkEoNhoP_w': 'category=heritage', 'oQGISOhpmes': 'category=heritage',
    'dqKwALglPF0': 'category=heritage', 'ecDQAFwE4e0': 'category=heritage',
}

def classify(vid, ctx, meta):
    title = meta['title']; dur = meta['duration_s']; prompt = ctx.get('prompt', '') if ctx else ''
    text = ' '.join([title, ctx.get('h3', '') if ctx else ''])
    cat, country, op = 'regional', 'GB', ''
    for k, c, co, o in PROMPT_RULES:
        if k.lower() in prompt.lower():
            cat, country, op = c, co, o; break
    if re.search(UNDERGROUND, text) and cat in ('intercity', 'metro', 'archive', 'regional'):
        cat = 'metro' if cat != 'archive' else 'archive'; op = op or 'London Underground'
    if cat == 'tram' and re.search(r'Tyne|Metrocar|Subway', text): cat = 'metro'
    if country == 'EU':
        country = 'FR' if re.search(r'TGV|Paris|Nice', title) else 'DE' if re.search(r'ICE|Köln|München', title) else 'CH'
    for pat, o in OPERATOR_HINTS:
        if re.search(pat, title):
            op = o; break
    if not op: op = 'National Rail' if country == 'GB' else ''
    view = 'cab'
    if re.search(r'(?i)first class|1st class|experience|trip report|onboard|on board|night train|my first|ride along|travels?\b', title): view = 'passenger'
    if re.search(r'(?i)front seat|front window|pov', title) and cat in ('metro', 'tram'): view = 'front'
    cov = 'full'
    if re.search(r'(?i)\bpart\b|highlights|\(pt', title): cov = 'partial'
    if dur < 400: cov = 'clip'
    scope = None
    if re.search(r'(?i)preview|advert|\bAD$|members only|level crossing|observations|contrasts|control centre', title) or dur < 400:
        scope = 'out'
    rec = dict(category=cat, operator=op, view=view, coverage=cov, country=country, route='', origin='', destination='', note='')
    for kv in OVERRIDES.get(vid, '').split(';'):
        if '=' in kv:
            k, v = kv.split('=', 1); rec[k] = v
    if 'scope' in rec and rec['scope']:
        scope = rec['scope']
    if not scope:
        if rec['country'] not in ('GB',) or rec['category'] == 'foreign':
            scope = 'out' if rec['category'] == 'foreign' else 'extended'
        elif rec['category'] in ('intercity', 'regional', 'suburban', 'freight', 'test_train', 'archive'):
            scope = 'core'
        else:
            scope = 'extended'
        if rec['coverage'] in ('clip',) : scope = 'out'
    rec['scope'] = scope
    rec.pop('scope_', None)
    # route / endpoints from Gemini heading or title: "X to Y"
    src = (ctx.get('h3') or '') if ctx else ''
    for s in [src, title]:
        s2 = re.sub(r'^\d+\.\s*', '', s)
        s2 = re.sub(r'\[.*?\]|\(.*?\)', '', s2)
        for seg in re.split(r'\s+[|–—:]\s+|\s+-\s+|:\s+', s2):
            m = re.search(r'^(?:.*\bfrom\s+)?(.+?)\s+(?:to|→|⇒)\s+(.+?)(?:\s+(?:via|by|on|with|along|in|from|and)\b|\.|,|$)', seg.strip())
            if m:
                o = re.sub(r'^(?:Class \d+\S*\s+|Cab Ride\s*|Drivers? Eye View\.?\s*|A\d+\s+|VP185\s+|BR in the 1980s\s+|.*cab ride\s+)', '', m.group(1), flags=re.I).strip()
                d = re.sub(r'\s+(?:\d{4}|Full.*|Cab.*|Driver.*|Footplate.*|Station.*)$', '', m.group(2), flags=re.I).strip()
                if 2 < len(o) < 40 and 2 < len(d) < 40 and o[0].isupper():
                    rec['origin'], rec['destination'] = o, d; break
        if rec['origin']: break
    rec['route'] = (ctx.get('h3') or ctx.get('h2') or '')[:90] if ctx else ''
    rec['route'] = re.sub(r'^\d+\.\s*', '', rec['route'])
    return rec
