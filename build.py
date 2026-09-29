#!/usr/bin/env python3
import re,sys,os
d=os.path.dirname(os.path.abspath(__file__))
def rd(n):return open(os.path.join(d,'src',n),encoding='utf-8').read()
core=rd('core.js')
# strip dev-only experiment hooks
core=re.sub(r"let PAR=.*\n","",core);core=re.sub(r"let EXT=.*\n","",core);core=re.sub(r"let ROLL=.*\n","",core)
assert '</script' not in core
html=rd('template.html').replace('/*CSS*/',rd('style.css')).replace('/*CORE*/',core).replace('/*APP*/',rd('app.js'))
open(os.path.join(d,'index.html'),'w',encoding='utf-8').write(html)
print('built',len(html),'bytes')
