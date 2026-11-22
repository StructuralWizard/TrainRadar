import re,json,sys
src=open(sys.argv[1]).read().split('\n')
LINK=re.compile(r'\[\[?(.*?)\]?(?:\{\.underline\})?\]\((https?://(?:www\.)?youtube\.com/(?:watch\?v=|live/)([A-Za-z0-9_-]{11})[^)]*|https?://youtu\.be/([A-Za-z0-9_-]{11})[^)]*)\)')
def clean(s):
    s=re.sub(r'\{\.underline\}|\{width=[^}]*\}|!\[\]\([^)]*\)','',s)
    s=s.replace('\\','').replace('***','').replace('**','').replace('*','')
    s=s.replace('---','—').replace('--','–')
    return re.sub(r'\s+',' ',s).strip()
prompt=h2=h3='';in_sources=False
videos={};order=[];cur=None;section_extra=[]
for i,l in enumerate(src):
    if l.startswith('*User prompt:'):
        prompt=clean(l[len('*User prompt:'):].rstrip('*'));h2=h3='';in_sources=False;cur=None;continue
    if l.startswith('## '): h2=clean(l[3:]);h3='';cur=None;in_sources=False;continue
    if l.startswith('### '): h3=clean(l[4:]);cur=None;continue
    if l.strip().startswith('**Sources**') or re.match(r'^\*\*Sources',l.strip()): in_sources=True;cur=None;continue
    if in_sources: continue
    ms=list(LINK.finditer(l))
    if ms:
        for m in ms:
            vid=m.group(3) or m.group(4)
            title=clean(m.group(1)).strip('[]')
            rest=clean(l[m.end():])
            label=clean(l[:m.start()])
            v=videos.get(vid)
            occ={'line':i+1,'prompt':prompt,'h2':h2,'h3':h3,'label':label,'title':title,'after':rest,'body':[]}
            if not v:
                v=videos[vid]={'id':vid,'occ':[]};order.append(vid)
            v['occ'].append(occ)
        cur=occ if len(ms)==1 else None
        continue
    if l.strip()=='' : continue
    c=clean(l.lstrip(' -'))
    if not c: continue
    if cur is not None: cur['body'].append(c)
    else: section_extra.append({'line':i+1,'prompt':prompt,'h2':h2,'h3':h3,'text':c})
json.dump({'videos':[videos[k] for k in order],'extra':section_extra},open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
print(len(order),len(section_extra))
