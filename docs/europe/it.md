# Italy (it)

Europe/Rome · Italian · UIC 83. The overview is in [south-north.md](south-north.md#italy-it).

## Where it stands (23 Nov 2026)

- **Built: Lombardy only, by timetable.** Trenord and Malpensa Express, from Regione Lombardia's
  open data portal: "Orario Ferroviario Regionale Gtfs" (dataset `3z4k-mxz9` on
  dati.lombardia.it), CC BY 4.0, no registration, updated every few days. The file also holds
  Trenord's replacement buses, which `tools/gtfs-rail.py` cuts out. Trenord's trips have no
  `trip_short_name`: the train number is the start of the trip id (`10512A-…`). Region `it`,
  hidden (`?country=it`), switch `IT_ENABLED`.
- **The rest of Italy: waiting.** The national access point (`cciss.it/nap/mmtis/`, run by
  CCISS for the Ministry of Infrastructure and Transport) puts its whole catalogue behind a login.
  Since 1 October 2021 private citizens can only sign in with SPID, Italy's public digital identity.
  So we couldn't see whether the national Trenitalia NeTEx dataset ("OAP Trenitalia – NeTEx
  Livello 1") exists, nor its licence. The letter below asks for access and the terms.
- **Live data: none.** ViaggiaTreno and RFI's station-board endpoints are unofficial, with no
  licence, and Trenitalia has gone to court over its data before. Not used.

## Letter to the national access point

To: **div4.dgssa@mit.gov.it**, the division of the Ministry of Infrastructure and Transport that
runs CCISS (Directorate-General for Road Safety and Road Haulage, Division 4, Via Giuseppe Caraci
36, 00157 Roma; listed on cciss.it's contact page). Its certified address,
dg.ssa-div4@pec.mit.gov.it, takes mail from other certified (PEC) addresses: only if the first
goes unanswered. The access point itself publishes no contact, so the letter asks for it to be
forwarded.

**Oggetto: Accesso ai dati ferroviari del Punto di Accesso Nazionale (Regolamento delegato (UE) 2017/1926)**

Gentili Signore e Signori,

scriviamo per conto di Metranos Ltd, società che sviluppa TrainRadar (mytrainradar.com), una
mappa dei treni in circolazione e un'app per Android. TrainRadar mostra oggi i treni di Spagna e
di diversi altri paesi europei, a partire dai dati pubblicati dai rispettivi punti di accesso
nazionali, e vorremmo includere l'Italia.

Sul Punto di Accesso Nazionale (www.cciss.it/nap/mmtis/) il catalogo è visibile solo dopo
l'accesso, che per i privati richiede SPID. La nostra società ha sede fuori dall'Italia e non
dispone di SPID. Vi chiediamo quindi:

1. come può un'impresa estera ottenere un accesso al catalogo e ai dati;
2. se il catalogo comprende l'orario nazionale di Trenitalia (il dataset «OAP Trenitalia – NeTEx
   Livello 1») e quello di Italo, e con quale copertura;
3. con quale licenza o condizioni d'uso sono pubblicati questi dati, in particolare se è
   consentito il riutilizzo in un servizio commerciale (un'app con un'edizione a pagamento), e con
   quale attribuzione;
4. se il Punto di Accesso pubblica, o pubblicherà, dati in tempo reale sulla circolazione dei
   treni (ritardi, soppressioni, binari), come previsto dal Regolamento delegato (UE) 2017/1926.

Citeremo la fonte nel modo da voi indicato. Se la richiesta non è di vostra competenza, vi
saremmo grati se poteste inoltrarla all'ufficio che gestisce il Punto di Accesso Nazionale
multimodale. Restiamo a disposizione per qualsiasi chiarimento.

Cordiali saluti,

[nome e cognome]
Metranos Ltd
[indirizzo email]

*English, for reference:*

**Subject: Access to rail data on the National Access Point (Delegated Regulation (EU) 2017/1926)**

Dear Sir or Madam,

We are writing on behalf of Metranos Ltd, which develops TrainRadar (mytrainradar.com), a map of
the trains running and an Android app. TrainRadar shows Spain's trains and those of several other
European countries today, from the data their national access points publish, and we would like
to include Italy.

On the National Access Point (www.cciss.it/nap/mmtis/), the catalogue is only visible after
signing in, which for private individuals needs SPID. Our company is based outside Italy and has
no SPID. We would therefore like to ask:

1. how a company based abroad can get access to the catalogue and the data;
2. whether the catalogue includes Trenitalia's national timetable (the dataset "OAP Trenitalia –
   NeTEx Livello 1") and Italo's, and with what coverage;
3. under what licence or terms of use these data are published, in particular whether reuse in a
   commercial service (an app with a paid edition) is allowed, and with what attribution;
4. whether the Access Point publishes, or will publish, real-time train running data (delays,
   cancellations, platforms), as Delegated Regulation (EU) 2017/1926 provides.

We will credit the source as you specify. If this isn't for your office, we would be grateful if
you could forward it to the office that runs the multimodal National Access Point. Please let us
know if you need anything else.

Yours faithfully,

[name]
Metranos Ltd
[email address]

## Letter to Trenitalia

To: Trenitalia S.p.A., Piazza della Croce Rossa 1, 00161 Roma. Trenitalia publishes no address for
data or business requests: send it to **areaclienti@trenitalia.it** (its customer contact) asking
for it to be forwarded, and a copy to FS Italiane's external relations,
**relazioniesterneterritoriali@fsitaliane.it** (both listed on their sites, Nov 2026).

**Oggetto: Uso dei dati di orario e di circolazione dei treni Trenitalia in TrainRadar**

Gentili Signore e Signori,

scriviamo per conto di Metranos Ltd, società che sviluppa TrainRadar (mytrainradar.com), una
mappa dei treni in circolazione e un'app per Android, oggi disponibile per la Spagna e per diversi
altri paesi europei a partire dai dati aperti pubblicati dai gestori e dai punti di accesso
nazionali. Vorremmo mostrare anche i treni di Trenitalia, citando sempre Trenitalia come fonte.

Vi chiediamo cortesemente:

1. **Orario:** se l'orario di Trenitalia è disponibile come dato aperto (per esempio in NeTEx sul
   Punto di Accesso Nazionale, www.cciss.it) e con quale licenza, in particolare se è consentito il
   riutilizzo in un servizio commerciale (un'app con un'edizione a pagamento);
