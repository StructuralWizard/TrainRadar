# Manual classification of the Portuguese videos.
# fields: category | operator | line_or_route | origin | destination | view | coverage | scope | note
C = """
sUcbMJhinwM|regional|CP Regional|Linha do Algarve|Vila Real de Santo António|Faro|cab|full|core|
OMYFsKnJmwc|regional|CP|Linha do Norte|Lisboa - Santa Apolónia|Pombal|cab|full|core|
tfz1VSaH36Y|regional|CP|Linha do Sul|Lisboa - Oriente|Grândola|cab|full|core|
QXzRVNT8dmw|regional|CP|Linha do Sul|Grândola|Santa Clara - Sabóia|cab|full|core|
EQv_vzJo1P0|regional|CP|Linha do Sul / Linha do Algarve|Santa Clara - Sabóia|Faro|cab|full|core|
MlHnOa7IdPw|suburban|CP Urbanos de Lisboa|Linha de Cascais|Cais do Sodré|Cascais|cab|full|core|round trip
e3Zp727gzII|regional|CP Regional|Linha do Douro|Marco de Canaveses|Régua|cab|full|core|
lebV_YteJrA|intercity|CP Alfa Pendular|Linha do Norte / Linha do Minho|Porto - Campanhã|Braga|cab|full|core|
Wi7_wKk5ioI|regional|CP|Linha do Norte|Pombal|Porto - Campanhã|cab|full|core|
KatVvbobsxQ|regional|CP Regional|Linha do Douro|Porto - Campanhã|Régua|cab|full|core|
fyZaMOeNuSs|suburban|CP Urbanos de Lisboa|Linha de Sintra|Sintra|Lisboa - Oriente|cab|full|core|
Uz2KmgK-ct4|regional|CP Regional|Linha do Douro|Régua|Pocinho|cab|full|core|
fhj-liZkBS4|regional|CP Regional|Linha do Algarve|Lagos|Faro|cab|full|core|
4YdedEd0nEA|regional|CP|Linha do Sul / Linha do Algarve|Messines-Alte|Faro|cab|full|core|rear cab
YUn0Rdiqmhs|suburban|CP / Fertagus corridor|Linha do Sul (Campolide–Setúbal)|Campolide|Setúbal|cab|full|core|rear cab
r0OvVVr3aIg|regional|CP|Linha da Beira Alta|||cab|partial|core|10 min
wtW7ZhVFC0w|regional|CP|Linha de Évora|Casa Branca|Évora|cab|full|core|rear cab
KWgoQgMjt_E|regional|CP|Linha da Beira Baixa|Guarda|Castelo Branco|cab|full|core|rear cab
7GBUXIavRmk|regional|CP Regional|Linha do Algarve|Lagos|Faro|passenger|partial|core|vlog
ZJD9alIs3o8|regional|CP|Linha da Beira Baixa|Entroncamento|Castelo Branco|cab|full|core|rear cab
mK_HPjBo-aE|suburban|CP Urbanos de Lisboa|Linha de Sintra|Lisboa - Rossio|Mira Sintra-Meleças|cab|full|core|
-LJ4LBrWS5w|suburban|CP Urbanos de Lisboa (2003)|Linha de Cascais|Cais do Sodré|Cascais|cab|full|core|archive 2003
tHOe-8CUlMM|tram|Carris|Elétrico 28 / 24|||passenger|full|extended|vlog
0Xwnh6quADk|suburban|CP Urbanos de Lisboa|Linha de Cintura / Linha do Norte|Campolide|Alverca|cab|full|core|
fwdLA8q-EDA|suburban|CP Urbanos de Lisboa|Linha do Norte|Lisboa - Santa Apolónia|Azambuja|cab|full|core|
MfZArQ-6ezE|heritage|CP special (Allan 360)|Linha do Oeste|||cab|full|core|2016 special
L9kCKJNWP78|regional|CP (2003)|Linha do Oeste|Cacém|Caldas da Rainha|cab|partial|core|archive 2003
CdJKEW-ArHI|regional|CP (2009)|Linha do Vouga|Sernada do Vouga|Aveiro|cab|full|core|archive 2009
PLkyFeMHCgI|intercity|CP Intercidades|Linha do Sul / Linha de Évora|Lisboa - Oriente|Évora|cab|full|core|rear cab
JrXRtGWqw5M|intercity|CP Alfa Pendular (2003)|Linha do Norte|Taveiro|Lisboa - Santa Apolónia|cab|full|core|archive 2003
gwZedBsnniI|test_train|IP inspection vehicle|Linha do Norte|Aveiro|Mogofores|cab|full|core|
FXH6AQFXo9g|test_train|IP inspection vehicle|Linha do Minho|Valença|Carvalha|cab|full|core|
vZPb38YqZWE|regional|CP|Porto Campanhã–São Bento|Porto - Campanhã|Porto - São Bento|cab|full|core|
GBrpRQgQkrg|test_train|IP inspection vehicle|Linha do Minho|Contumil|Porto - Campanhã|cab|full|core|
bg64rdnJw_g|suburban|CP Urbanos de Lisboa|Linha de Cintura / Linha do Norte|Alcântara-Terra|Castanheira do Ribatejo|cab|full|core|
1eeXE3bU_yc|suburban|CP Urbanos de Lisboa|Linha de Cascais|Cais do Sodré|Cascais|passenger|full|core|
ECTZut8N4Qo|regional|CP|Linha da Beira Baixa|Guarda|Fratel|cab|compilation|core|edited station highlights
FMiCtDN5nLg|test_train|IP inspection vehicle|Linha de Guimarães|Guimarães|Vila das Aves|cab|full|core|
GZBGeBa71J8|regional|CP|Campolide / Santa Iria|||trackside|clip|out|
ArTAyRENkUk|test_train|IP inspection vehicle|Linha de Guimarães|Lordelo|Guimarães|cab|full|core|
0EA_Zj5U97M|tram|Carris|Elétrico 18E|Cemitério da Ajuda|Cais do Sodré|cab|full|extended|round trip
pNT2kuzodJc|metro|Metro do Porto|Linha D|Hospital São João|Santo Ovídio|cab|full|extended|
TteMwwdHByw|tram|STCP|Elétrico 1 (Porto)|Infante|Passeio Alegre|cab|full|extended|round trip
oFNQZ2lDYuA|metro|Metro do Porto|Linha F|Fânzeres|Senhora da Hora|cab|full|extended|
ghauR2hnjl8|intercity|CP Intercidades (2005)|Linha do Alentejo|Vendas Novas|Casa Branca|trackside|clip|out|
Bvm2OxUGrDU|intercity|CP Intercidades (2005)|Linha do Alentejo|Casa Branca|Beja|cab|full|core|archive 2005
ni4n7tJMo6Y|regional|CP|Linha do Minho|Porto - Campanhã|Valença|cab|full|core|
EFNdUhAbp6k|regional|CP|Linha do Minho|Valença|Porto - Campanhã|cab|full|core|rear cab
f9tN7iV-kMI|regional|CP|Linha da Beira Baixa / Linha do Leste|Entroncamento|Badajoz|cab|full|core|ends in Badajoz (Spain)
"""
CLASS = {}
for line in C.strip().splitlines():
    p = line.split('|')
    assert len(p) == 10, line
    CLASS[p[0]] = dict(zip(['category','operator','route','origin','destination','view','coverage','scope','note'], p[1:]))

