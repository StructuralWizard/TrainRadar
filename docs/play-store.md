# Google Play: what to enter (phase C6)

Everything Play Console asks for, ready to paste. App id `com.metranos.trainradar`,
developer **Metranos Ltd**, contact **support@metranos.com**, website
https://trainradar.pages.dev, privacy policy https://trainradar.pages.dev/legal/privacy.html.

Screenshots and the feature graphic: Actions → **Store assets** → Run workflow, then
download the `store-assets` artifact (built from the live app; see "Graphics" below).

## Store listing

Default language **Spanish (es-ES)**, translation **English (en-GB)**. Category
**Maps & Navigation**. Tags: Travel, Public transport. "Renfe" is not in the title or the
icon (we are not Renfe); it appears in the description as the data source.

### es-ES

- **App name** (≤ 30): `TrainRadar: trenes en directo`
- **Short description** (≤ 80): `Mapa en directo de los trenes de España, con su retraso, avisos y puntualidad.`
- **Full description** (≤ 4000):

```
TrainRadar muestra en un mapa, en directo, dónde están los trenes de Renfe en toda España —Cercanías, AVE, Avlo, Alvia, Media Distancia— y los de OUIGO según su horario, coloreados por su retraso: verde a su hora, ámbar con 5 minutos o más, rojo con 15 o más.

EN EL MAPA
• Cada tren con su dirección, velocidad, próxima parada y retraso, según Renfe o estimado por GPS.
• Estaciones con próximas salidas y trenes que se acercan.
• Avisos de Renfe (obras, huelgas, incidencias) en el mapa y por línea.
• Busca por número de tren o línea; mapa normal o satélite.
• ¿Voy en este tren?: con tu ubicación, la app adivina en qué tren vas (tu ubicación no sale del teléfono).

GRATIS
• Todo lo anterior, sin cuentas, sin anuncios.
• 2 favoritos (trenes o estaciones) y la puntualidad de cada línea en los últimos 7 días.

TRAINRADAR PRO (suscripción mensual)
• Favoritos ilimitados.
• Avisos de retraso de tus trenes favoritos, también con la app cerrada, y widget para la pantalla de inicio.
• Mis viajes: registro de tus trayectos con el retraso en cada parada, resumen para reclamar a Renfe, CSV e imagen para compartir.
• Historial completo de puntualidad de líneas, trenes y estaciones (hasta 12 meses).
• Trayecto habitual: la app abre con tus próximos trenes.
• Detalles de vía: pendiente y perfil de altura, velocidad máxima, electrificación, trenes anterior y siguiente.

PRIVACIDAD
Sin cuentas, sin anuncios, sin rastreo. Tus favoritos y viajes se guardan solo en tu teléfono (y en la copia de seguridad de Android). TrainRadar es de código abierto: https://github.com/StructuralWizard/TrainRadar

DATOS
Datos abiertos de Renfe Operadora (CC BY 4.0) y del Punto de Acceso Nacional de transportes (MITRAMS). Mapa © OpenStreetMap, OpenFreeMap. TrainRadar no está afiliado a Renfe, Adif ni OUIGO; los datos pueden contener errores y retrasos.
```

### en-GB

- **App name** (≤ 30): `TrainRadar: live trains Spain`
- **Short description** (≤ 80): `Live map of Spain's trains with their delay, alerts and punctuality.`
- **Full description**:

```
TrainRadar shows on a map, live, where Renfe's trains are across Spain —Cercanías, AVE, Avlo, Alvia, Media Distancia— and OUIGO's by their timetable, coloured by delay: green on time, amber 5 minutes or more late, red 15 or more.

ON THE MAP
• Every train with its direction, speed, next stop and delay, as published by Renfe or estimated from GPS.
• Stations with the next departures and approaching trains.
• Renfe's notices (works, strikes, disruptions) on the map and per line.
• Search by train number or line; standard or satellite map.
• Am I on this train?: with your location, the app works out which train you're on (your location never leaves the phone).

FREE
• All of the above, no accounts, no ads.
• 2 favourites (trains or stations) and each line's punctuality over the last 7 days.

TRAINRADAR PRO (monthly subscription)
• Unlimited favourites.
• Delay alerts for your favourite trains, also with the app closed, and a home-screen widget.
• My trips: a log of your journeys with the delay at each stop, a summary for a claim to Renfe, CSV and a shareable image.
• Full punctuality history of lines, trains and stations (up to 12 months).
• Commute: the app opens on your next trains.
• Track details: gradient and height profile, line speed, electrification, the trains ahead and behind.

PRIVACY
No accounts, no ads, no tracking. Your favourites and trips stay on your phone (and in Android's backup). TrainRadar is open source: https://github.com/StructuralWizard/TrainRadar

DATA
Open data from Renfe Operadora (CC BY 4.0) and Spain's National Access Point for transport (MITRAMS). Map © OpenStreetMap, OpenFreeMap. TrainRadar isn't affiliated with Renfe, Adif or OUIGO; the data may contain errors and delays.
```

