import json,re,sys
d=json.load(open(sys.argv[1]))
TS=r'(?:~)?(\d{1,2}:\d{2}(?::\d{2})?)'
def tos(x):
    p=list(map(int,x.split(':')));return p[0]*3600+p[1]*60+p[2] if len(p)==3 else p[0]*60+p[1]
def seq_from(text):
    out=[]
    if '→' in text:
        # take segment containing arrows
        parts=[p.strip() for p in text.split('→')]
        for i,p in enumerate(parts):
            t=None
            m=re.search(TS+r'\s*$',p) if False else None
            # leading timestamp
            m=re.match(r'^(?:.*?[—:]\s*)?'+TS+r'\s+(.*)$',p) if i==0 else re.match(r'^'+TS+r'\s+(.*)$',p)
            name=p
            if m: t=tos(m.group(1)); name=m.group(2)
            elif i==0:
                # strip leading label like "Station Sequence: " or "(Ferroviariu) — "
                name=re.split(r'[:—]\s*',p)[-1]
            name=re.sub(r'\(.*?\)','',name)
            name=re.sub(r'[.;]+$','',name).strip(' .,-')
            # last part may contain trailing commentary
            if i==len(parts)-1: name=re.split(r'\s[—–]\s|\. ',name)[0].strip(' .')
            if name: out.append((t,name))
        return out
    for m in re.finditer(r'(?:^|/ )'+TS+r'\s*—\s*([^/]+)',text):
        out.append((tos(m.group(1)),m.group(2).strip()))
    return out
res={}
for v in d['videos']:
    best=[]
    for o in v['occ']:
        for txt in [o['after']]+o['body']:
            s=seq_from(txt)
            if len(s)>len(best): best=s
        s=seq_from(' / '.join(o['body']))
        if len(s)>len(best): best=s
    res[v['id']]=best
json.dump(res,open(sys.argv[2],'w'),ensure_ascii=False,indent=0)
