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

To: the access point's contact (CCISS, Ministry of Infrastructure and Transport). The address
isn't public without logging in: use the one on the CCISS contact page, or the Ministry's general
address, and ask them to forward it.

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

Citeremo la fonte nel modo da voi indicato. Restiamo a disposizione per qualsiasi chiarimento.

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

We will credit the source as you specify. Please let us know if you need anything else.

Yours faithfully,

[name]
Metranos Ltd
[email address]

## Next steps

1. Send the letter (and the planned letters to Trenitalia and RFI).
2. Turn on Lombardy with `IT_ENABLED` once the Refdata run's report looks right.
3. If access comes, read the Trenitalia NeTEx (a converter like Czechia's `tools/cisjr-gtfs.py`, for
   Italy's NeTEx profile) and add Italy nationally, Lombardy's Trenord file alongside.
