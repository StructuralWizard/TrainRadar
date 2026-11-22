# Manual classification of every verified video.
# fields: category | operator | line_or_route | origin | destination | view | coverage | scope | note
# category: hsr, long_distance, regional, cercanias, cercanias_am, freight, test_train, heritage,
#           fgc, euskotren, metro, tram, rack, funicular, sfm, foreign
# view: cab | front | passenger | trackside | mixed
# coverage: full | partial | clip | compilation
# scope: core (Renfe/Adif network, ideal for TrainRadar), extended (other Spanish rail), out (foreign / not a ride)
C = """
yd849l2qkOw|hsr|Renfe AVE|LAV Madrid–Barcelona|Madrid Puerta de Atocha|Barcelona Sants|cab|full|core|Official Renfe real-time AVE
1lbIdHCs6SE|hsr|Renfe AVE|LAV Madrid–Barcelona|Barcelona Sants|Madrid Puerta de Atocha|cab|full|core|AVE S-103
raSOQlCphLw|hsr|Renfe AVE|LAV Madrid–Barcelona|Madrid Puerta de Atocha|Zaragoza Delicias|cab|full|core|Revista Vía Libre
gQw8GcCc2Po|long_distance|Renfe Alvia|Madrid–Irún line|Burgos Rosa Manzano|Miranda de Ebro|cab|full|core|S-130
KownUYBJv1Y|long_distance|Renfe|Madrid–Valencia conventional line|Albacete Los Llanos|Alcázar de San Juan|cab|full|core|
JUO1c1-dE4Y|cercanias_am|Renfe Cercanías AM (ex-FEVE)|Oviedo–Santander metre-gauge|Arriondas|Puente San Miguel|cab|full|core|
6iFfVpZwLJ4|hsr|Renfe AVE|Madrid–Asturias (AVE S-106 Avril)|Madrid Chamartín|Oviedo|passenger|partial|core|Review vlog, not cab
o8jJmEdPRL8|cercanias|Rodalies de Catalunya|R11|Portbou|Barcelona Sants|cab|full|core|S-447
dENiKh7k2Fc|long_distance|Renfe|Corredor Mediterráneo|València Nord|Barcelona Sants|cab|full|core|
pk7bPP38GSs|long_distance|Renfe Alvia|Madrid–Irún line|Burgos Rosa Manzano|Miranda de Ebro|cab|full|core|S-130
JNX4xygge4c|long_distance|Renfe Alvia|Bilbao–Miranda line|Bilbao Abando|Miranda de Ebro|cab|full|core|S-120
vRlZJcySroM|hsr|Renfe AVE|LAV Madrid–Levante|València Joaquín Sorolla|Madrid Chamartín|cab|full|core|AVE S-112
Svwiq9EO7kU|regional|Renfe Media Distancia|Linares–Almería line|Granada|Almería|cab|full|core|S-599
JAtvsj4f-r8|long_distance|Renfe|Castejón–Bilbao line|Miranda de Ebro|Zaragoza Delicias|cab|full|core|
dvyKBftb5S8|regional|Renfe|Chinchilla–Cartagena line|Cartagena|Albacete Los Llanos|cab|full|core|
oRRQxDjj_aM|regional|Renfe|Valencia–La Encina line|València Nord|La Encina|cab|full|core|
R5oIbMSW_W4|cercanias|Renfe Cercanías Cádiz|C-1|Cádiz|Jerez de la Frontera|cab|full|core|
2-dxeLSmMXs|hsr|Renfe AVE|LAV Madrid–Sevilla|Madrid Puerta de Atocha|Sevilla Santa Justa|cab|full|core|
p35Ieg5lrdQ|hsr|Renfe AVE|LAV Madrid–Valladolid|Valladolid Campo Grande|Madrid Chamartín|cab|full|core|
dlPidDOHbfw|hsr|Renfe AVE|LAV Madrid–Levante|Madrid Chamartín|València Joaquín Sorolla|cab|full|core|
fR8R4IqrapU|freight|Renfe Mercancías|LAV Barcelona–Perpignan (freight)|Barcelona|Perpignan|cab|full|core|Euro6000 (S-256)
PjyVT6mW5_M|freight|Renfe Mercancías|Tarragona–Barcelona|Tarragona|Barcelona|cab|full|core|S-256
6-TTvn3Dyu0|cercanias|Rodalies de Catalunya|R11 / R2N|Portbou|Barcelona Sants|cab|full|core|
_tR7mZzfa2A|regional|Adif line|Salamanca–Fuentes de Oñoro|Salamanca|Vilar Formoso|cab|full|core|
Ji_g6XwJcHI|freight|Renfe Mercancías|Barcelona–Reus|Barcelona|Reus|cab|full|core|
f3Z7emZTomw|regional|Renfe Media Distancia|Linares–Almería line|Almería|Granada|cab|full|core|
0RneE8KaFUA|freight|Freight (S-335)|Bilbao–Miranda line (Orduña)|Izarra|Amurrio|cab|partial|core|
O5_jGzlk4VY|cercanias|Renfe Cercanías Málaga|C-1|Málaga Centro-Alameda|Fuengirola|cab|full|core|
GjqSzHJc2dQ|regional|Adif line|Medina del Campo–Ávila–Villalba|Medina del Campo|Herradón-La Cañada|cab|full|core|
XV45zH0Au_w|cercanias_am|Renfe Cercanías AM (ex-FEVE)|Oviedo–Santander metre-gauge|Unquera|Cabezón de la Sal|cab|full|core|
5QW05WRGJjs|cercanias_am|Renfe Cercanías AM (ex-FEVE)|Ferrol–Oviedo metre-gauge|Ribadeo|Viveiro|cab|full|core|
3pxm1fY8Fbc|cercanias_am|Renfe Cercanías AM (ex-FEVE)|Ferrol–Oviedo metre-gauge|Luarca|Cudillero|cab|full|core|
DN-6hTNCJgM|cercanias|Renfe Cercanías Madrid|C-7|Pozuelo|Pozuelo|trackside|clip|out|35 s crossing clip
xoen34Vy2qU|cercanias_am|Renfe Cercanías AM (ex-FEVE)|Oviedo–Santander metre-gauge|Arriondas|Oviedo|cab|full|core|
K4oi9R8haOw|cercanias_am|Renfe Cercanías AM (ex-FEVE)|C-5a Gijón–Laviana|Gijón Sanz Crespo|Sotrondio|cab|full|core|
8amGnbXGIqY|cercanias_am|Renfe Cercanías AM (ex-FEVE)|C-4f Baiña–Collanzo area|Figaredo|Fuso de la Reina|cab|full|core|
YZTmP6zpuFw|cercanias_am|Renfe Cercanías AM (ex-FEVE)|Ferrol–Oviedo metre-gauge|Oviedo|Ferrol|passenger|partial|core|25-min review, NOT a 7h cab ride
L4hE-zX00Qk|cercanias_am|Renfe (ex-FEVE)|Línea de La Robla|Mataporquera|Vado Cervera|cab|full|core|
81yHFKU0RXA|cercanias_am|Renfe (ex-FEVE)|Línea de La Robla|San Feliz|Matallana de Torío|cab|full|core|
xcZsCigsAng|cercanias_am|Renfe (ex-FEVE)|Línea de La Robla|Vado Cervera|Guardo|cab|full|core|
nO9ABd9WCiQ|euskotren|Euskotren|E1|Bilbao Atxuri|Zumaia|cab|full|extended|
D8KoJUn7o5A|euskotren|Euskotren|E1|Donostia Amara|Bilbao|front|full|extended|
Ya1ah6TZ9zA|euskotren|Euskotren|E2 (Topo)|Donostia Amara|Hendaia|cab|full|extended|
ZxI-Ypfr41k|euskotren|Euskotren|E2|Donostia Amara|Lasarte-Oria|cab|full|extended|
9WgnObcsspQ|euskotren|Euskotren|E1|Zarautz|Arroa|cab|partial|extended|
Cx0_q92xdSw|metro|Euskotren (Metro Bilbao L3)|L3|Kukullaga-Etxebarri|Lutxana|cab|full|extended|
k524EM6pv1o|metro|Metro Bilbao|L1|Casco Viejo|Plentzia|front|full|extended|
H0hVHRfqS84|rack|FGC|Cremallera de Montserrat|Monistrol de Montserrat|Montserrat|cab|full|extended|
bDFpjYzVzVQ|rack|FGC|Cremallera de Montserrat|Montserrat|Monistrol de Montserrat|cab|full|extended|
dCt_ViEYw74|rack|FGC|Cremallera de Núria|Ribes de Freser|Núria|cab|full|extended|
03IszBgpcjU|rack|FGC|Cremallera de Núria|Ribes de Freser|Núria|mixed|full|extended|round trip, scenic
heDjgR_IHQg|rack|FGC|Cremallera de Núria|Núria|Ribes de Freser|cab|full|extended|
iXQ37JOq-kE|rack|FGC|Cremallera de Núria|Ribes-Enllaç|Núria|cab|partial|extended|8 min edit
l8nVSibvPqc|rack|FGC|Cremallera de Montserrat|Monistrol de Montserrat|Montserrat|front|full|extended|
iZSi7UiXI8s|fgc|FGC|S1|Barcelona Plaça Catalunya|Terrassa Nacions Unides|front|full|extended|
FvijaBg6WTY|fgc|FGC|R5|Barcelona Plaça Espanya|Manresa Baixador|front|full|extended|
ZdTV2bXOPw0|fgc|FGC|S1|Les Planes|Terrassa|cab|partial|extended|
pTg__kyILN4|fgc|FGC|R6|Barcelona Plaça Espanya|Igualada|front|full|extended|
sx8QmZQS1lw|fgc|FGC|S8|Barcelona Plaça Espanya|Martorell Enllaç|front|full|extended|
xDeOnfcU-Pc|fgc|FGC|RL2 Lleida–La Pobla de Segur|Lleida Pirineus|La Pobla de Segur|cab|partial|extended|10 min edit
2QcNtBnINK4|fgc|FGC|S3|Barcelona Plaça Espanya|Can Ros|front|full|extended|
Ydh3sIahP4E|metro|TMB Metro Barcelona|L9 Sud|Zona Universitària|Aeroport T1|front|full|extended|
26fd79xjSG4|metro|TMB Metro Barcelona|L10 Sud|Collblanc|ZAL Riu Vell|front|full|extended|
t8K6Qausf4E|metro|TMB Metro Barcelona|L9/L10|Collblanc|Can Tries Gornal|front|partial|extended|
jQzXYooKX6o|metro|TMB Metro Barcelona|L1|||cab|clip|extended|3 min
5uF4EfUhqCE|metro|TMB Metro Barcelona|L1/L3/L5|||cab|compilation|extended|
BBrtxlKqhuc|metro|TMB Metro Barcelona|L11|Trinitat Nova|Can Cuiàs|front|full|extended|
X-crF6F7Cw8|fgc|FGC|R5/R50|Manresa|Viladordis|cab|clip|extended|
aHrxlXqhRjc|rack|FGC|Cremallera de Núria|||trackside|clip|out|
J_8z4hzRBPo|fgc|FGC|S1/S2|Valldoreix|Valldoreix|trackside|clip|out|
KBFKMf18520|fgc|FGC|RL2 Lleida–La Pobla de Segur|Lleida|La Pobla de Segur|mixed|partial|extended|
RjCgN4MN9LA|fgc|FGC|RL2 Lleida–La Pobla de Segur|Lleida Pirineus|La Pobla de Segur|trackside|partial|out|
qwnejRZcjoo|freight|Renfe (1992 archive)|Rampa de Pajares|Puente de los Fierros|Busdongo|cab|full|core|archive 1992
YKD44GZvmLM|regional|Adif line|Rampa de Pajares|Busdongo|Puente de los Fierros|cab|full|core|
U_46pkrWHMw|regional|Adif line|Rampa de Pajares|Busdongo|Pola de Lena|cab|full|core|2023
SHI8zc3ejcY|freight|Renfe Mercancías|Asturias|||mixed|clip|out|
YrUMfEA7MtA|heritage|Renfe (269-604 special)|Despeñaperros|Almuradiel|Linares-Baeza|cab|partial|core|
Orr5ioSQ9AE|freight|Freight (S-335)|Tarragona–La Plana–Sant Sadurní|Tarragona|Sant Sadurní d'Anoia|cab|full|core|
SpgdOgq8z7w|freight|Freight (S-335)|Bilbao–Miranda line (Orduña)|Pobes|Izarra|cab|partial|core|snow
sHUCTk9qDiQ|regional|Adif line|Madrid–Sevilla conventional (Despeñaperros)|Almuradiel|Linares-Baeza|cab|full|core|
Ud1TruId4ys|freight|Freight|Valencia–Alcázar de San Juan (part 1)|València Fuente San Luis|Alcázar de San Juan|cab|partial|core|
MyLvwBRvczc|freight|Freight|Valencia–Alcázar de San Juan (part 2)|València Fuente San Luis|Alcázar de San Juan|cab|partial|core|
GEoe7NPx36s|freight|Renfe Mercancías|Madrid–Zaragoza|Madrid|Zaragoza|cab|partial|core|
QXgVnW-8aWI|cercanias|Renfe Cercanías Madrid|C-4b/C-4a|Colmenar Viejo|Parla|cab|partial|core|15 min
bdq61Qt2aq8|regional|Adif line|Palencia–Santander|Mataporquera|Reinosa|cab|full|core|
8ke6gcYuaQ8|cercanias|Renfe Cercanías Madrid|C-4b|Colmenar Viejo|Madrid|cab|partial|core|
-eOvZkoucvg|cercanias|Renfe Cercanías Madrid|C-4a|Alcobendas-S.S. de los Reyes|Madrid Chamartín|cab|full|core|
8rmizueISoE|cercanias|Renfe Cercanías Madrid|C-9|Cercedilla|Cotos|mixed|full|core|
vWzqdKOiekY|cercanias|Renfe Cercanías Madrid|C-10|Madrid Príncipe Pío|Villalba|cab|partial|core|20 min
AE_eZYrYgbQ|cercanias|Renfe Cercanías Madrid|C-7|Pitis|Las Rozas|cab|full|core|
Kp4qY0Vnafw|cercanias|Renfe Cercanías Madrid|C-9|Cercedilla|Puerto de Navacerrada|cab|full|core|
0nAtTIR8SLs|cercanias|Renfe Cercanías Madrid|C-2|Vicálvaro|Azuqueca|cab|full|core|
Fa7RO8GAKQM|cercanias|Renfe Cercanías Madrid|C-9|Puerto de Navacerrada|Cercedilla|cab|full|core|
Se4hEJxAYMk|regional|Renfe Media Distancia|Madrid–Ávila|Madrid|Ávila|cab|partial|core|22 min
vBnBC2yvoxg|metro|Metro de Madrid|L10|Príncipe Pío|Tribunal|cab|full|extended|
MMO5dKwcF88|metro|Metro de Madrid|several lines|||mixed|compilation|extended|
vrG3_VrCEAk|cercanias|Renfe Cercanías Madrid|Atocha–Chamartín tunnel|Madrid Atocha|Madrid Chamartín|cab|full|core|
r2Flhg5oCLE|metro|Metro de Madrid||||cab|clip|out|news clip
XSrQW0jx708|metro|Metro de Madrid||||mixed|clip|out|promo
0SdN9c1LZyk|regional|Renfe Media Distancia|Zaragoza–Canfranc|Zaragoza Delicias|Canfranc|cab|full|core|3h45
X4JPrcuipJM|regional|Renfe Media Distancia|Zaragoza–Canfranc|Jaca|Canfranc|cab|partial|core|
RP03CzkQkBw|regional|Adif line|Bobadilla–Algeciras|Bobadilla|Las Buitreras|cab|partial|core|
TkQgt9IFtJ4|regional|Renfe Media Distancia||||trackside|clip|out|
G6XA6uGU51A|heritage|AAFM special|Madrid–Cuenca|Tarancón|Tarancón|trackside|clip|out|
DCH5tiKGnqo|cercanias|Rodalies de Catalunya|R3 Transpirenaico|Ripoll|Latour-de-Carol|cab|full|core|
2LUaZgHgiyM|hsr|Renfe AVE|LAV Madrid–Levante (Cuenca–Alicante)|Cuenca Fernando Zóbel|Alicante Terminal|cab|full|core|
3WrinrneY9g|regional|Renfe Media Distancia|Alcoi–Xàtiva|Alcoi|Xàtiva|cab|full|core|
4VrAnnDq3lk|regional|Renfe Media Distancia|Zafra–Huelva|Jabugo-Galaroza|Huelva|cab|full|core|
gQFy1JOi8nM|freight|Logitren (S-335)|Teruel–Valencia|Teruel|Valencia|cab|partial|core|13 min
9B3bIDykOyo|metro|Metrovalencia (FGV)|L1|València Sud|Bétera|front|full|extended|
yZTZwco9Vac|freight|Freight (319.335)|Mérida–Los Rosales (Zafra–Los Rosales)|Zafra|Los Rosales|cab|full|core|
AHUIJRKSzGg|tram|Metrovalencia (FGV)|L8|Marítim|Neptú|front|full|extended|round trip
CTdg6q-1zeE|metro|Metrovalencia (FGV)|L10/L7/L1|Natzaret|Massarrojos|front|full|extended|
IeIegsMUi8o|metro|Metrovalencia (FGV)|L1|València Sud|Torrent|cab|full|extended|
vCl4KCxn3F8|metro|Metro de Sevilla|L1|Ciudad Expo|Olivar de Quintos|front|full|extended|
uOQjPqUQf-A|metro|Metro de Sevilla|L1 (part 1/3)|Ciudad Expo||front|partial|extended|
mfFyORwttwI|tram|Euskotren Tranbia|Bilbao tram|Atxuri|La Casilla|front|full|extended|
RloMP6BY3oI|tram|Euskotren Tranbia|Bilbao tram|Atxuri|La Casilla|cab|full|extended|
zthnGZ_czwA|tram|Euskotren Tranbia|Bilbao tram|||cab|full|extended|
PbxT2mtMDSg|heritage|Ferrocarril de Sóller|Palma–Sóller|Palma|Sóller|cab|full|extended|
KRX3bMZJ8BU|tram|Euskotren Tranbia|Vitoria-Gasteiz tram|||cab|clip|extended|
r17EGwC0-os|heritage|Ferrocarril de Sóller|Palma–Sóller|Palma|Sóller|cab|full|extended|loco cab
597ubxrJoME|tram|Euskotren Tranbia|Vitoria-Gasteiz tram|||mixed|clip|out|promo
FQyM1Rgsv48|heritage|Ferrocarril de Sóller|Palma–Sóller|Sóller|Palma|cab|full|extended|
6IeuREup_cU|heritage|Ferrocarril de Sóller|Palma–Sóller|Palma|Sóller|passenger|full|extended|
gV8cTyKeQHQ|tram|Tranvía de Sóller|Sóller–Port de Sóller|Sóller|Port de Sóller|cab|full|extended|
5Ul1XR_piFU|heritage|Ferrocarril de Sóller|Port de Sóller–Palma|Port de Sóller|Palma|passenger|full|extended|
pwyEAVsvupk|sfm|SFM|T1|Consell-Alaró|Palma|passenger|full|extended|
jxtzIy_MwEc|sfm|SFM|network overview|||mixed|compilation|extended|
XNN11n5FtGY|tram|Tranvía de Zaragoza|L1|Avenida de la Academia|Mago de Oz|front|full|extended|
5xRR7df2-bQ|sfm|SFM (Metro de Palma)|M1/M2|||mixed|compilation|extended|
Myilp-_oTWI|sfm|SFM (Metro de Palma)|M1|||passenger|partial|extended|
Hd51LKut48c|tram|Tranvía de Zaragoza|L1|||mixed|clip|out|
wXrvipC8Z0I|tram|Tranvía de Zaragoza|L1|||mixed|clip|out|20 s
iTG10vjwNY0|tram|TRAM d'Alacant (FGV)|L1|Alicante Luceros|Benidorm|front|full|extended|
gRmLbFJSvqw|tram|TRAM d'Alacant (FGV)|L3|Alicante Luceros|El Campello|front|full|extended|
8rDtYQC5eRg|tram|TRAM d'Alacant (FGV)|L9|Benidorm|Calp|front|full|extended|
AM1G8mQQ628|tram|TRAM d'Alacant (FGV)|L9|||mixed|partial|extended|
imcOjtkFDhI|tram|TRAM d'Alacant (FGV)|L4|||front|full|extended|
wS44lY2j5P0|tram|TRAM d'Alacant (FGV)|L3|Alicante|El Campello|front|partial|extended|
eY9MX-1NiSM|tram|TRAM d'Alacant (FGV)|L5|||front|full|extended|
bK1GQxvhuiE|tram|Tranvía de Murcia|L1|||mixed|clip|out|
bFpiJeVraGg|tram|TRAM d'Alacant (FGV)|L5|Porta del Mar|Plaza La Coruña|passenger|full|extended|round trip
EiucX7_VrEM|tram|Tranvía de Murcia|L1|||trackside|clip|out|
uGs7NVZBg3Q|tram|Tranvía de Murcia|L1|||mixed|full|extended|
ipZibemLoAU|tram|Tranvía de Murcia|L1|||trackside|clip|out|
CrWXh_RQgjo|hsr|iryo|Madrid–Barcelona|||mixed|clip|out|news clip
CssSCv4RGps|tram|Tranvía de Zaragoza|L1|||mixed|clip|out|promo
awkMuLSRmYc|tram|TRAM d'Alacant (FGV)|several|||mixed|compilation|out|
eHUgC7aXPGg|hsr|iryo|Barcelona–Madrid|Barcelona Sants|Madrid Puerta de Atocha|passenger|partial|core|vlog with cab visit
g1Q35lv8C2Q|tram|Tranvía de Murcia|L1|||mixed|clip|out|
rVDrVRSKaoU|hsr|iryo|LAV Madrid–Sevilla|Madrid Puerta de Atocha|Sevilla Santa Justa|passenger|partial|core|trip report
SIcFGz_Wepw|hsr|Ouigo|LAV Madrid–Barcelona|Madrid Puerta de Atocha|Barcelona Sants|passenger|full|core|window view, full trip
cKp3_Oa2-ZA|hsr|iryo|LAV Madrid–Barcelona|Barcelona Sants|Madrid Puerta de Atocha|passenger|partial|core|trip report
IfXIA15NZGQ|hsr|Ouigo|LAV Madrid–Barcelona|Barcelona Sants|Madrid Puerta de Atocha|passenger|partial|core|
EtUvr0fn7kY|foreign|Trenitalia|Rome–Milan|Roma Termini|Milano Centrale|cab|full|out|Italy
JNiGI_kcP4s|foreign|SNCF|Luxembourg–Paris|Luxembourg|Paris Est|cab|full|out|France
i3m30LG6llY|foreign|SNCF|Marseille–Strasbourg|Marseille|Strasbourg|cab|full|out|France
O8OdVjvfizU|long_distance|Renfe Alvia|Oviedo–León (Variante de Pajares)–Palencia–Burgos|Oviedo|Burgos|cab|full|core|S-130
Jc5WMT2ODLU|long_distance|Renfe|Variante de Pajares|||passenger|partial|core|
y2H9cq6CBEg|long_distance|Renfe Alvia|Oviedo–León (Variante de Pajares)–Burgos|Oviedo|Burgos|cab|full|core|music overlay
IIaGDKNbA6g|hsr|Renfe AVE|LAV Ourense–Santiago|Ourense|Santiago de Compostela|cab|partial|core|5 min highlights
okyLGUSUjnU|test_train|Adif|Variante de Pajares|||cab|clip|out|news clip
bJSLC-0fhNc|long_distance|Renfe Alvia|Madrid–Cáceres|Madrid Chamartín|Cáceres|passenger|full|core|3.5 h
AcooNN_srPY|test_train|Adif|LAV Pedralba–Ourense|||mixed|clip|out|news clip
aDza_pNhbUg|hsr|Renfe AVE|Madrid–Vigo (S-106)|||passenger|partial|core|
Xw6mH9YXXy4|hsr|Adif|LAV Extremadura|||mixed|clip|out|news clip
f9tN7iV-kMI|foreign|CP Portugal|Linha do Leste|Entroncamento|Badajoz|cab|full|extended|ends in Badajoz (Spain)
OXQsymJ-1Eo|hsr|Renfe|LAV Extremadura|||mixed|clip|out|news clip
C9mu0PTLel0|hsr|Renfe AVE|LAV Monforte del Cid–Murcia|Bif. Monforte del Cid|Murcia del Carmen|cab|full|core|
ggM3dU8Vbjg|heritage|Renfe (archive)|S-251 cab archive|||cab|clip|out|
GMZlaQoqDc4|heritage|Renfe (archive)|S-251 cab archive|||cab|clip|out|
kV3vJHCGsMU|heritage|Renfe (archive)|S-269 cab archive|||cab|clip|out|
VrvadDLH1b4|freight|Renfe (archive, S-269)|Tarragona–Samper de Calanda–Tarragona|Tarragona|Samper de Calanda|cab|full|core|6h17 round trip
NlnI94tC9dI|heritage|Renfe (archive, S-252)|Corredor Mediterráneo|Benicàssim|Benicàssim|cab|clip|out|58 s
FniO_w3olZw|cercanias|Renfe (archive, S-440)|Portbou–Cerbère|Portbou|Cerbère|cab|full|core|
N2iJJuNHyvw|heritage|Renfe (archive)|S-319 cab archive|||cab|clip|out|
LB3Tb_XbClc|heritage|Renfe|vía doble banalizada|||cab|clip|out|
34TxPR4AY38|heritage|Renfe (archive)|S-333 cab archive|||cab|clip|out|
bJ4IEkX3CA4|heritage|Renfe (archive)|S-333 cab archive|||cab|clip|out|
Th6ogjC-aII|heritage|Renfe (archive 1990)|Medina del Campo–Salamanca|Medina del Campo|Cantalapiedra|cab|partial|core|
kHbrFHtYGnA|long_distance|Renfe Trenhotel|Barcelona–A Coruña (Ep.1)|Barcelona Sants|Tarragona|cab|full|core|
vfru23dA_T0|heritage|Renfe (archive 1991)|Zamora|||trackside|clip|out|
O_jjNqzSU2Y|long_distance|Renfe Trenhotel|Barcelona–A Coruña (Ep.4)|Zaragoza Delicias|Logroño|cab|full|core|
FKC_x32swPE|long_distance|Renfe Talgo|Madrid–Almería|Madrid|Alcázar de San Juan|cab|partial|core|
GuRRXOXas-g|heritage|Renfe (archive steam)|Mikado 141F|||cab|clip|out|
rOg1UMK2C7U|heritage|Renfe (archive steam)|Mikado 141F|||cab|clip|out|
F7V6wGssqgY|heritage|Tren de la Fresa|Madrid–Aranjuez|Madrid|Aranjuez|front|full|core|
J1fkGEQJZUM|heritage|Tren de la Fresa (1991)|Madrid–Aranjuez|||mixed|partial|core|
GUZwlNtDpW0|heritage|Tren dels Llacs (FGC)|Lleida–La Pobla de Segur|||mixed|clip|out|
E7kIvaDol44|cercanias_am|Renfe Cercanías AM (ex-FEVE)|Santander–Bilbao metre-gauge|Marrón|Bilbao Concordia|front|full|core|
xtJ1mh8kk1Q|cercanias_am|FEVE (archive 1998)|Asturias–Santander–Bilbao|||mixed|compilation|core|
ReZwThsYLy8|heritage|Renfe|El Escorial station|El Escorial|El Escorial|trackside|partial|out|
ezh5GYgVyPM|heritage|Al Ándalus|Aranjuez|Aranjuez|Aranjuez|trackside|clip|out|
KAh16rQYnYs|heritage|AZAFT Tren Azul||||trackside|clip|out|
dgkkCohz7zY|heritage|Renfe (archive steam)|Confederación|||cab|clip|out|
c_7BN3Mr-gg|heritage|Expreso de La Robla||||trackside|clip|out|
aYX5vCbvfkc|heritage|Tren de la Fresa||||trackside|clip|out|
xAnkE6C-4cw|cercanias_am|Renfe (ex-FEVE)|Traslaviña station|Traslaviña|Traslaviña|trackside|partial|out|station video
0CefAP97fwk|cercanias|Renfe|Santander station|Santander|Santander|trackside|partial|out|station video
lyyjxAfjiAA|foreign|SNCF TER|Portbou–Perpignan|Portbou|Perpignan|cab|full|extended|starts in Portbou (Spain)
YAeq43S6Hq0|euskotren|Euskotren|E2 (Topo)|Hendaia|Donostia Amara|cab|full|extended|
GMQ91wTaP6c|foreign|SNCF TER|Hendaye–Bayonne|Hendaye|Bayonne|cab|full|out|
XGmrCKbN5qA|regional|Adif line|Fuentes de Oñoro border|Fuentes de Oñoro|Vilar Formoso|cab|clip|core|
byNe9EEv0Ik|long_distance|Renfe Alvia|Castejón–Bilbao line|Miranda de Ebro|Zaragoza Delicias|cab|full|core|S-120
EFNdUhAbp6k|foreign|CP Portugal|Linha do Minho|Valença|Porto Campanhã|cab|full|out|rear cab
-be9VKs1jiY|regional|CP (Tren Celta)|Vigo–Porto|Vigo Guixar|Porto Campanhã|passenger|partial|core|
ni4n7tJMo6Y|foreign|CP Portugal|Linha do Minho|Porto Campanhã|Valença|cab|full|out|
fKpxyhSpznw|long_distance|Renfe Alvia|Gijón–Valladolid|Gijón|Valladolid|cab|partial|core|music overlay
45OWLTr5jQo|long_distance|Renfe Alvia|Madrid–Irún line|Burgos Rosa Manzano|Miranda de Ebro|cab|full|core|S-130 (same trip as pk7bPP38GSs)
leOzhzo22uY|long_distance|Renfe Alvia|gauge changer|||passenger|clip|out|
E1onwXu2BKY|long_distance|Renfe Alvia|Valdestillas gauge changer|Valdestillas|Valdestillas|mixed|clip|core|
FEXqiBsBMEI|long_distance|Renfe|Roda de Barà gauge changer|Roda de Barà|Roda de Barà|cab|clip|core|
Wdjzwuj6COQ|hsr|Renfe AVE|Castelló–Gijón|||mixed|clip|out|
SC-zwwpGpe8|test_train|Adif|gauge changer|||mixed|clip|out|
XndcalvbSQY|test_train|Adif (S-162)|Madrid–Tarragona|Madrid|Tarragona|mixed|partial|core|
2nby1ZV6RVc|test_train|Adif (S-162)|Fuencarral–El Escorial|||trackside|clip|out|
pifxLcuk740|test_train|Adif (S-162)|Salamanca–Fuentes de Oñoro–Ávila|Salamanca|Ávila|mixed|partial|core|
AECgHPh_fG4|test_train|Adif (S-162)|Elda–Sax|||trackside|clip|out|
re3joBN1CBI|test_train|Adif (S-162)||||trackside|partial|out|
OS3pjAm8rvU|test_train|Adif (Talgo BT)||||trackside|clip|out|
ViEfdUpBp48|test_train|Adif (Talgo BT)|LAV Zamora–Sanabria|||mixed|partial|out|
VBYf1bWqKl8|test_train|Adif (Séneca)||||trackside|partial|out|
8c4vUBOT5tY|test_train|Adif (Talgo BT)|Pajares|||trackside|clip|out|
D8aZIrYFVKI|funicular|FGC|Funicular de Sant Joan|Montserrat|Sant Joan|cab|full|extended|
c8c-N7sde7c|test_train|Adif (Talgo BT)|Madrid Atocha|||trackside|clip|out|
etFio-Bo45I|funicular|FGC|Funicular de Sant Joan|Sant Joan|Montserrat|front|full|extended|
hzKQf9aSggI|funicular|FGC|Funicular de Sant Joan|||mixed|full|extended|
t5krhWf5IoA|funicular|FGC|Funicular de Vallvidrera|Peu del Funicular|Vallvidrera Superior|front|full|extended|
HjcDVnBr6Jk|funicular|FGC|Funicular de la Santa Cova|Montserrat|Santa Cova|front|full|extended|
2kRXcBVWpg4|funicular|Tibidabo|Cuca de Llum|||passenger|full|extended|
eDIUm84jrMo|funicular|Funicular de Artxanda|Artxanda|||passenger|full|extended|
AQbyvfCtCA8|funicular|Tibidabo|Cuca de Llum|||front|full|extended|
eIHvB_A7Rp0|funicular|Tibidabo|Cuca de Llum|||mixed|full|extended|
iTGOepBpMl4|funicular|Funicular de Artxanda|Artxanda|||front|full|extended|
nohe_1X1Clo|funicular|Tibidabo|Funicular del Tibidabo (old)|Plaça del Doctor Andreu|Tibidabo|front|full|extended|
jWbCEnv8aRk|funicular|Euskotren|Funicular de Larreineta|Escontrilla|Larreineta|front|full|extended|
WoFihy5qUrc|funicular|Funicular de Artxanda|Artxanda|Bilbao|Artxanda|passenger|full|extended|
QIyj1cqlby0|funicular|Monte Igueldo|Funicular de Monte Igueldo|Donostia|Monte Igueldo|front|full|extended|
cPGfgqrca4w|funicular|Euskotren|Funicular de Larreineta|||mixed|full|extended|
ckD3BK1Us5Q|funicular|TMB|Funicular de Montjuïc|Paral·lel|Parc de Montjuïc|front|full|extended|
uNHz0kMnI7g|funicular|TMB|Funicular de Montjuïc|Paral·lel|Parc de Montjuïc|front|full|extended|
0La27h8Dkrg|funicular|Funicular de Bulnes|Bulnes|Bulnes|Poncebos|front|full|extended|
_ylWNK1NbYk|tram|Trambahía|T-1|Cádiz|Pelagatos|cab|full|extended|tram-train shares Renfe tracks Cádiz–Río Arillo
LF6Lo5GKS0w|cercanias|Renfe Cercanías Santander|C-1|Santander|Torrelavega|cab|full|core|
jIVIQ24tJVE|cercanias|Renfe Cercanías Cádiz|C-1|||mixed|clip|out|
G2mZAC5VBxQ|cercanias|Renfe Cercanías Santander|C-1|Santander|Reinosa|front|full|core|
OZMi2qVIUgs|cercanias_am|Renfe Cercanías AM Santander|C-2|Cabezón de la Sal|Santander|front|clip|out|32 s timelapse
iWpNYO5o9qU|cercanias_am|Renfe Cercanías AM Santander|C-2/C-3|||trackside|compilation|out|
5x6G5WQOvRc|regional|Renfe Proximidad|Cartagena–Murcia|Cartagena|Murcia del Carmen|front|full|core|
YZnZQlvz9Lc|cercanias|Renfe Cercanías Murcia/Alicante|C-2|Águilas|Murcia del Carmen|cab|full|core|
kQKurlffw2o|cercanias|Renfe Cercanías Murcia/Alicante|C-1|Murcia del Carmen|Alicante Terminal|front|full|core|
OPaCE_Lv3IM|cercanias|Renfe Cercanías Murcia/Alicante|C-3|Alicante Terminal|Sant Vicent Centre|cab|full|core|
cpYqUHOgGX4|tram|Trambahía|T-1|Cádiz|San Fernando|mixed|clip|out|
12DWIvBLDfE|cercanias|Renfe|Jerez station|Jerez de la Frontera|Jerez de la Frontera|trackside|partial|out|
ylwmZOYrjzc|tram|Trambahía||||trackside|clip|out|
D7vHaN-Mivk|cercanias|Renfe Cercanías Murcia/Alicante||||mixed|partial|out|
5qdnlj4nUeg|cercanias_am|Renfe Cercanías AM|Cartagena–Los Nietos|||trackside|clip|out|
BKtPRPRXV8A|cercanias_am|Renfe Cercanías AM|Cartagena–Los Nietos|Los Nietos|Cartagena|mixed|partial|core|
VZhB3BkLXiU|cercanias_am|Renfe Cercanías AM|Cartagena–Los Nietos|Los Nietos|Cartagena|mixed|partial|core|5 min vlog
NIolsmEql-E|tram|Metrotenerife|L1|Intercambiador|La Trinidad|front|full|extended|
Q_QJW0TcEQY|cercanias_am|Renfe Cercanías AM|Cartagena–Los Nietos|||trackside|clip|out|
HJ_JLbqTRuc|cercanias_am|Renfe Cercanías AM|Cartagena–Los Nietos|||mixed|clip|out|
YFcd9mORjSE|cercanias_am|Renfe Cercanías AM|Cartagena–Los Nietos|||mixed|compilation|out|
kWq90phFpqM|tram|Metrotenerife|L1/L2|||mixed|clip|out|
HRh-UkFo5a0|tram|Metrotenerife|L1|Santa Cruz de Tenerife|La Laguna|front|partial|extended|
YPbCf4XLa-U|tram|Metrotenerife|L1|||front|partial|extended|
n46E7Z_RHM0|tram|Metrotenerife|L1|||mixed|partial|extended|
8BQk-cPcanY|tram|Metrotenerife|L1|||cab|clip|extended|3-min timelapse
PEktG_ew2TM|tram|Metrotenerife|L1|||mixed|partial|extended|vlog
"""
CLASS = {}
for line in C.strip().splitlines():
    p = line.split('|')
    assert len(p) == 10, line
    CLASS[p[0]] = dict(zip(['category','operator','route','origin','destination','view','coverage','scope','note'], p[1:]))