2. **Tempo reale:** se esiste un canale ufficiale per ricevere i ritardi, le soppressioni e i
   binari dei treni (un'API o un flusso GTFS-Realtime o SIRI), e a quali condizioni. Non useremo
   servizi non ufficiali senza il vostro consenso;
3. **Attribuzione:** come desiderate essere citati.

Siamo disponibili a firmare un accordo d'uso e a rispettare i limiti di traffico che indicherete.
Se la richiesta non è di vostra competenza, vi saremmo grati se poteste inoltrarla all'ufficio
responsabile dei dati.

Cordiali saluti,

[nome e cognome]
Metranos Ltd
[indirizzo email]

*English, for reference:*

**Subject: Using Trenitalia's timetable and train running data in TrainRadar**

Dear Sir or Madam,

We are writing on behalf of Metranos Ltd, which develops TrainRadar (mytrainradar.com), a map of
the trains running and an Android app, available today for Spain and several other European
countries from the open data that operators and national access points publish. We would like to
show Trenitalia's trains too, always crediting Trenitalia as the source.

We would like to ask:

1. **Timetable:** whether Trenitalia's timetable is available as open data (for example as NeTEx on
   the National Access Point, www.cciss.it) and under what licence, in particular whether reuse in
   a commercial service (an app with a paid edition) is allowed;
2. **Real time:** whether there is an official channel for trains' delays, cancellations and
   platforms (an API, or a GTFS-Realtime or SIRI feed), and on what terms. We won't use unofficial
   services without your consent;
3. **Credit:** how you would like to be credited.

