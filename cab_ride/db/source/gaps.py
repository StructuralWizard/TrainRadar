"""Gap check: for each European country, which notable rail networks have at least one cab ride in the DB.
Usage: python gaps.py <db> <out.md>
Matching is a regex over title + line + origin + destination + operator of videos with app_scope != 'out'."""
import re, sqlite3, sys, collections

NET = {
 'ES': [('Renfe AVE/Avlo high speed', r'AVE|Avlo|alta velocidad|S-?1\d\d'), ('Cercanías Madrid', r'Cercan.*Madrid|Madrid.*Cercan|C-?[1-9]\b.*Madrid'),
        ('Rodalies Catalunya', r'Rodalies|R[1-9]\d?\b'), ('FGC', r'FGC|Ferrocarrils de la Generalitat'), ('Euskotren', r'Euskotren'),
        ('FEVE / Cercanías AM', r'FEVE|ancho m[eé]trico'), ('Metro Madrid', r'Metro.*Madrid|Madrid.*Metro'), ('Metro Barcelona', r'Metro.*Barcelona|TMB'),
        ('FGV / Metrovalencia', r'FGV|Metrovalencia|TRAM d.Alacant'), ('Metro Bilbao', r'Metro Bilbao'), ('Sóller', r'S[oó]ller'), ('SFM Mallorca', r'SFM|Mallorca')],
 'PT': [('CP Alfa/IC Lisbon–Porto', r'Alfa Pendular|Intercidades|Lisboa.*Porto|Porto.*Lisboa'), ('CP Lisbon suburban', r'Sintra|Cascais|Azambuja|Sado|Fertagus'),
        ('CP Porto suburban', r'Guimar|Braga|Aveiro|Marco de Canaveses'), ('Douro line', r'Douro|Pocinho|R[eé]gua'), ('Algarve', r'Algarve|Lagos|Vila Real de Santo'),
        ('Beira lines', r'Beira|Guarda|Covilh'), ('Minho', r'Minho|Valen[cç]a|Viana'), ('Metro do Porto', r'Metro do Porto'), ('Lisbon Metro', r'Metro(politano)? de Lisboa')],
 'GB': [('Scotland (ScotRail)', r'ScotRail|Glasgow|Edinburgh|Inverness|Aberdeen|West Highland|Kyle|Far North'), ('Wales (TfW)', r'Transport for Wales|TfW|Cardiff|Cambrian|Heart of Wales|Conwy'),
        ('WCML', r'Avanti|West Coast|Euston'), ('ECML', r'LNER|East Coast|King.s Cross|Grand Central|Lumo'), ('GWR', r'GWR|Great Western|Paddington|Cornwall|Devon'),
        ('Southern/Southeastern', r'Southern|Southeastern|Brighton|Kent'), ('SWR', r'South Western|SWR|Waterloo'), ('Northern', r'Northern|Settle|Carlisle|Leeds|Manchester'),
        ('TransPennine', r'TransPennine|TPE'), ('CrossCountry', r'CrossCountry|XC'), ('London Underground', r'Underground|Tube|Central line|Jubilee|Victoria line|Elizabeth line'),
        ('Overground/Elizabeth', r'Overground|Elizabeth'), ('Merseyrail', r'Merseyrail'), ('Tyne & Wear Metro', r'Tyne|Metro.*Newcastle'), ('DLR', r'DLR|Docklands'),
        ('Northern Ireland Railways', r'NIR|Translink|Belfast|Derry|Londonderry|Larne|Bangor|Portrush|Coleraine|Lisburn|Newry')],
 'IE': [('Dublin–Cork', r'Cork'), ('Dublin–Galway/Westport', r'Galway|Westport|Ballina'), ('Dublin–Belfast Enterprise', r'Enterprise'), ('DART', r'DART'),
        ('Limerick/Waterford/Tralee', r'Limerick|Waterford|Tralee|Rosslare|Sligo'), ('Luas', r'Luas')],
 'FR': [('TGV', r'TGV|LGV|Ouigo|InOui'), ('TER', r'TER|Intercit'), ('Transilien/RER', r'Transilien|RER'), ('Paris Métro', r'M[ée]tro.*Paris|Paris.*M[ée]tro|RATP'),
        ('Corsica (CFC)', r'Corse|Corsica|CFC'), ('Mont-Blanc Express/Chamonix', r'Chamonix|Mont-Blanc|Saint-Gervais|Vallorcine'), ('Train Jaune', r'Train Jaune|Cerdagne|Font-Romeu|Latour-de-Carol'),
        ('Chemins de fer de Provence', r'Provence|Digne'), ('Lyon/Toulouse/Lille/Marseille metro', r'M[ée]tro.*(Lyon|Toulouse|Lille|Marseille|Rennes)'), ('Trams', r'[Tt]ram')],
 'BE': [('SNCB IC/L', r'SNCB|NMBS|IC\b'), ('Brussels metro/tram', r'STIB|MIVB|Bruxelles.*m[ée]tro|Brussel.*metro'), ('Kusttram', r'Kusttram|Coast ?Tram'), ('Antwerp/Ghent tram', r'De Lijn|Antwerpen.*tram|Gent.*tram')],
 'NL': [('NS IC/Sprinter', r'NS\b|Sprinter|Intercity'), ('Arriva/Keolis regional', r'Arriva|Keolis|Qbuzz|Blauwnet|Valleilijn'), ('Amsterdam metro', r'Amsterdam.*metro|GVB'),
        ('Rotterdam metro', r'RET|Rotterdam.*metro'), ('RandstadRail/HTM', r'RandstadRail|HTM')],
 'LU': [('CFL', r'CFL|Luxemb'), ('Luxtram', r'Luxtram|tram')],
 'DE': [('ICE/IC', r'ICE|\bIC\b|Intercity'), ('Regional (RE/RB)', r'\bRE ?\d|\bRB ?\d|Regional'), ('S-Bahn Berlin', r'S-Bahn Berlin|Berlin.*S\d'), ('S-Bahn München', r'S-Bahn M[üu]nchen'),
        ('S-Bahn Hamburg', r'S-Bahn Hamburg'), ('S-Bahn Rhein-Ruhr/Köln', r'Rhein-Ruhr|S-Bahn K[öo]ln'), ('S-Bahn Stuttgart/Frankfurt', r'S-Bahn (Stuttgart|Rhein-Main|Frankfurt)|(Stuttgart|Frankfurt).*\bS ?\d|\bS ?\d+\b.*(Stuttgart|Frankfurt)'),
        ('U-Bahn (any city)', r'U-Bahn|U\d\b'), ('Harz narrow gauge (HSB)', r'HSB|Brocken|Harz'), ('Zugspitzbahn', r'Zugspitz'), ('Sylt / Marsch', r'Sylt|Marschbahn'),
        ('Black Forest', r'Schwarzwald|H[öo]llental'), ('Trams/Stadtbahn', r'Stadtbahn|Stra[ßs]enbahn|Tram')],
 'AT': [('ÖBB Railjet / Westbahn', r'Railjet|Westbahn|WESTbahn'), ('Semmering', r'Semmering'), ('Arlberg', r'Arlberg'), ('Tauern', r'Tauern'), ('Brenner', r'Brenner'),
        ('Wien S-Bahn', r'S-Bahn Wien|Wien.*S\d'), ('Wien U-Bahn', r'U-Bahn Wien|Wien.*\bU\d|\bU\d.*Wien|Wiener U'), ('Mariazellerbahn', r'Mariazell'), ('Zillertalbahn', r'Zillertal'),
        ('Pinzgauer Lokalbahn', r'Pinzgau|Krimml'), ('Achensee / Schafberg', r'Achensee|Schafberg|St\. ?Wolfgang'), ('Koralmbahn', r'Koralm'), ('GKB / Graz', r'GKB|Graz'), ('Innsbruck trams/Stubaital', r'Stubai|Innsbruck.*Tram|IVB')],
 'CH': [('SBB mainline', r'SBB|CFF|FFS'), ('Gotthard', r'Gotthard'), ('Lötschberg/BLS', r'L[öo]tschberg|BLS'), ('RhB Albula/Bernina', r'Albula|Bernina|RhB'), ('MGB / Glacier Express', r'MGB|Glacier|Matterhorn'),
        ('Zentralbahn', r'Zentralbahn|zb\b|Br[üu]nig'), ('Jungfrau region (BOB/WAB/JB)', r'Jungfrau|BOB|WAB|Wengernalp|Lauterbrunnen|Grindelwald|Wengen|Scheidegg|Mürren'), ('MOB GoldenPass', r'MOB|GoldenPass'), ('Rack (Pilatus/Rigi/Gornergrat)', r'Pilatus|Rigi|Gornergrat'),
        ('Zürich S-Bahn', r'S-Bahn Z[üu]rich|Z[üu]rich.*\bS\d|\bS\d+\b.*Z[üu]rich'), ('Appenzell/SOB', r'Appenzell|SOB|Voralpen'), ('Centovalli/FART', r'Centovalli|Vigezzina|FART'), ('Lausanne metro', r'Lausanne.*(m[ée]tro|\bm[12]\b)|\bm2\b|Ouchy')],
 'IT': [('Frecciarossa/Italo', r'Frecciarossa|Italo|alta velocit'), ('Milan metro', r'Metro.*Milano|Milano.*metro|M[1-5]\b'), ('Rome metro', r'Metro.*Roma|Roma.*metro'),
        ('Circumvesuviana/EAV (Naples)', r'Circumvesuviana|EAV|Cumana|Circumflegrea|Sorrento|Torregaveta|Baiano|Sarno|Poggiomarino'), ('Sardinia', r'Sardegna|Sardinia|ARST|Trenino Verde'), ('Sicily', r'Sicilia|Sicily|Circumetnea'),
        ('Trenord/Malpensa', r'Trenord|Malpensa'), ('Vigezzina (Domodossola–Locarno)', r'Vigezzina|Centovalli|Domodossola.*Locarno|Locarno.*Domodossola'), ('Brennero/Alto Adige', r'Bolzano|Bozen|Brennero|Venosta|Vinschgau'), ('FNM/FER/FS Puglia', r'Ferrovie (del )?Sud Est|FSE|Bari Nord|FER\b|Ferrotramviaria')],
 'DK': [('DSB IC/Lyntog', r'DSB|IC\d|Lyntog'), ('S-tog', r'S-tog'), ('Copenhagen Metro', r'Metro.*K[øo]benhavn|Copenhagen.*Metro|\bM[1-4]\b'), ('Lokaltog/Nordjyske/Midttrafik', r'Lokaltog|Nordjyske|Midttrafik|Arriva'), ('Aarhus/Odense light rail', r'Letbane|Aarhus.*Let|Odense.*Let')],
 'NO': [('Bergensbanen', r'Bergensbanen|Oslo.*Bergen|Bergen.*Oslo'), ('Dovrebanen', r'Dovre'), ('Nordlandsbanen', r'Nordland|Bod[øo]'), ('Flåmsbana', r'Fl[åa]m|Myrdal'), ('Raumabanen', r'Rauma|[ÅA]ndalsnes'),
        ('Sørlandsbanen', r'S[øo]rlandsbanen|Stavanger|Kristiansand'), ('Ofotbanen', r'Ofot|Narvik'), ('Oslo T-bane', r'T-bane|Tbane|Holmenkollen|Frognerseteren|Sporveien'), ('Oslo local (Vy L/R)', r'Drammen|Lillestr|Ski\b|Østfold|Gj[øo]vik')],
 'SE': [('SJ X2000 / mainline', r'SJ|X2000|Snabbt'), ('Stockholm pendeltåg', r'pendelt[åa]g|Pendel'), ('Stockholm tunnelbana', r'tunnelbana|T-bana|[Gg]röna linjen|[Rr]öda linjen|[Bb]lå linjen'), ('Malmö / Öresund', r'[ÖO]resund|Malm[öo]|Skåne|Pågatåg'),
        ('Göteborg / Västtrafik', r'G[öo]teborg|Västtåg|V[äa]sttrafik'), ('Inlandsbanan', r'Inlandsban|Arvidsjaur|Östersund.*(Mora|Gällivare)|Mora.*Östersund'), ('Malmbanan / Kiruna', r'Malmban|Kiruna|Abisko'), ('Roslagsbanan/Saltsjöbanan', r'Roslagsban|Saltsj[öo]ban|Lidingö')],
 'FI': [('VR Pendolino/IC', r'Pendolino|InterCity|\bIC\b|VR\b'), ('Helsinki commuter', r'l[äa]hijuna|commuter|Kehärata|Ring Rail|Kauklahti|Kerava|Siuntio|Vantaankoski|\b[A-Z]-train'), ('Helsinki metro', r'metro.*Helsin|Helsin.*metro'), ('Lapland / Rovaniemi', r'Rovaniemi|Kolari|Kemij'), ('Tampere tram', r'Tampere.*(tram|ratikka)|ratikka')],
 'PL': [('PKP Intercity mainlines', r'Intercity|Pendolino|EIP|ED250|EP09|EU07|Gdynia|Warszawa.*(Kraków|Krakow|Poznań|Katowice|Gdynia)'), ('Warsaw suburban (KM/SKM/WKD)', r'Koleje Mazowieckie|SKM|WKD|Grodzisk|Otwock|Legionowo|Modlin|Sochaczew|Skierniewic|Radom|Działdowo|Siedlce'), ('Silesia', r'[ŚS]l[ąa]sk|Katowice|Gliwice|Częstochowa|Bielsko|Oświęcim|Rybnik|Zawiercie'), ('Pomerania / Baltic coast', r'Słupsk|Ustka|Szczecin|Koszalin|Kołobrzeg|Hel\b'),
        ('Warsaw metro', r'Metro.*Warsz|Warsaw.*metro'), ('Tricity (Gdańsk–Gdynia)', r'Tr[óo]jmiast|Tricity|PKM|Gdańsk|Gdansk|Gdynia|Sopot|Wejherowo'), ('Zakopane', r'Zakopane'), ('Koleje Dolnośląskie', r'Dolno[śs]l')],
 'CZ': [('ČD mainline', r'ČD|[ČC]esk[ée] dr[áa]hy|Pendolino|Railjet'), ('Prague metro', r'metro.*Praha|Prague.*metro|Praha.*metro|pražské metro|[Mm]etro [ABC]\b'), ('Esko Praha', r'Esko|S\d.*Praha'), ('RegioJet/Leo', r'RegioJet|Leo Express'), ('Narrow gauge (JHMD)', r'JHMD|úzkokolej')],
 'SK': [('ZSSK mainline', r'ZSSK|Bratislava|Ko[šs]ice'), ('Tatra electric (TEŽ)', r'Tatra|TE[ŽZ]|Štrbské'), ('Čierny Hron/heritage', r'[ČC]ierny Hron')],
 'HU': [('MÁV mainline', r'MÁV|MAV'), ('Budapest HÉV', r'HÉV|HEV'), ('Budapest metro', r'metro.*Budapest|Budapest.*metro|M[1-4]\b'), ('GySEV (Sopron/Szombathely)', r'GySEV|Raaberbahn|Sopron|Szombathely|Fertő|Pamhagen'), ('Balaton lines', r'Balaton'), ('Children\'s Railway', r'Gyermekvas|Children')],
 'SI': [('SŽ mainline', r'SŽ|Ljubljana|Maribor'), ('Bohinj', r'Bohinj|Jesenice|Nova Gorica'), ('Koper', r'Koper|Divača')],
 'HR': [('HŽ Zagreb–Split (Lika)', r'Lika|Split|Knin'), ('Zagreb–Rijeka', r'Rijeka'), ('Slavonia', r'Osijek|Vinkovci|Slavon'), ('Zagreb suburban', r'Zagreb'), ('Istria', r'Istr|Pula')],
 'RS': [('Belgrade–Novi Sad high speed', r'Soko|Novi Sad|brza pruga'), ('Belgrade–Bar', r'Beograd.*Bar|Belgrade.*Bar|Bar.*Beograd'), ('BG voz', r'BG ?voz'), ('Šargan Eight', r'[ŠS]argan'), ('Niš lines', r'Ni[šs]')],
 'BA': [('Sarajevo–Mostar–Ploče', r'Mostar|Plo[čc]e|Konjic'), ('Sarajevo–Zenica–Doboj', r'Zenica|Doboj'), ('Banja Luka / ŽRS', r'Banja Luka|ŽRS|Republike Srpske')],
 'ME': [('Bar–Bijelo Polje', r'Bijelo Polje|Bar\b|Kola[šs]in'), ('Nikšić–Podgorica', r'Nik[šs]i')],
 'MK': [('Skopje–Gevgelija', r'Gevgelija|Veles'), ('Skopje–Bitola', r'Bitola|Prilep'), ('Skopje–Kičevo / Tabanovce', r'Ki[čc]evo|Tabanovce|Kumanovo')],
 'XK': [('Pristina–Peja / Fushë Kosovë (Trainkos)', r'Pej|Prisht|Pristina|Fush')],
 'AL': [('Durrës–Tirana/Rrogozhinë', r'Durr[ëe]s|Rrogozhin|Tiran')],
 'GR': [('Athens–Thessaloniki', r'Thessaloniki|Θεσσαλον'), ('Athens Proastiakos', r'Proastiakos|Προαστιακ'), ('Athens metro', r'metro.*Ath|Athens.*metro|Μετρό'), ('Diakopto–Kalavryta', r'Kalavr|Diakopto'), ('Peloponnese / Patras', r'Patra|Kiato|Peloponn'), ('Thessaloniki metro', r'Thessaloniki.*metro')],
 'BG': [('BDŽ mainline', r'BD[ŽZ]|Sofia|Plovdiv|Varna|Burgas'), ('Septemvri–Dobrinishte narrow gauge', r'Septemvri|Dobrinishte|Rhodope'), ('Sofia metro', r'[Mm]etro.*Sofi|Sofi.*[Mm]etro|[Мм]етро')],
 'RO': [('CFR mainline', r'CFR|Bucure|Bra[șs]ov|Cluj|Constan'), ('Valea Prahovei', r'Prahov|Sinaia|Predeal|Ploie[șs]ti|C[âa]mpina|Bu[șs]teni|Comarnic'), ('Mocănița / narrow gauge', r'Moc[ăa]ni|Vaser|Vi[șs]eu|Moldovi[țt]a|Covasna|ingust'), ('Bucharest metro', r'Metrorex|[Mm]etro.*Bucure|Bucharest.*metro|Magistrala|Metroul'), ('Private operators (Regio Călători/Astra)', r'Regio C[ăa]l[ăa]tori|Astra|Transferoviar|Softrans')],
 'MD': [('Chișinău lines', r'Chi[șs]in[ăa]u|Ungheni|Ocni|B[ăa]l[țt]i')],
 'UA': [('UZ mainline / Intercity+', r'Intercity|Hyundai|Київ|Kyiv|Lviv|Львів|Odesa|Одес|Kharkiv|Харк'), ('Kyiv metro', r'metro.*Kyiv|Kyiv.*metro|Київськ.*метро|метро'), ('Kyiv city express', r'City Express|[Мм]іська електричка|[Гг]ородская электричка'), ('Carpathians', r'Carpath|Uzhhorod|Ужгород|Rakhiv|Рахів|Ворохта')],
 'BY': [('BCh mainline', r'Minsk|Мінск|Минск|Brest|Брест|Гомел|Gomel|Orsha|Орша'), ('Minsk metro', r'метро|metro'), ('Minsk City Lines', r'City Lines|[Гг]ородски[ея] лини|Руденск|Заслав|Смолевич')],
 'EE': [('Elron Tallinn lines', r'Elron|Tallinn|Tartu|Narva|Viljandi|P[äa]rnu|Haapsalu')],
 'LV': [('Riga suburban', r'R[īi]ga|Jūrmala|Jurmala|Tukums|Sigulda|Jelgava|Aizkraukle|Skulte')],
 'LT': [('LTG Link mainline', r'Vilnius|Kaunas|Klaip[ėe]da|Šiauliai|Siauliai|LTG'), ('Rail Baltica (Kaunas–Poland)', r'Rail Baltica|Marijampol|Mockava|Šeštokai|Sestokai')],
 'TR': [('YHT high speed', r'YHT|Y[üu]ksek H[ıi]zl|high.?speed'), ('Marmaray', r'Marmaray'), ('Istanbul metro', r'metro.*[İI]stanbul|[İI]stanbul.*metro|M\d\b'), ('İzmir İZBAN', r'[İI]ZBAN|[İI]zmir'),
        ('Ankara Başkentray', r'Ba[şs]kentray|banliy[öo]'), ('TCDD mainline (Doğu Ekspresi etc.)', r'TCDD|Do[ğg]u Ekspres|Kars|Ekspres')],
}