SEQ_PT = {
 'lebV_YteJrA': 'Porto - Campanhã|Ermesinde|Trofa|Famalicão|Nine|Braga',
 'fyZaMOeNuSs': 'Sintra|Portela de Sintra|Algueirão-Mem Martins|Mercês|Rio de Mouro|Mira Sintra-Meleças|Agualva-Cacém|Massamá-Barcarena|Monte Abraão|Queluz-Belas|Amadora|Reboleira|Benfica|Campolide-A|Sete Rios|Entrecampos|Roma-Areeiro|Marvila|Braço de Prata|Lisboa - Oriente',
 'YUn0Rdiqmhs': 'Campolide-A|Pragal|Corroios|Foros de Amora|Fogueteiro|Coina|Penalva|Pinhal Novo|Venda do Alcaide|Palmela|Setúbal',
 'mK_HPjBo-aE': 'Lisboa - Rossio|Campolide|Benfica|Reboleira|Amadora|Queluz-Belas|Monte Abraão|Massamá-Barcarena|Agualva-Cacém|Mira Sintra-Meleças',
 '0Xwnh6quADk': 'Campolide-A|Sete Rios|Entrecampos|Roma-Areeiro|Marvila|Braço de Prata|Lisboa - Oriente|Moscavide|Sacavém|Bobadela|Santa Iria|Póvoa|Alverca',
 'MfZArQ-6ezE': 'Cacém|Mafra|Torres Vedras|Bombarral|Óbidos|Caldas da Rainha',
 'CdJKEW-ArHI': 'Sernada do Vouga|Macinhata|Águeda|Travassô|Eirol|Aveiro',
 'FXH6AQFXo9g': 'Valença|São Pedro da Torre|W:Carvalha technical station',
 'GBrpRQgQkrg': 'Contumil|Porto - Campanhã',
 'bg64rdnJw_g': 'Alcântara-Terra|Campolide-A|Sete Rios|Entrecampos|Roma-Areeiro|Marvila|Braço de Prata|Lisboa - Oriente|Moscavide|Sacavém|Bobadela|Santa Iria|Póvoa|Alverca|Alhandra|Vila Franca de Xira|Castanheira do Ribatejo',
 'FMiCtDN5nLg': 'Guimarães|Vizela|Lordelo|Vila das Aves',
 'ArTAyRENkUk': 'Lordelo|Vizela|Guimarães',
 'pNT2kuzodJc': 'Hospital São João|IPO|Pólo Universitário|Salgueiros|Combatentes|Marquês|Faria Guimarães|Trindade|Aliados|São Bento|Jardim do Morro|General Torres|Câmara de Gaia|João de Deus|D. João II|Santo Ovídio',
 'Bvm2OxUGrDU': 'Casa Branca|Alvito|Cuba|Beja',
}
