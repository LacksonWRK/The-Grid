// AI strength check in Node (pure core). usage: node ai_strength.js [games] [dots] [impMs]
const C=require('./core_load')();
const games=+process.argv[2]||20, dots=+process.argv[3]||6, impMs=+process.argv[4]||150;
function play(spec,diffs,opts){
  const S=C.stateFromSpec(spec);
  while(S.left>0){const e=C.chooseMove(S,diffs[S.cur],{timeMs:impMs});
    if(!(S.b.exists[e]&&!S.b.isWall[e]&&!S.drawn[e]))throw new Error('illegal '+e);
    C.applyMove(S,e);}
  return S;
}
function mk(n,mode,first,walls){const m=C.makeMask('square',n,n);const b0=C.buildBoard(n,n,m,[]);const w=walls?C.genWalls(b0,walls,7+first):[];return {W:n,H:n,mask:Array.from(m),walls:w,np:2,mode,first};}
function match(A,B,label,mode,walls){
  let aw=0,bw=0,t=0,ad=0;const t0=Date.now();
  for(let g=0;g<games;g++){
    const first=g%2, n=dots-1;
    const spec=mk(n,mode,first,walls);
    // seat0=A seat1=B, alternate who goes first
    const S=play(spec,[A,B]);
    const d=S.scores[0]-S.scores[1];ad+=d;
    if(d>0)aw++;else if(d<0)bw++;else t++;
  }
  console.log(`${label} [${dots} dots, mode ${mode?'combo':'classic'}, walls ${walls||'none'}]: ${A} wins ${aw}, ${B} wins ${bw}, ties ${t}  avg margin ${(ad/games).toFixed(2)}  (${((Date.now()-t0)/1000).toFixed(0)}s)`);
}
const which=process.argv[5]||'all';
if(which==='all'||which==='a'){match('impossible','medium','Impossible vs Medium',0);if(!process.env.ONLY0)match('impossible','medium','Impossible vs Medium',1);}
if(which==='all'||which==='b'){match('hard','easy','Hard vs Easy',0);match('hard','easy','Hard vs Easy',1);}
if(which==='all'||which==='c'){match('impossible','hard','Impossible vs Hard',0);match('hard','medium','Hard vs Medium',0);match('medium','easy','Medium vs Easy',0);}