NO_FILE = {  # countries/territories with passenger rail but no Gemini doc and no harvest search
 'RU': 'Russia (European part) – Moscow metro/MCD/Lastochka, St Petersburg, Sapsan',
 'LI': 'Liechtenstein – ÖBB Feldkirch–Buchs line (4 stations)',
 'MC': 'Monaco – SNCF Nice–Ventimiglia line (Monaco-Monte-Carlo)',
 'GE': 'Georgia, Armenia, Azerbaijan – only if TrainRadar ever goes beyond the EU/EEA area',
}

def main(dbp, outp):
    db = sqlite3.connect(dbp)
    rows = db.execute("select country, app_scope, title||' '||coalesce(line_or_route,'')||' '||coalesce(origin,'')||' '||coalesce(destination,'')||' '||coalesce(operator,''), timestamp_quality from videos").fetchall()
    by = collections.defaultdict(list); cnt = collections.Counter(); prec = collections.Counter()
    for c, s, t, q in rows:
        if s == 'out': continue
        c = {'NI': 'GB', 'IM': 'GB'}.get(c, c)
        by[c].append(t); cnt[c] += 1; prec[c] += (q == 'precise')
    out = ['| Country | Videos (core+extended) | Precise timestamps | Networks with no video found |', '|---|---|---|---|']
    miss_all = {}
    for c in sorted(NET, key=lambda x: -cnt[x]):
        miss = [n for n, rx in NET[c] if not any(re.search(rx, t) for t in by[c])]
        miss_all[c] = miss
        out.append(f"| {c} | {cnt[c]} | {prec[c]} | {', '.join(miss) if miss else '—'} |")
    open(outp, 'w').write('\n'.join(out) + '\n')
    print('\n'.join(out))
    return miss_all

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