We are happy to sign a data agreement and to keep to any traffic limits you set. If this isn't for
your office, we would be grateful if you could forward it to the office responsible for data.

Yours faithfully,

[name]
Metranos Ltd
[email address]

## Letter to RFI

To: Rete Ferroviaria Italiana S.p.A. Its contact page lists the head office's certified address,
reteferroviariaitaliana@pec.rfi.it, which takes mail from other certified (PEC) addresses, and
the press office, **ufficio.stampa@rfi.it**. Without PEC, send it to the press office asking for it
to be forwarded.

**Oggetto: Dati di circolazione dei treni e avvisi di RFI in TrainRadar**

Gentili Signore e Signori,

scriviamo per conto di Metranos Ltd, società che sviluppa TrainRadar (mytrainradar.com), una
mappa dei treni in circolazione e un'app per Android, oggi disponibile per la Spagna e per diversi
altri paesi europei a partire dai dati aperti dei gestori dell'infrastruttura e dei punti di
accesso nazionali. Vorremmo includere la rete italiana, citando sempre RFI come fonte.

Vi chiediamo cortesemente:

1. **Circolazione in tempo reale:** se RFI mette a disposizione, o intende farlo, i dati di
   circolazione dei treni di tutte le imprese ferroviarie (ritardi, soppressioni, binari),
   attraverso un'API o un flusso GTFS-Realtime o SIRI, anche tramite il Punto di Accesso Nazionale
   (Regolamento delegato (UE) 2017/1926), e a quali condizioni. Non useremo servizi non ufficiali
   (come i monitor di stazione) senza il vostro consenso;
2. **Avvisi:** se possiamo riutilizzare i feed RSS «Aggiornamenti in tempo reale» e «Avvisi ai
   viaggiatori» per mostrare gli avvisi sulla mappa, con il link alla pagina di RFI;
3. **Attribuzione e licenza:** con quale licenza sono pubblicati questi dati, in particolare se è
   consentito il riutilizzo in un servizio commerciale (un'app con un'edizione a pagamento), e
   come desiderate essere citati.

Siamo disponibili a firmare un accordo d'uso e a rispettare i limiti di traffico che indicherete.
Se la richiesta non è di vostra competenza, vi saremmo grati se poteste inoltrarla all'ufficio
responsabile.

Cordiali saluti,

[nome e cognome]
Metranos Ltd
[indirizzo email]

*English, for reference:*

**Subject: RFI's train running data and notices in TrainRadar**

Dear Sir or Madam,

We are writing on behalf of Metranos Ltd, which develops TrainRadar (mytrainradar.com), a map of
the trains running and an Android app, available today for Spain and several other European
countries from the open data that infrastructure managers and national access points publish. We
would like to include Italy's network, always crediting RFI as the source.

We would like to ask:

1. **Real-time running:** whether RFI provides, or plans to provide, train running data for every
   railway undertaking (delays, cancellations, platforms), through an API or a GTFS-Realtime or
   SIRI feed, including through the National Access Point (Delegated Regulation (EU) 2017/1926),
   and on what terms. We won't use unofficial services (such as the station monitors) without your
   consent;
2. **Notices:** whether we may reuse the RSS feeds "Aggiornamenti in tempo reale" and "Avvisi ai
   viaggiatori" to show notices on the map, linking to RFI's page;
3. **Credit and licence:** under what licence these data are published, in particular whether reuse
   in a commercial service (an app with a paid edition) is allowed, and how you would like to be
   credited.

We are happy to sign a data agreement and to keep to any traffic limits you set. If this isn't for
your office, we would be grateful if you could forward it to the office responsible.

Yours faithfully,

[name]
Metranos Ltd
[email address]

## Next steps

1. Send the three letters (access point, Trenitalia, RFI).
2. Turn on Lombardy with `IT_ENABLED` once the Refdata run's report looks right.
3. If access comes, read the Trenitalia NeTEx (a converter like Czechia's `tools/cisjr-gtfs.py`, for
   Italy's NeTEx profile) and add Italy nationally, Lombardy's Trenord file alongside.
