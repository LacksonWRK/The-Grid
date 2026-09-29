import asyncio,json,itertools,random
from playwright.async_api import async_playwright
JS="""async (cfgs)=>{
 const g=window.__grid,out=[];
 for(const cfg of cfgs){
  g.newGame(cfg);let st=g.getState();const total=st.board.nCells;let guard=0;
  const diffs=cfg.players.map(p=>p.diff);
  while(!g.getState().gameOver&&guard++<1000){const s=g.getState();const e=g.aiMove(diffs[s.current],{timeMs:15});
    if(!g.move(e)){out.push({cfg,err:'illegal move '+e});break;}}
  st=g.getState();
  // independent recompute
  const W=st.board.W,H=st.board.H,np=st.players.length;const own=st.owners;
  const seen=new Array(W*H).fill(false);const sc=new Array(np).fill(0);
  let captured=0;
  for(let i=0;i<W*H;i++){if(own[i]>=0)captured++;}
  for(let i=0;i<W*H;i++){const o=own[i];if(o<0||seen[i])continue;let n=0;const stk=[i];seen[i]=true;
    while(stk.length){const c=stk.pop();n++;const r=(c/W)|0,cc=c%W;
      for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){const rr=r+dr,c2=cc+dc;if(rr<0||rr>=H||c2<0||c2>=W)continue;const j=rr*W+c2;if(!seen[j]&&own[j]===o){seen[j]=true;stk.push(j);}}}
    sc[o]+=st.mode===1?n*n:n;}
  const ok=st.gameOver&&captured===total&&JSON.stringify(sc)===JSON.stringify(st.scores)&&!st.edges.some(v=>v===-1)&&st.moves.length===st.board.nDrawable;
  // wall validity: no cell with 4 walls
  out.push({shape:cfg.shape,walls:cfg.walls,scoring:cfg.scoring,np,ok,total,captured,sc,scores:st.scores,walls_n:st.board.nWalls});
 }
 return out;}"""
async def main():
    random.seed(5)
    cfgs=[]
    D=['easy','medium','hard','impossible']
    for shape in ['square','rect','plus','hollow','diamond','hourglass']:
        for walls in ['none','scattered','rooms','maze']:
            for sc in ['classic','combo']:
                for np_ in [2,3,4]:
                    size=random.choice([5,6,7,8]) if shape!='rect' else 6
                    players=[{'cpu':True,'diff':random.choice(D)} for _ in range(np_)]
                    cfgs.append({'shape':shape,'size':size,'dotsW':random.choice([4,6,8]),'dotsH':random.choice([3,5,7]),'walls':walls,'scoring':sc,'seed':random.randint(1,9999),'players':players,'first':random.randint(0,np_-1)})
    # extra: size extremes
    for shape,size in [('square',3),('square',12),('plus',5),('plus',12),('hollow',5),('hollow',12),('diamond',5),('diamond',12),('hourglass',5),('hourglass',12)]:
        for walls in ['none','scattered','rooms','maze']:
            cfgs.append({'shape':shape,'size':size,'walls':walls,'scoring':'combo','seed':3,'players':[{'cpu':True,'diff':'hard'},{'cpu':True,'diff':'medium'}]})
    async with async_playwright() as p:
        b=await p.chromium.launch();page=await b.new_page(viewport={'width':1180,'height':820})
        errs=[];await page.route('**/fonts.g*/**',lambda r:r.abort())
        page.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'ERR_' not in m.text else None)
        page.on('pageerror',lambda e:errs.append(str(e)))
        await page.goto('file:///home/claude/the-grid/index.html');await page.wait_for_timeout(500)
        res=[]
        for i in range(0,len(cfgs),40):
            res+=await page.evaluate(JS,cfgs[i:i+40])
        bad=[r for r in res if not r.get('ok')]
        print('games',len(res),'passed',len(res)-len(bad),'failed',len(bad))
        for r in bad[:8]:print(r)
        print('console errors',errs[:5])
        print('walls>0 games',sum(1 for r in res if r.get('walls_n',0)>0))
        await b.close()
asyncio.run(main())
