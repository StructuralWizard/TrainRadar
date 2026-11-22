import json,re,sys
d=json.load(open(sys.argv[1]))
TS=r'(\d{1,2}:\d{2}(?::\d{2})?)'
def tos(x):
    p=list(map(int,x.split(':')));return p[0]*3600+p[1]*60+p[2] if len(p)==3 else p[0]*60+p[1]
def clean(n):
    n=re.sub(r'\((?:[A-Z]{3}|[^)]*)\)','',n); n=re.sub(r'\s+',' ',n).strip(' .,;*')
    return n
res={}
for v in d['videos']:
    best=[];kind=None
    for o in v['occ']:
        lines=o['body']+[o['after']]
        # 1 table rows with arrow
        rows=[]
        for l in lines:
            m=re.match(r'^'+TS+r'\s+(.+?)\s+→\s+(.+)$',l)
            if m: rows.append((tos(m.group(1)),clean(m.group(2)),clean(m.group(3))))
        if len(rows)>=2:
            seq=[(t,a) for t,a,b in rows]+[(None,rows[-1][2])]
            if len(seq)>len(best): best,kind=seq,'table'
            continue
        # 2 rows "time name" (table w/o arrow) or dotted
        cand=[]
        for l in lines:
            parts=re.split(r'\s+·\s+',l) if '·' in l else [l]
            for p in parts:
                m=re.match(r'^(?:.*?:\s*)?'+TS+r'\s*[—–-]?\s+([A-Z][^·]+?)$',p.strip())
                if m:
                    nm=clean(re.split(r'\s[—–]\s| \(all ',m.group(2))[0])
                    if nm and not re.match(r'(?i)intro|preview',nm): cand.append((tos(m.group(1)),nm))
        if len(cand)>=3 and len(cand)>len(best): best,kind=cand,'times'
        # 3 via lists
        if not best:
            txt=' '.join(lines)
            m=re.search(r'from ([A-Z][\w\'’&. -]+?) via (.+?) (?:to|into) ([A-Z][\w\'’&. -]+?)(?:[.,;]|$)',txt)
            if m:
                mids=[clean(x) for x in re.split(r',\s*(?:and\s+)?|\s+and\s+',m.group(2))]
                seq=[(None,clean(m.group(1)))]+[(None,x) for x in mids if x and len(x)<40]+[(None,clean(m.group(3)))]
                if len(seq)>=3: best,kind=seq,'via'
    res[v['id']]={'kind':kind,'seq':best}
json.dump(res,open(sys.argv[2],'w'),ensure_ascii=False,indent=0)
import collections;print(collections.Counter(x['kind'] for x in res.values()))