### Graphics

| Asset | Size | Source |
|---|---|---|
| App icon | 512 × 512 PNG | `web/icons/icon-512.png` |
| Feature graphic | 1024 × 500 PNG | `store-assets` artifact: `feature-graphic.png` |
| Phone screenshots (2–8) | 1080 × 1920 | `store-assets` artifact: `phone-*.png` (map, train, station, favourites, history, Pro) |

## App content (Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy | https://trainradar.pages.dev/legal/privacy.html |
| Ads | **No**, the app contains no ads |
| App access | **Some functionality is restricted** (Play counts the Pro subscription). No sign-in details; leave "Sign in details … provide full access" unticked. Instructions: no account; Pro (`pro_monthly`) is bought in the app with Google Play Billing (Ajustes → TrainRadar Pro); reviewers can subscribe with a Play test payment method |
| Content rating | See below → expected **PEGI 3 / Everyone** |
| Target audience | **18 and over** is not required; choose **13–15, 16–17, 18+** (not designed for children; no child-directed content) |
| News app | No |
| COVID-19 contact tracing | No |
| Data safety | See below |
| Government app | No |
| Financial features | No |
| Health | No |

### Content rating questionnaire (IARC)

Category **"All other app types"** (reference/utility). Every question about violence,
sexuality, language, controlled substances, gambling: **No**. User interaction: users
can't communicate with each other, no user-generated content shared, location is **not**
shared with other users. Digital purchases: **Yes** (subscription). → PEGI 3, ESRB
Everyone, USK 0.

## Data safety form

**Does your app collect or share any of the required user data types?** → **No.**

Why that is correct (Google's definitions: "collected" = transmitted off the device):

- **Location:** used only on the phone ("Am I on this train?", nearest stations); never
  transmitted, logged or stored. Processing only on the device isn't "collection".
- **Favourites, trips, settings:** stored on the device only (and in the user's own
  Android backup, which Google's form doesn't count as collection by the developer).
- **Purchases:** handled by Google Play; the app receives only whether Pro is active.
  Google Play's own collection is covered by Google, not declared by the developer.
- **Network requests:** the app downloads public files (train positions, the history
  API, map tiles from OpenFreeMap, satellite images from IGN PNOA). They carry no user
  identifiers; the servers see an IP address as any web request does, and TrainRadar's
  own servers (Cloudflare) keep no logs of it beyond Cloudflare's standard operation.
  Third-party map servers: OpenFreeMap and IGN; no personal data is sent to them.
- **Crash reports / analytics:** none.

Security practices: **Data is encrypted in transit: Yes** (HTTPS only). **Users can
request data deletion:** not applicable (no data collected); the app has "Delete all my
data" for what it stores on the phone.

## Testing tracks

1. **Internal testing** (up to 100 testers, instant): your own account(s), to check the
   build and purchases with licence testers.
2. **Closed testing** (recommended even for an organisation account): 10–20 real users
   for one to two weeks. Create an email list (Testers tab), share the opt-in link. Ask
   them to use it on a few commutes, try favourites, alerts and the widget.
   (Personal developer accounts created after November 2023 must run a closed test with
   at least 12 testers for 14 days before production.)
3. **Production**: staged rollout 20 % → 50 % → 100 % over a few days, watching Android
   vitals (crashes, ANRs) in Play Console.

## Each release

1. Write `docs/releases/vX.Y.Z.md` (first line = title; a `## Google Play` section with
   the Play notes, ≤ 500 characters per language, in Play's `<es-ES>…</es-ES>` format).
2. Merge it, then Actions → **Release** → Run workflow → tag `vX.Y.Z`. It creates the
   GitHub release and attaches `trainradar-X.Y.Z-unsigned.aab` (versionCode
   X·10000+Y·100+Z) and the Play notes.
3. Download the AAB, sign it (`docs/android.md` → Release build → jarsigner), upload it
   in Play Console, paste the notes, roll out.
