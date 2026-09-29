'use strict';
/* ===== THE GRID core: board generation, rules, scoring, AI (pure, worker-safe) ===== */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function nowMs(){return (typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();}
function shuffle(a,rng){for(let i=a.length-1;i>0;i--){const j=(rng()*(i+1))|0;const t=a[i];a[i]=a[j];a[j]=t;}return a;}

/* ---------- shapes ---------- */
const SHAPES=['square','rect','plus','hollow','diamond','hourglass'];
const SHAPE_MIN_DOTS={square:3,rect:3,plus:5,hollow:5,diamond:5,hourglass:5};
function inShape(shape,c,r,W,H){
  const n=W;
  switch(shape){
    case 'plus':{const t=Math.floor(n/3),lo=t,hi=n-t-1;return (c>=lo&&c<=hi)||(r>=lo&&r<=hi);}
    case 'hollow':{const t=Math.floor(n/3),lo=t,hi=n-t-1;return !(c>=lo&&c<=hi&&r>=lo&&r<=hi);}
    case 'diamond':{const dx=Math.abs(c+.5-n/2),dy=Math.abs(r+.5-n/2);return dx+dy<=n/2+1e-9;}
    case 'hourglass':{const dx=Math.abs(c+.5-W/2),dy=Math.abs(r+.5-H/2);return dx<=dy+.5+1e-9;}
    default:return true;
  }
}
function makeMask(shape,W,H){const m=new Uint8Array(W*H);for(let r=0;r<H;r++)for(let c=0;c<W;c++)m[r*W+c]=inShape(shape,c,r,W,H)?1:0;return m;}
/* dims for a shape given dots-per-side settings -> {W,H} in cells */
function shapeDims(shape,dotsW,dotsH){
  if(shape==='rect')return {W:Math.max(2,dotsW-1),H:Math.max(2,dotsH-1)};
  const d=Math.max(SHAPE_MIN_DOTS[shape]||3,dotsW);return {W:d-1,H:d-1};
}

/* ---------- board ---------- */
/* edge ids: horizontal (x,y) -> y*W+x ; vertical (x,y) -> nH + y*(W+1)+x ; cell i = r*W+c */
function buildBoard(W,H,mask,walls){
  const nH=(H+1)*W,nV=H*(W+1),nE=nH+nV,WH=W*H;
  const b={W,H,nH,nE,WH,mask:Uint8Array.from(mask)};
  b.edgeCells=new Int32Array(nE*2).fill(-1);
  b.cellEdges=new Int32Array(WH*4).fill(-1);
  b.cellNbr=new Int32Array(WH*4).fill(-1); // top,right,bottom,left
  b.exists=new Uint8Array(nE);b.isWall=new Uint8Array(nE);
  let nCells=0;
  for(let r=0;r<H;r++)for(let c=0;c<W;c++){
    const i=r*W+c;if(!b.mask[i])continue;nCells++;
    const top=r*W+c,bottom=(r+1)*W+c,left=nH+r*(W+1)+c,right=left+1;
    const es=[top,right,bottom,left];
    for(let k=0;k<4;k++){const e=es[k];b.cellEdges[i*4+k]=e;b.exists[e]=1;const s=b.edgeCells[e*2]<0?0:1;b.edgeCells[e*2+s]=i;}
    if(r>0&&b.mask[(r-1)*W+c])b.cellNbr[i*4]=(r-1)*W+c;
    if(c<W-1&&b.mask[r*W+c+1])b.cellNbr[i*4+1]=r*W+c+1;
    if(r<H-1&&b.mask[(r+1)*W+c])b.cellNbr[i*4+2]=(r+1)*W+c;
    if(c>0&&b.mask[r*W+c-1])b.cellNbr[i*4+3]=r*W+c-1;
  }
  b.nCells=nCells;
  for(const e of (walls||[])){if(b.exists[e])b.isWall[e]=1;}
  b.ex1=new Int16Array(nE);b.ey1=new Int16Array(nE);b.ex2=new Int16Array(nE);b.ey2=new Int16Array(nE);
  b.dotUsed=new Uint8Array((W+1)*(H+1));
  const dr=[];let nw=0;
  for(let e=0;e<nE;e++){
    if(e<nH){const y=Math.floor(e/W),x=e%W;b.ex1[e]=x;b.ey1[e]=y;b.ex2[e]=x+1;b.ey2[e]=y;}
    else{const k=e-nH,y=Math.floor(k/(W+1)),x=k%(W+1);b.ex1[e]=x;b.ey1[e]=y;b.ex2[e]=x;b.ey2[e]=y+1;}
    if(b.exists[e]){b.dotUsed[b.ey1[e]*(W+1)+b.ex1[e]]=1;b.dotUsed[b.ey2[e]*(W+1)+b.ex2[e]]=1;if(b.isWall[e])nw++;else dr.push(e);}
  }
  b.drawable=Int32Array.from(dr);b.nWalls=nw;
  return b;
}
function edgeBetween(b,x1,y1,x2,y2){
  if(Math.abs(x1-x2)+Math.abs(y1-y2)!==1)return -1;
  const W=b.W,H=b.H;let e;
  if(y1===y2){const x=Math.min(x1,x2),y=y1;if(x<0||x>=W||y<0||y>H)return -1;e=y*W+x;}
  else{const y=Math.min(y1,y2),x=x1;if(x<0||x>W||y<0||y>=H)return -1;e=b.nH+y*(W+1)+x;}
  return b.exists[e]?e:-1;
}
function interiorEdges(b){const a=[];for(let e=0;e<b.nE;e++)if(b.exists[e]&&b.edgeCells[e*2]>=0&&b.edgeCells[e*2+1]>=0)a.push(e);return a;}

/* ---------- walls ---------- */
function genWalls(b,mode,seed){
  if(!mode||mode==='none')return [];
  const rng=mulberry32((seed|0)||1),W=b.W,H=b.H,nH=b.nH,CAP=2;
  const walls=new Set(),wc=new Uint8Array(b.WH);
  function tryAdd(e){
    const c0=b.edgeCells[e*2],c1=b.edgeCells[e*2+1];
    if(c0<0||c1<0||walls.has(e))return false;
    if(wc[c0]>=CAP||wc[c1]>=CAP)return false;
    wc[c0]++;wc[c1]++;walls.add(e);return true;
  }
  const interior=interiorEdges(b);
  if(!interior.length)return [];
  function scattered(){
    const a=shuffle(interior.slice(),rng);
    const target=Math.max(1,Math.round(interior.length*(0.10+0.05*rng())));
    for(const e of a){if(walls.size>=target)break;tryAdd(e);}
  }
  if(mode==='scattered')scattered();
  else if(mode==='rooms'){
    const pos=(n)=>n>=9?[Math.round(n/3),Math.round(2*n/3)]:(n>=4?[Math.round(n/2)]:[]);
    const lines=[];
    for(const x of pos(W)){const L=[];for(const e of interior)if(e>=nH){const k=e-nH;if(k%(W+1)===x)L.push([Math.floor(k/(W+1)),e]);}L.sort((p,q)=>p[0]-q[0]);lines.push(L.map(v=>v[1]));}
    for(const y of pos(H)){const L=[];for(const e of interior)if(e<nH&&Math.floor(e/W)===y)L.push([e%W,e]);L.sort((p,q)=>p[0]-q[0]);lines.push(L.map(v=>v[1]));}
    for(const L of lines){
      if(!L.length)continue;
      const cnt=Math.max(1,Math.round(L.length/4)),doors=new Set();
      for(let i=0;i<cnt;i++){let p=Math.floor((i+.5+(rng()-.5)*.6)*L.length/cnt);p=Math.max(0,Math.min(L.length-1,p));doors.add(p);}
      for(let i=0;i<L.length;i++)if(!doors.has(i))tryAdd(L[i]);
    }
    if(!walls.size)scattered();
  }else if(mode==='maze'){
    const cells=[];for(let i=0;i<b.WH;i++)if(b.mask[i])cells.push(i);
    const vis=new Uint8Array(b.WH),tree=new Set();
    for(const start0 of shuffle(cells.slice(),rng)){
      if(vis[start0])continue;const stack=[start0];vis[start0]=1;
      while(stack.length){
        const c=stack[stack.length-1];const dirs=shuffle([0,1,2,3],rng);let moved=false;
        for(const k of dirs){const n=b.cellNbr[c*4+k];if(n>=0&&!vis[n]){vis[n]=1;tree.add(b.cellEdges[c*4+k]);stack.push(n);moved=true;break;}}
        if(!moved)stack.pop();
      }
    }
    const cand=shuffle(interior.filter(e=>!tree.has(e)),rng);
    for(const e of cand)if(rng()<0.75)tryAdd(e);
    if(!walls.size)scattered();
  }
  return Array.from(walls).sort((a,c)=>a-c);
}
/* returns true when no cell is fully walled */
function validateWalls(b){for(let i=0;i<b.WH;i++){if(!b.mask[i])continue;let n=0;for(let k=0;k<4;k++)if(b.isWall[b.cellEdges[i*4+k]])n++;if(n>=4)return false;}return true;}

/* ---------- state / rules ---------- */
const ZR=mulberry32(0xC0FFEE);
function zt(n){const a=new Int32Array(n);for(let i=0;i<n;i++)a[i]=(ZR()*4294967296)|0;return a;}
const ZE1=zt(600),ZE2=zt(600),ZC1=zt(1200),ZC2=zt(1200),ZP1=zt(8),ZP2=zt(8);

function newState(b,np,mode,first){
  const S={b,np,mode:mode|0,cur:first|0,first:first|0,
    drawn:new Uint8Array(b.nE),edgeOwner:new Int8Array(b.nE).fill(-1),
    cnt:new Uint8Array(b.WH),owner:new Int8Array(b.WH).fill(-1),scores:new Int32Array(np),
    left:b.drawable.length,three:0,h1:0,h2:0,g1:0,g2:0,
    und:Int32Array.from(b.drawable),upos:new Int16Array(b.nE).fill(-1),mark:new Int32Array(b.WH),tmp:new Uint8Array(b.WH),stamp:0,stk:new Int32Array(b.WH+4)};
  for(let i=0;i<S.und.length;i++)S.upos[S.und[i]]=i;
  for(let i=0;i<b.WH;i++){if(!b.mask[i])continue;let c=0;for(let k=0;k<4;k++)if(b.isWall[b.cellEdges[i*4+k]])c++;S.cnt[i]=c;if(c===3)S.three++;}
  return S;
}
/* spec: {W,H,mask:[..],walls:[..],np,mode(0 classic|1 combo),first} */
function stateFromSpec(spec,moves){
  const b=buildBoard(spec.W,spec.H,spec.mask,spec.walls);
  const S=newState(b,spec.np,spec.mode,spec.first||0);
  if(moves)for(const e of moves)applyMove(S,e);
  return S;
}
function flood(S,start,p){
  const st=S.stk,nb=S.b.cellNbr,mk=S.mark,ow=S.owner,stamp=S.stamp;
  let sp=0,n=0;st[sp++]=start;mk[start]=stamp;
  while(sp){const c=st[--sp];n++;for(let k=0;k<4;k++){const x=nb[c*4+k];if(x>=0&&mk[x]!==stamp&&ow[x]===p){mk[x]=stamp;st[sp++]=x;}}}
  return n;
}
function capture(S,c,p){
  S.owner[c]=p;S.h1^=ZC1[c*4+p];S.h2^=ZC2[c*4+p];
  if(S.mode===0){S.scores[p]++;return;}
  let total=1,old=0;S.stamp++;S.mark[c]=S.stamp;
  const nb=S.b.cellNbr;
  for(let k=0;k<4;k++){const n=nb[c*4+k];if(n>=0&&S.owner[n]===p&&S.mark[n]!==S.stamp){const sz=flood(S,n,p);total+=sz;old+=sz*sz;}}
  S.scores[p]+=total*total-old;
}
/* returns code: bits0-7 cell1+1, bits8-15 cell2+1, bits16+ previous score of mover */
function applyMove(S,e){
  const b=S.b,p=S.cur;let code=0,nc=0;
  S.drawn[e]=1;S.edgeOwner[e]=p;{const n=S.left-1,pos=S.upos[e],last=S.und[n];S.und[pos]=last;S.upos[last]=pos;S.und[n]=e;S.left=n;}S.h1^=ZE1[e];S.h2^=ZE2[e];S.g1^=ZE1[e];S.g2^=ZE2[e];
  const prev=S.scores[p];
  for(let i=0;i<2;i++){
    const c=b.edgeCells[e*2+i];if(c<0)continue;
    const k=++S.cnt[c];
    if(k===3)S.three++;
    else if(k===4){S.three--;capture(S,c,p);code|=(c+1)<<(8*nc);nc++;}
  }
  code|=prev<<16;
  S.cur=(p+1)%S.np;
  return code;
}
function undoMove(S,e,code){
  const b=S.b;const p=(S.cur+S.np-1)%S.np;S.cur=p;
  S.drawn[e]=0;S.edgeOwner[e]=-1;{const n=S.left,pos=S.upos[e],last=S.und[pos];S.und[n]=last;S.upos[last]=n;S.und[pos]=e;S.left=n+1;}S.h1^=ZE1[e];S.h2^=ZE2[e];S.g1^=ZE1[e];S.g2^=ZE2[e];
  for(let i=0;i<2;i++){
    const c=b.edgeCells[e*2+i];if(c<0)continue;
    const k=S.cnt[c];
    if(k===4){S.three++;S.owner[c]=-1;S.h1^=ZC1[c*4+p];S.h2^=ZC2[c*4+p];}
    else if(k===3)S.three--;
    S.cnt[c]=k-1;
  }
  S.scores[p]=code>>>16;
}
function codeCells(code){const a=[];const c1=(code&255)-1,c2=((code>>>8)&255)-1;if(c1>=0)a.push(c1);if(c2>=0)a.push(c2);return a;}
function groupCells(S,c){const p=S.owner[c];if(p<0)return [];S.stamp++;const out=[],st=[c],nb=S.b.cellNbr;S.mark[c]=S.stamp;while(st.length){const x=st.pop();out.push(x);for(let k=0;k<4;k++){const n=nb[x*4+k];if(n>=0&&S.owner[n]===p&&S.mark[n]!==S.stamp){S.mark[n]=S.stamp;st.push(n);}}}return out;}
/* independent recompute of scores + largest group per player */
function computeScores(S){
  const sc=new Array(S.np).fill(0),best=new Array(S.np).fill(0),cap=new Array(S.np).fill(0);
  const seen=new Uint8Array(S.b.WH);
  for(let i=0;i<S.b.WH;i++){
    const p=S.owner[i];if(p<0)continue;cap[p]++;
    if(seen[i])continue;
    const g=groupCells(S,i);for(const x of g)seen[x]=1;
    sc[p]+=S.mode===0?g.length:g.length*g.length;
    if(g.length>best[p])best[p]=g.length;
  }
  return {scores:sc,best,captured:cap};
}
function isOver(S){return S.left===0;}

/* ---------- AI ---------- */
function legalMoves(S){const a=[];for(let i=0;i<S.left;i++)a.push(S.und[i]);a.sort((x,y)=>x-y);return a;}
function completes(S,e){let n=0;for(let i=0;i<2;i++){const c=S.b.edgeCells[e*2+i];if(c>=0&&S.cnt[c]===3)n++;}return n;}
function gives(S,e){let n=0;for(let i=0;i<2;i++){const c=S.b.edgeCells[e*2+i];if(c>=0&&S.cnt[c]===2)n++;}return n;}
function pick(a,rng){return a[(rng()*a.length)|0];}
function diffOf(S,me){let m=-1e9;for(let j=0;j<S.np;j++)if(j!==me&&S.scores[j]>m)m=S.scores[j];return S.scores[me]-m;}

function aiEasy(S,rng){
  const mv=legalMoves(S);const comp=mv.filter(e=>completes(S,e)>0);
  if(comp.length&&rng()<0.5)return pick(comp,rng);
  return pick(mv,rng);
}
function aiMedium(S,rng){
  const mv=legalMoves(S);let best=[],bk=0;
  for(const e of mv){const k=completes(S,e);if(k>bk){bk=k;best=[e];}else if(k===bk&&k>0)best.push(e);}
  if(bk>0)return pick(best,rng);
  const safe=mv.filter(e=>gives(S,e)===0);
  if(safe.length)return pick(safe,rng);
  return pick(mv,rng);
}
function aiHard(S,rng){
  const me=S.cur,mv=legalMoves(S);let bestV=-1e9,best=[];
  for(const e of mv){
    const c1=applyMove(S,e);let v=diffOf(S,me);
    if(S.left>0){
      // next player's best reply (they minimise my advantage)
      const rp=legalMoves(S);let worst=1e9;
      for(const r of rp){const c2=applyMove(S,r);const w=diffOf(S,me);undoMove(S,r,c2);if(w<worst)worst=w;}
      v=worst;
    }
    undoMove(S,e,c1);
    if(v>bestV+1e-9){bestV=v;best=[e];}else if(Math.abs(v-bestV)<=1e-9)best.push(e);
  }
  // tie-break: prefer moves that do not hand a 3-sided cell
  const safe=best.filter(e=>gives(S,e)===0);
  return pick(safe.length?safe:best,rng);
}



const TT_SIZE=1<<18,TT_MASK=TT_SIZE-1;let tk1=null,tk2,tv,td,tf,tm,tg,ttGen=0;
function ttInit(){if(tk1)return;tk1=new Int32Array(TT_SIZE);tk2=new Int32Array(TT_SIZE);tv=new Float32Array(TT_SIZE);td=new Int8Array(TT_SIZE);tf=new Int8Array(TT_SIZE);tm=new Int16Array(TT_SIZE);tg=new Uint16Array(TT_SIZE);}

function aiImpossible(S,rng,timeMs,maxDepth){
  const root=S.cur,ec=S.b.edgeCells,drawable=S.b.drawable;
  const rootMoves0=legalMoves(S);
  if(rootMoves0.length<=1)return rootMoves0[0];
  ttInit();ttGen=(ttGen+1)&0xFFFF;if(!ttGen)ttGen=1;
  const t0=nowMs();
  const endgame=S.left<=14;
  const deadline=t0+(endgame?timeMs*1.5:timeMs);
  let nodes=0,aborted=false;
  const REL=S.mode===0&&S.np===2;
  function evalTerm(){return diffOf(S,root);}
  function leaf(){return diffOf(S,root);}
  const bufs=[];
  function order(ttm,jitter,ply){
    let buf=bufs[ply];if(!buf){buf=bufs[ply]=new Int32Array(320);}
    let na=0;
    const und=S.und,nl=S.left;
    for(let i=0;i<nl;i++){
      const e=und[i];
      let k=0,g=0;const c0=ec[e*2],c1=ec[e*2+1];
      if(c0>=0){const n=S.cnt[c0];if(n===3)k++;else if(n===2)g++;}
      if(c1>=0){const n=S.cnt[c1];if(n===3)k++;else if(n===2)g++;}
      let key=k*16+(2-g)*4;if(jitter)key+=(rng()*4)|0;if(e===ttm)key+=1000;
      buf[na++]=key*512+e;
    }
    const arr=buf.subarray(0,na);arr.sort();return arr;
  }
  function ab(depth,alpha,beta,ply){
    if((++nodes&2047)===0&&nowMs()>deadline)aborted=true;
    if(aborted)return 0;
    if(S.left===0)return evalTerm();
    if(depth<=0)return leaf();
    const cur=S.cur;
    const base=REL?diffOf(S,root):0;
    const k1=(REL?S.g1:S.h1)^ZP1[cur],k2=(REL?S.g2:S.h2)^ZP2[cur],idx=k1&TT_MASK;
    const ed=depth>=S.left?100:depth;
    let ttm=-1;
    if(tg[idx]===ttGen&&tk1[idx]===k1&&tk2[idx]===k2){
      ttm=tm[idx];
      if(td[idx]>=ed){
        const v=tv[idx]+base,f=tf[idx];
        if(f===0)return v;
        if(f===1){if(v>alpha)alpha=v;}else{if(v<beta)beta=v;}
        if(alpha>=beta)return v;
      }
    }
    const moves=order(ttm,false,ply),isMax=cur===root,a0=alpha,b0=beta;
    let best=isMax?-1e9:1e9,bm=-1;
    for(let i=moves.length-1;i>=0;i--){
      const e=moves[i]&511;
      const code=applyMove(S,e);const v=ab(depth-1,alpha,beta,ply+1);undoMove(S,e,code);
      if(aborted)return 0;
      if(isMax){if(v>best){best=v;bm=e;}if(best>alpha)alpha=best;}
      else{if(v<best){best=v;bm=e;}if(best<beta)beta=best;}
      if(alpha>=beta)break;
    }
    if(tg[idx]!==ttGen||ed>=td[idx]){tg[idx]=ttGen;tk1[idx]=k1;tk2[idx]=k2;tv[idx]=best-base;td[idx]=ed;tm[idx]=bm;tf[idx]=best<=a0?2:(best>=b0?1:0);}
    return best;
  }
  
  let rootOrder=Array.from(order(-1,true,0)).reverse().map(v=>v&511);
  let bestMove=rootOrder[0];
  const dcap=maxDepth||S.left;
  for(let depth=1;depth<=Math.min(S.left,dcap);depth++){
    let alpha=-1e9,beta=1e9,bv=-1e9,bm=-1;
    for(let i=0;i<rootOrder.length;i++){
      const e=rootOrder[i];
      const code=applyMove(S,e);const v=ab(depth-1,alpha,beta,1);undoMove(S,e,code);
      if(aborted)break;
      if(v>bv){bv=v;bm=e;}if(bv>alpha)alpha=bv;
    }
    if(aborted)break;
    bestMove=bm;
    rootOrder=[bm].concat(rootOrder.filter(x=>x!==bm));
    if(depth>=S.left)break;
    if(nowMs()>deadline)break;
  }
  return bestMove;
}

const DIFFS=['easy','medium','hard','impossible'];
function chooseMove(S,diff,opts){
  opts=opts||{};const rng=opts.rng||Math.random;
  if(S.left<=0)return -1;
  switch(diff){
    case 'easy':return aiEasy(S,rng);
    case 'medium':return aiMedium(S,rng);
    case 'hard':return rng()<0.12?aiMedium(S,rng):aiImpossible(S,rng,Math.min(120,opts.timeMs||120),4);
    case 'impossible':return aiImpossible(S,rng,opts.timeMs||700);
    default:return aiMedium(S,rng);
  }
}
return {mulberry32,shuffle,SHAPES,SHAPE_MIN_DOTS,makeMask,shapeDims,buildBoard,edgeBetween,genWalls,validateWalls,interiorEdges,
  newState,stateFromSpec,applyMove,undoMove,codeCells,groupCells,computeScores,isOver,legalMoves,completes,gives,chooseMove,DIFFS};
