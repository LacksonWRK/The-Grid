'use strict';
(function(){
/* =====================================================================
   THE GRID - app (UI, rendering, input, audio, persistence)
   Core rules + AI live in #core-src (shared with the AI web worker).
   ===================================================================== */
const CORE_SRC=document.getElementById('core-src').textContent;
const C=new Function(CORE_SRC)();
const $=(s,r)=>(r||document).querySelector(s), $$=(s,r)=>Array.from((r||document).querySelectorAll(s));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;

/* ---------- constants ---------- */
/* player colours are slots 0..NCOL-1; each theme maps a slot to its own ink (see THEMES) */
const NCOL=12;
const ROBOTS=['UNIT-7','NOVA','BYTE','ZERO'];
const DIFF_LABEL={easy:'Easy',medium:'Medium',hard:'Hard',impossible:'Impossible'};
const DIFF_DESC={easy:'Plays mostly at random',medium:'Grabs squares, avoids giving them away',hard:'Looks ahead a move',impossible:'Deep search. Good luck!'};
const SHAPE_LABEL={square:'Square',rect:'Rectangle',plus:'Plus',hollow:'Hollow',diamond:'Diamond',hourglass:'Hourglass'};
const WALL_LABEL={none:'None',scattered:'Scattered',rooms:'Rooms',maze:'Maze-ish'};
const WALL_HINT={none:'A clean open board.',scattered:'Random steel walls (about 10-15% of inner lines).',rooms:'Chambers with doorways between them.',maze:'Twisting corridors of walls.'};
const SCORE_HINT=['Every captured square is worth 1 point.','Touching squares of your color form a group worth N × N. Big groups win!'];

/* ---------- storage (always guarded) ---------- */
const store={
  get(k){try{const v=localStorage.getItem(k);return v==null?null:JSON.parse(v);}catch(e){return null;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;}},
  del(k){try{localStorage.removeItem(k);}catch(e){}}
};
const K_SETUP='thegrid.setup.v1',K_SAVE='thegrid.save.v1',K_MUTE='thegrid.mute.v1',K_THEME='thegrid.theme.v1';

/* ---------- colour helpers ---------- */
const _rgb={};
function rgb(hex){let v=_rgb[hex];if(!v){const n=parseInt(hex.slice(1),16);v=_rgb[hex]=[(n>>16)&255,(n>>8)&255,n&255];}return v;}
function rgba(hex,a){const c=rgb(hex);return 'rgba('+c[0]+','+c[1]+','+c[2]+','+a+')';}
const _lt={};
function light(hex,k){const key=hex+k;let v=_lt[key];if(!v){const c=rgb(hex);v=_lt[key]='rgb('+Math.round(lerp(c[0],255,k))+','+Math.round(lerp(c[1],255,k))+','+Math.round(lerp(c[2],255,k))+')';}return v;}
function shade(hex,k){const key='s'+hex+k;let v=_lt[key];if(!v){const c=rgb(hex);v=_lt[key]='rgb('+Math.round(c[0]*(1-k))+','+Math.round(c[1]*(1-k))+','+Math.round(c[2]*(1-k))+')';}return v;}
/* stable per-item jitter for the hand-drawn themes (same seed -> same wobble every frame) */
function hsh(n){n=Math.imul(n^0x9e3779b9,0x85ebca6b);n^=n>>>13;n=Math.imul(n,0xc2b2ae35);n^=n>>>16;return (n>>>0)/4294967296;}
const jit=(s,k)=>hsh(s*131+k)-.5;
function rrect(x,X,Y,w,h,r){r=Math.min(r,w/2,h/2);x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}
const _spr={};
function glowSprite(hex){
  let s=_spr[hex];if(s)return s;
  s=document.createElement('canvas');s.width=s.height=64;const x=s.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);const c=rgb(hex);
  g.addColorStop(0,'rgba('+c[0]+','+c[1]+','+c[2]+',1)');g.addColorStop(.25,'rgba('+c[0]+','+c[1]+','+c[2]+',.55)');g.addColorStop(1,'rgba('+c[0]+','+c[1]+','+c[2]+',0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);_spr[hex]=s;return s;
}
const easeOut=t=>1-Math.pow(1-t,3);
const easeOutBack=t=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);};

/* =====================================================================
   AUDIO (WebAudio synthesis only)
   ===================================================================== */
const A={ctx:null,master:null,muted:false,noise:null,
  init(){
    if(this.ctx)return;
    try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      this.ctx=new AC();this.master=this.ctx.createGain();this.master.gain.value=this.muted?0:0.9;this.master.connect(this.ctx.destination);
      const n=this.ctx.sampleRate*0.6,buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<n;i++)d[i]=Math.random()*2-1;this.noise=buf;
    }catch(e){this.ctx=null;}
  },
  unlock(){this.init();try{if(this.ctx&&this.ctx.state!=='running')this.ctx.resume();}catch(e){}},
  setMuted(m){this.muted=m;store.set(K_MUTE,m);if(this.master)this.master.gain.value=m?0:0.9;},
  tone(f,d,type,v,to,delay){
    if(!this.ctx||this.muted)return;
    try{const c=this.ctx,t=c.currentTime+(delay||0),o=c.createOscillator(),g=c.createGain();
      o.type=type||'sine';o.frequency.setValueAtTime(f,t);if(to)o.frequency.exponentialRampToValueAtTime(to,t+d);
      g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(v||.12,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+d);
      o.connect(g);g.connect(this.master);o.start(t);o.stop(t+d+.03);}catch(e){}
  },
  line(p){const f=380+p*70+Math.random()*24;this.tone(f,.09,'sine',.14,f*1.35);this.tone(f*2,.05,'triangle',.04,0,.005);},
  capture(n){
    const st=Math.min(Math.max(n,1)-1,12);const f=523.25*Math.pow(2,st*2/12);
    this.tone(f,.42,'sine',.16);this.tone(f*2,.3,'triangle',.07,0,.02);this.tone(f*1.5,.35,'sine',.07,0,.06);
    if(n>=3)this.tone(f*3,.3,'sine',.05,0,.1);
    if(n>=5){this.tone(f*2,.5,'triangle',.08,0,.12);this.tone(f*4,.4,'sine',.04,0,.16);}
  },
  turn(){
    if(!this.ctx||this.muted||!this.noise)return;
    try{const c=this.ctx,t=c.currentTime,s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();
      s.buffer=this.noise;f.type='bandpass';f.Q.value=1.2;f.frequency.setValueAtTime(400,t);f.frequency.exponentialRampToValueAtTime(2400,t+.2);
      g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.05,t+.06);g.gain.exponentialRampToValueAtTime(.0001,t+.22);
      s.connect(f);f.connect(g);g.connect(this.master);s.start(t);s.stop(t+.25);}catch(e){}
  },
  click(){this.tone(620,.06,'square',.05,900);},
  undo(){this.tone(500,.12,'triangle',.08,250);},
  fanfare(tie){
    const n=tie?[392,494,587,784]:[523.25,659.25,783.99,1046.5,1318.5,1568,2093];
    n.forEach((f,i)=>{this.tone(f,.5,'triangle',.11,0,i*.11);this.tone(f*2,.4,'sine',.04,0,i*.11+.02);});
    if(!tie){this.tone(1046.5,1.2,'triangle',.1,0,.85);this.tone(1318.5,1.2,'triangle',.08,0,.85);this.tone(1568,1.2,'triangle',.08,0,.85);}
  }
};
{const m=store.get(K_MUTE);A.muted=m===true;}
['pointerdown','touchend','keydown'].forEach(ev=>document.addEventListener(ev,()=>A.unlock(),{capture:true,passive:true}));

/* =====================================================================
   THEMES - palette, page background and every board drawing primitive.
   Each hook takes the 2D context it draws on, so the game board, the
   board-setup preview and the theme samples all share one renderer.
   ===================================================================== */
const bg=$('#bg'),bgx=bg.getContext('2d');let bgW=0,bgH=0,bgD=1,bgDirty=true;
const stars=[];for(let i=0;i<70;i++)stars.push({x:Math.random(),y:Math.random(),s:Math.random()*1.6+.4,v:Math.random()*.012+.004,p:Math.random()*6.28,h:Math.random()<.5?190:(Math.random()<.5?310:130)});
function sizeBG(){bgD=Math.min(window.devicePixelRatio||1,1.5);bgW=window.innerWidth;bgH=window.innerHeight;bg.width=Math.round(bgW*bgD);bg.height=Math.round(bgH*bgD);bgDirty=true;}
/* where the board's dot lattice sits on the page, so graph paper lines up with the dots */
function bgAlign(){
  if(curScreen!=='game'||!G||!L.sp)return null;
  let el=$('#boardWrap'),ox=0,oy=0;while(el){ox+=el.offsetLeft;oy+=el.offsetTop;el=el.offsetParent;}
  return {ox:ox+L.ox,oy:oy+L.oy,sp:L.sp};
}
function drawBG(t){bgx.setTransform(bgD,0,0,bgD,0,0);TH.bg(bgx,bgW,bgH,t,bgAlign());}

/* --- NEON: perspective grid + drifting particles --- */
function neonBG(x,w,h,t){
  const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,'#04050c');g.addColorStop(.5,'#0a0f26');g.addColorStop(1,'#05060d');x.fillStyle=g;x.fillRect(0,0,w,h);
  const hz=h*.46,cx=w/2;
  // horizon glow
  const hg=x.createRadialGradient(cx,hz,0,cx,hz,w*.6);hg.addColorStop(0,'rgba(120,60,255,.22)');hg.addColorStop(.4,'rgba(0,200,255,.07)');hg.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=hg;x.fillRect(0,0,w,h);
  x.lineWidth=1;
  // floor + ceiling
  for(let side=0;side<2;side++){
    const dir=side?-1:1,edge=side?0:h,a=side?.5:1;
    for(let i=-16;i<=16;i++){
      const xb=cx+i*(w/9);const gr=x.createLinearGradient(0,hz,0,edge);gr.addColorStop(0,'rgba(0,240,255,0)');gr.addColorStop(1,'rgba(0,240,255,'+(.22*a)+')');
      x.strokeStyle=gr;x.beginPath();x.moveTo(cx,hz);x.lineTo(xb,edge);x.stroke();
    }
    const N=14,ph=(t*.00018)%1;
    for(let k=0;k<N;k++){
      const z=(k+ph)/N,y=hz+dir*Math.pow(z,2.3)*Math.abs(edge-hz);
      x.strokeStyle='rgba(255,43,214,'+(.06+.26*z)*a+')';x.beginPath();x.moveTo(0,y);x.lineTo(w,y);x.stroke();
    }
  }
  // particles
  for(const s of stars){
    s.y-=s.v*.016*(1);if(s.y<0){s.y=1;s.x=Math.random();}
    const a=.25+.45*Math.sin(t*.0015+s.p)**2;
    x.fillStyle='hsla('+s.h+',100%,75%,'+a+')';x.beginPath();x.arc(s.x*w,s.y*h,s.s,0,6.283);x.fill();
  }
}
const NEON={
  label:'Neon',sub:'Retro glow grid',meta:'#05060d',tie:'#ffe600',accent:'#00f0ff',glow:true,additive:true,outline:'#ffffff',
  font:'Orbitron,"Arial Black",system-ui,sans-serif',fontW:'900',
  pal:[{n:'CYAN',c:'#00f0ff'},{n:'MAGENTA',c:'#ff2bd6'},{n:'LIME',c:'#7dff3a'},{n:'ORANGE',c:'#ff8a00'},
    {n:'YELLOW',c:'#ffe600'},{n:'VIOLET',c:'#a45bff'},{n:'RED',c:'#ff3860'},{n:'BLUE',c:'#3d7bff'},
    {n:'MINT',c:'#2bffb1'},{n:'PINK',c:'#ff8fcf'},{n:'WHITE',c:'#eef4ff'},{n:'GOLD',c:'#ffb627'}],
  bg:neonBG,
  cell(x,X,Y,sp){x.fillStyle='rgba(110,150,255,.035)';x.fillRect(X+1,Y+1,sp-2,sp-2);},
  guide(x,lw,sp){x.setLineDash([2,Math.max(6,sp*.09)]);x.lineWidth=Math.max(1.5,lw*.35);x.strokeStyle='rgba(140,190,255,.16)';},
  wall(x,x1,y1,x2,y2,lw){
    x.lineCap='round';x.beginPath();x.moveTo(x1,y1);x.lineTo(x2,y2);
    x.strokeStyle='rgba(150,185,225,.10)';x.lineWidth=lw*4;x.stroke();
    x.strokeStyle='#8497b0';x.lineWidth=lw*1.8;x.stroke();
    x.strokeStyle='#c4d3e6';x.lineWidth=lw*1.8;x.setLineDash([lw*.6,lw*2.6]);x.lineCap='butt';x.stroke();x.setLineDash([]);
    x.lineCap='round';x.strokeStyle='#2a3444';x.lineWidth=lw*.7;x.stroke();
  },
  line(x,x1,y1,x2,y2,col,lw,a,seed,k){
    if(k<1){x2=lerp(x1,x2,k);y2=lerp(y1,y2,k);}
    x.lineCap='round';x.beginPath();x.moveTo(x1,y1);x.lineTo(x2,y2);
    x.globalCompositeOperation='lighter';
    x.strokeStyle=rgba(col,.11*a);x.lineWidth=lw*4.4;x.stroke();
    x.strokeStyle=rgba(col,.26*a);x.lineWidth=lw*2.3;x.stroke();
    x.globalCompositeOperation='source-over';
    x.strokeStyle=rgba(col,a);x.lineWidth=lw;x.stroke();
    x.strokeStyle='rgba(255,255,255,'+(.55*a)+')';x.lineWidth=lw*.35;x.stroke();
  },
  tip(x,ex,ey,col,lw){x.globalCompositeOperation='lighter';x.drawImage(glowSprite('#ffffff'),ex-lw*3,ey-lw*3,lw*6,lw*6);x.drawImage(glowSprite(col),ex-lw*5,ey-lw*5,lw*10,lw*10);x.globalCompositeOperation='source-over';},
  dragTip(x,px,py,col){x.globalCompositeOperation='lighter';x.drawImage(glowSprite(col),px-22,py-22,44,44);x.globalCompositeOperation='source-over';},
  captured(x,col,X,Y,sp,lw,age){
    if(age<0)return;let s=1,flash=0;
    if(age<420){const u=age/420;s=Math.max(.05,easeOutBack(u));flash=1-u;}
    const cx=X+sp/2,cy=Y+sp/2,ins=lw*.9+1,w=sp-2*ins;
    x.save();x.translate(cx,cy);x.scale(s,s);x.translate(-cx,-cy);
    const gr=x.createRadialGradient(cx,cy,sp*.05,cx,cy,sp*.7);gr.addColorStop(0,rgba(col,.42));gr.addColorStop(1,rgba(col,.16));
    x.fillStyle=gr;x.fillRect(X+ins,Y+ins,w,w);
    x.strokeStyle=rgba(col,.55);x.lineWidth=2;x.strokeRect(X+ins+4,Y+ins+4,w-8,w-8);
    x.globalCompositeOperation='lighter';x.strokeStyle=rgba(col,.14);x.lineWidth=9;x.strokeRect(X+ins+8,Y+ins+8,w-16,w-16);x.globalCompositeOperation='source-over';
    if(flash>0){x.fillStyle='rgba(255,255,255,'+flash*.55+')';x.fillRect(X+ins,Y+ins,w,w);}
    x.restore();
  },
  lastMove(x,x1,y1,x2,y2,col,lw,a){x.save();x.globalCompositeOperation='lighter';x.lineCap='round';x.strokeStyle=rgba(col,a*.5);x.lineWidth=lw*3.2;x.beginPath();x.moveTo(x1,y1);x.lineTo(x2,y2);x.stroke();x.restore();},
  dots(x,list,rd,t,curCol){
    const spr=glowSprite('#9fe8ff');x.globalCompositeOperation='lighter';
    for(const d of list){const r=rd*(1+.13*Math.sin(t*.003+d.ph))*(d.H?1.5:1);
      if(d.H)x.drawImage(glowSprite(curCol),d.px-r*4.2,d.py-r*4.2,r*8.4,r*8.4);else x.drawImage(spr,d.px-r*3.2,d.py-r*3.2,r*6.4,r*6.4);}
    x.globalCompositeOperation='source-over';
    for(const d of list){const r=rd*(d.H?1.35:1)*(1+.08*Math.sin(t*.003+d.ph));x.fillStyle=d.H?'#fff':'#e9fbff';x.beginPath();x.arc(d.px,d.py,r,0,6.283);x.fill();}
  },
  particle(x,p,u,px,py,s){x.drawImage(glowSprite(p.col),px-s,py-s,s*2,s*2);},
  popup(x,text,col){x.lineJoin='round';x.strokeStyle='rgba(0,0,10,.75)';x.lineWidth=7;x.strokeText(text,0,0);x.shadowColor=col;x.shadowBlur=18;x.fillStyle=light(col,.25);x.fillText(text,0,0);x.shadowBlur=0;}
};

/* --- PENCIL & PAPER: graph paper, pencil dots, marker lines, scribbled-in squares --- */
function paperBG(x,w,h,t,al){
  x.fillStyle='#fbf9f1';x.fillRect(0,0,w,h);
  let p=24,M=p*5,ox=0,oy=0;
  if(al){const k=Math.max(2,Math.round(al.sp/24));p=al.sp/k;M=al.sp;ox=al.ox;oy=al.oy;}
  const grid=(step,style,lw)=>{
    x.strokeStyle=style;x.lineWidth=lw;x.beginPath();
    for(let X=((ox%step)+step)%step;X<w;X+=step){x.moveTo(X,0);x.lineTo(X,h);}
    for(let Y=((oy%step)+step)%step;Y<h;Y+=step){x.moveTo(0,Y);x.lineTo(w,Y);}
    x.stroke();
  };
  grid(p,'rgba(70,130,200,.16)',1);grid(M,'rgba(70,130,200,.30)',1.2);
  for(let i=0,n=w*h/2600;i<n;i++){const c=hsh(i*3+3);x.fillStyle='rgba(120,100,70,'+(.03+c*.05)+')';x.fillRect(hsh(i*3+1)*w,hsh(i*3+2)*h,1+c*1.5,1+c*1.5);}
}
const PAPER={
  label:'Pencil & Paper',sub:'Graph paper + markers',meta:'#f7f4ea',tie:'#c98a00',accent:'#2357d6',glow:false,additive:false,outline:'#33363d',staticBG:true,miniBG:true,under:true,
  font:'"Permanent Marker","Marker Felt","Comic Sans MS",cursive',fontW:'400',
  pal:[{n:'TEAL',c:'#0a9bb5'},{n:'MAGENTA',c:'#d6249f'},{n:'GREEN',c:'#2e9e3e'},{n:'ORANGE',c:'#f07b12'},
    {n:'YELLOW',c:'#f2c200'},{n:'PURPLE',c:'#7a3fc8'},{n:'RED',c:'#e02b36'},{n:'BLUE',c:'#2357d6'},
    {n:'SEA GREEN',c:'#14a083'},{n:'PINK',c:'#f2679f'},{n:'BLACK',c:'#2c2d31'},{n:'BROWN',c:'#8b5a2b'}],
  bg:paperBG,
  cell(){},
  guide(x,lw,sp){x.setLineDash([1.5,Math.max(5,sp*.08)]);x.lineWidth=Math.max(1.2,lw*.28);x.strokeStyle='rgba(60,62,70,.30)';},
  wall(x,x1,y1,x2,y2,lw,seed){
    const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
    x.save();x.lineCap='round';x.strokeStyle='rgba(52,54,60,.6)';x.lineWidth=Math.max(1.2,lw*.42);
    for(let i=0;i<5;i++){
      const o1=(i-2)*lw*.32+jit(seed,i)*lw*.3,o2=o1+jit(seed,i+29)*lw*.3,e1=jit(seed,i+9)*lw*.6,e2=jit(seed,i+19)*lw*.6;
      x.beginPath();x.moveTo(x1+nx*o1-ux*e1,y1+ny*o1-uy*e1);x.lineTo(x2+nx*o2+ux*e2,y2+ny*o2+uy*e2);x.stroke();
    }
    x.restore();
  },
  line(x,x1,y1,x2,y2,col,lw,a,seed,k){
    const dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy);if(len<1)return;
    const ux=dx/len,uy=dy/len,nx=-uy,ny=ux,s=seed<0?7:seed;
    const o1=jit(s,1)*lw*.5,o2=jit(s,2)*lw*.5,e1=lw*(.1+jit(s,4)*.3),e2=lw*(.1+jit(s,5)*.3);
    const ax=x1-ux*e1+nx*o1,ay=y1-uy*e1+ny*o1,bx=x2+ux*e2+nx*o2,by=y2+uy*e2+ny*o2;
    const bow=jit(s,3)*lw*.9,cx=(ax+bx)/2+nx*bow,cy=(ay+by)/2+ny*bow;
    const N=12,m=Math.max(1,Math.round(N*k));
    x.save();x.lineCap='round';x.lineJoin='round';x.globalCompositeOperation='multiply';
    x.beginPath();x.moveTo(ax,ay);
    for(let i=1;i<=m;i++){const q=i/N,iq=1-q;x.lineTo(iq*iq*ax+2*iq*q*cx+q*q*bx,iq*iq*ay+2*iq*q*cy+q*q*by);}
    x.strokeStyle=rgba(col,.92*a);x.lineWidth=lw*1.3;x.stroke();
    x.globalCompositeOperation='source-over';x.translate(nx*lw*.25,ny*lw*.25);
    x.strokeStyle='rgba(255,255,255,'+(.12*a)+')';x.lineWidth=lw*.28;x.stroke();
    x.restore();
  },
  tip(x,ex,ey,col,lw){x.fillStyle=rgba(col,.9);x.beginPath();x.arc(ex,ey,lw*.75,0,6.283);x.fill();},
  dragTip(x,px,py,col,lw){x.fillStyle=rgba(col,.9);x.beginPath();x.arc(px,py,lw*.75,0,6.283);x.fill();},
  captured(x,col,X,Y,sp,lw,age,seed){
    if(age<0)return;const u=age<650?easeOut(age/650):1;
    const ins=lw*.8+2,x0=X+ins,y0=Y+ins,w=sp-2*ins;if(w<=2)return;
    // diagonal zig-zag, like colouring the square in with a marker
    const n=Math.max(4,Math.round(w/(lw*1.35))),pts=[];
    for(let i=0;i<=n;i++){
      const d=i/n*2*w,ax=Math.max(0,d-w),bx=Math.min(w,d);
      const A=[x0+ax+jit(seed,i*2)*lw*.5,y0+d-ax+jit(seed,i*2+1)*lw*.5],B=[x0+bx+jit(seed,i*2+40)*lw*.5,y0+d-bx+jit(seed,i*2+41)*lw*.5];
      if(i%2)pts.push(A,B);else pts.push(B,A);
    }
    const m=Math.max(2,Math.ceil(pts.length*u));
    x.save();x.beginPath();x.rect(x0-lw*.4,y0-lw*.4,w+lw*.8,w+lw*.8);x.clip();
    x.globalCompositeOperation='multiply';x.lineCap='round';x.lineJoin='round';
    x.beginPath();x.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<m;i++)x.lineTo(pts[i][0],pts[i][1]);
    x.strokeStyle=rgba(col,.36);x.lineWidth=lw*2.6;x.stroke();
    x.strokeStyle=rgba(col,.14);x.lineWidth=lw*.9;x.stroke();
    x.restore();
  },
  lastMove(x,x1,y1,x2,y2,col,lw,a){x.save();x.lineCap='round';x.strokeStyle='rgba(255,226,60,'+(a*.9)+')';x.lineWidth=lw*3.4;x.beginPath();x.moveTo(x1,y1);x.lineTo(x2,y2);x.stroke();x.restore();},
  dots(x,list,rd,t,curCol){
    for(const d of list){
      const r=rd*(d.H?1.25:1)*.9;
      if(d.H&&curCol){x.strokeStyle=rgba(curCol,.85);x.lineWidth=Math.max(1.5,rd*.5);x.beginPath();x.arc(d.px,d.py,r*2.3,0,6.283);x.stroke();}
      x.fillStyle='rgba(58,60,66,.85)';x.beginPath();
      for(let i=0;i<7;i++){const an=i/7*6.283,rr=r*(1+jit(d.seed,i)*.38),px=d.px+Math.cos(an)*rr,py=d.py+Math.sin(an)*rr;if(i)x.lineTo(px,py);else x.moveTo(px,py);}
      x.closePath();x.fill();
      x.strokeStyle='rgba(40,42,48,.35)';x.lineWidth=Math.max(.8,rd*.3);x.beginPath();x.arc(d.px+jit(d.seed,8)*r*.5,d.py+jit(d.seed,9)*r*.5,r*.9,0,6.283);x.stroke();
    }
  },
  particle(x,p,u,px,py,s){x.fillStyle=p.col;x.beginPath();x.arc(px,py,s*.28,0,6.283);x.fill();},
  popup(x,text,col){x.lineJoin='round';x.strokeStyle='#fffdf6';x.lineWidth=8;x.strokeText(text,0,0);x.fillStyle=col;x.fillText(text,0,0);}
};

/* --- TOY BOX: studs for dots, snap-together bricks for lines, studded plates for squares --- */
function toyBG(x,w,h){
  const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,'#e3e9f0');g.addColorStop(1,'#c4cfdb');x.fillStyle=g;x.fillRect(0,0,w,h);
  const p=36,r=10;
  for(let Y=p/2;Y<h+p;Y+=p)for(let X=p/2;X<w+p;X+=p){
    x.fillStyle='rgba(0,40,90,.09)';x.beginPath();x.arc(X+1.5,Y+2.5,r,0,6.283);x.fill();
    x.fillStyle='rgba(255,255,255,.35)';x.beginPath();x.arc(X,Y,r,0,6.283);x.fill();
    x.strokeStyle='rgba(255,255,255,.5)';x.lineWidth=1.5;x.beginPath();x.arc(X,Y,r*.62,3.4,5.0);x.stroke();
  }
}
function stud(x,cx,cy,r,col){
  x.fillStyle='rgba(0,30,70,.28)';x.beginPath();x.arc(cx+r*.1,cy+r*.3,r,0,6.283);x.fill();
  const g=x.createRadialGradient(cx-r*.35,cy-r*.4,r*.1,cx,cy,r);g.addColorStop(0,light(col,.45));g.addColorStop(1,shade(col,.08));
  x.fillStyle=g;x.beginPath();x.arc(cx,cy,r,0,6.283);x.fill();x.strokeStyle=shade(col,.25);x.lineWidth=1;x.stroke();
}
function brick(x,x1,y1,x2,y2,col,lw,a,studs){
  const th=lw*2.3,hz=Math.abs(x2-x1)>=Math.abs(y2-y1);let X,Y,w,h;
  if(hz){X=Math.min(x1,x2);w=Math.abs(x2-x1);Y=y1-th/2;h=th;}else{Y=Math.min(y1,y2);h=Math.abs(y2-y1);X=x1-th/2;w=th;}
  if(Math.max(w,h)<th*.5)return;
  const r=th*.28;x.save();x.globalAlpha=a;
  x.fillStyle='rgba(0,30,70,.25)';rrect(x,X+th*.06,Y+th*.2,w,h,r);x.fill();
  const g=hz?x.createLinearGradient(0,Y,0,Y+h):x.createLinearGradient(X,0,X+w,0);
  g.addColorStop(0,light(col,.35));g.addColorStop(.45,col);g.addColorStop(1,shade(col,.22));
  x.fillStyle=g;rrect(x,X,Y,w,h,r);x.fill();x.strokeStyle=shade(col,.3);x.lineWidth=1;x.stroke();
  if(studs){const n=Math.max(1,Math.round(Math.max(w,h)/(th*1.8))),sr=th*.24;
    for(let i=0;i<n;i++){const f=(i+.5)/n,sx=hz?X+w*f:X+w/2,sy=hz?Y+h/2:Y+h*f;
      x.fillStyle=shade(col,.18);x.beginPath();x.arc(sx+sr*.12,sy+sr*.25,sr,0,6.283);x.fill();
      x.fillStyle=light(col,.22);x.beginPath();x.arc(sx,sy,sr,0,6.283);x.fill();
      x.fillStyle='rgba(255,255,255,.55)';x.beginPath();x.arc(sx-sr*.3,sy-sr*.3,sr*.35,0,6.283);x.fill();}}
  x.restore();
}
const TOY={
  label:'Toy Box',sub:'Snap-together bricks',meta:'#dfe6ee',tie:'#f29a00',accent:'#1f5fd6',glow:false,additive:false,outline:'#ffffff',staticBG:true,miniBG:true,under:true,
  font:'Fredoka,"Arial Rounded MT Bold","Avenir Next",system-ui,sans-serif',fontW:'700',
  pal:[{n:'AZURE',c:'#1eb4e6'},{n:'MAGENTA',c:'#d63aa8'},{n:'GREEN',c:'#3fae3a'},{n:'ORANGE',c:'#ff8a1c'},
    {n:'YELLOW',c:'#ffcf2e'},{n:'PURPLE',c:'#8e4fd6'},{n:'RED',c:'#e3262f'},{n:'BLUE',c:'#1f4fc4'},
    {n:'TEAL',c:'#16b3a0'},{n:'PINK',c:'#ff8fb8'},{n:'BLACK',c:'#30343c'},{n:'BROWN',c:'#8b5a2b'}],
  bg:toyBG,
  cell(x,X,Y,sp){x.fillStyle='rgba(255,255,255,.4)';rrect(x,X+2,Y+2,sp-4,sp-4,sp*.08);x.fill();},
  guide(x,lw,sp){x.setLineDash([2,Math.max(6,sp*.09)]);x.lineWidth=Math.max(1.5,lw*.4);x.strokeStyle='rgba(60,80,110,.35)';},
  wall(x,x1,y1,x2,y2,lw){brick(x,x1,y1,x2,y2,'#6c7683',lw,1,false);},
  line(x,x1,y1,x2,y2,col,lw,a,seed,k){if(k<1){x2=lerp(x1,x2,k);y2=lerp(y1,y2,k);}brick(x,x1,y1,x2,y2,col,lw,a,true);},
  tip(){},
  dragTip(x,px,py,col,lw){stud(x,px,py,lw*1.1,col);},
  captured(x,col,X,Y,sp,lw,age){
    if(age<0)return;let s=1,dy=0;
    if(age<420){const u=age/420;s=Math.max(.05,easeOutBack(u));dy=-(1-easeOut(u))*sp*.25;}
    const ins=lw*.9+3,w=sp-2*ins,cx=X+sp/2,cy=Y+sp/2,X0=X+ins,Y0=Y+ins,r=w*.12;
    x.save();x.translate(cx,cy+dy);x.scale(s,s);x.translate(-cx,-cy);
    x.fillStyle='rgba(0,30,70,.25)';rrect(x,X0+w*.03,Y0+w*.06,w,w,r);x.fill();
    const g=x.createLinearGradient(X0,Y0,X0+w,Y0+w);g.addColorStop(0,light(col,.3));g.addColorStop(1,shade(col,.15));
    x.fillStyle=g;rrect(x,X0,Y0,w,w,r);x.fill();x.strokeStyle=shade(col,.3);x.lineWidth=1;x.stroke();
    for(const fx of [.3,.7])for(const fy of [.3,.7])stud(x,X0+w*fx,Y0+w*fy,w*.13,col);
    x.restore();
  },
  lastMove(x,x1,y1,x2,y2,col,lw,a){x.save();x.lineCap='round';x.strokeStyle='rgba(255,255,255,'+a+')';x.lineWidth=lw*3;x.beginPath();x.moveTo(x1,y1);x.lineTo(x2,y2);x.stroke();x.restore();},
  dots(x,list,rd,t,curCol){for(const d of list)stud(x,d.px,d.py,rd*(d.H?1.55:1.3),d.H&&curCol?curCol:'#f4f6f9');},
  particle(x,p,u,px,py,s){const w=s*.6,h=s*.38;x.save();x.translate(px,py);x.rotate(p.s*9+u*5);x.fillStyle=p.col;x.fillRect(-w/2,-h/2,w,h);x.fillStyle='rgba(255,255,255,.4)';x.fillRect(-w/2,-h/2,w,h*.3);x.restore();},
  popup(x,text,col){x.lineJoin='round';x.fillStyle='rgba(0,30,70,.25)';x.fillText(text,0,4);x.strokeStyle='#fff';x.lineWidth=9;x.strokeText(text,0,0);x.fillStyle=col;x.fillText(text,0,0);}
};
const THEMES={neon:NEON,paper:PAPER,toy:TOY};
let TH=NEON;
/* a player's colour slot, from a saved/legacy player that may only carry a hex */
function ciOf(p,i){
  if(Number.isInteger(p.ci)&&p.ci>=0&&p.ci<NCOL)return p.ci;
  for(const T of Object.values(THEMES)){const k=T.pal.findIndex(q=>q.c===p.color);if(k>=0)return k;}
  return i%NCOL;
}
function setTheme(id){
  if(!THEMES[id])id='neon';
  TH=THEMES[id];document.documentElement.dataset.theme=id;store.set(K_THEME,id);
  const m=$('meta[name=theme-color]');if(m)m.setAttribute('content',TH.meta);
  bgDirty=true;
  if(G){
    G.players.forEach(p=>p.color=TH.pal[p.ci].c);
    G.fx.parts.length=0;G.fx.pops.length=0;G.fx.groups.length=0;
    buildHUD();updateHUD(true);if(!G.over)setFrame(G.players[G.S.cur].color);dirty();
  }
  if(curScreen==='players')renderPlayers();
  if(curScreen==='board'){renderBoardSetup();drawPreview();}
}
/* the small live sample on each theme button */
function drawThemeSample(cv,T){
  const dpr=Math.min(window.devicePixelRatio||1,2),w=cv.clientWidth||150,h=cv.clientHeight||84;
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);
  const sp=Math.min(w/4.2,h/2.6),ox=(w-3*sp)/2,oy=(h-2*sp)/2,lw=clamp(sp*.085,2,5),rd=clamp(sp*.072,2,4);
  const P=(c,r)=>[ox+c*sp,oy+r*sp],ln=(a,b,col)=>T.line(x,...P(a[0],a[1]),...P(b[0],b[1]),col,lw,1,a[0]*7+a[1]*3+b[0],1);
  T.bg(x,w,h,0,{ox,oy,sp});
  for(let r=0;r<2;r++)for(let c=0;c<3;c++)T.cell(x,ox+c*sp,oy+r*sp,sp);
  T.captured(x,T.pal[0].c,ox,oy,sp,lw,1e9,1);T.captured(x,T.pal[1].c,ox+2*sp,oy+sp,sp,lw,1e9,5);
  T.wall(x,...P(1,1),...P(1,2),lw,3);
  [[[0,0],[1,0]],[[1,0],[1,1]],[[0,1],[1,1]],[[0,0],[0,1]]].forEach(s=>ln(s[0],s[1],T.pal[0].c));
  [[[2,1],[3,1]],[[3,1],[3,2]],[[2,2],[3,2]],[[2,1],[2,2]]].forEach(s=>ln(s[0],s[1],T.pal[1].c));
  ln([1,0],[2,0],T.pal[2].c);
  const list=[];for(let r=0;r<=2;r++)for(let c=0;c<=3;c++)list.push({px:ox+c*sp,py:oy+r*sp,H:false,ph:c*1.3+r*1.9,seed:r*4+c});
  T.dots(x,list,rd,0,null);
}

/* =====================================================================
   SETUP STATE + SCREENS
   ===================================================================== */
function defaultSetup(){
  return {seats:1,players:[
    {name:'Player 1',cpu:false,diff:'medium',color:0,touched:false},
    {name:ROBOTS[0],cpu:true,diff:'medium',color:1,touched:false},
    {name:'Player 3',cpu:false,diff:'medium',color:2,touched:false},
    {name:'Player 4',cpu:false,diff:'medium',color:3,touched:false}],
    shape:'square',dots:6,dotsW:6,dotsH:6,walls:'none',seed:1,scoring:0};
}
let setup=defaultSetup();
function sanitizeSetup(s){
  const d=defaultSetup();if(!s||typeof s!=='object')return d;
  try{
    const o=defaultSetup();
    o.seats=[1,2,3,4].includes(s.seats)?s.seats:1;
    if(Array.isArray(s.players))for(let i=0;i<4;i++){const p=s.players[i];if(!p)continue;
      o.players[i]={name:String(p.name||o.players[i].name).slice(0,14),cpu:!!p.cpu,diff:C.DIFFS.includes(p.diff)?p.diff:'medium',color:clamp(p.color|0,0,NCOL-1),touched:!!p.touched};}
    // unique colours
    const used=new Set();for(let i=0;i<4;i++){let c=o.players[i].color;if(used.has(c)){for(let k=0;k<NCOL;k++)if(!used.has(k)){c=k;break;}}o.players[i].color=c;used.add(c);}
    o.shape=C.SHAPES.includes(s.shape)?s.shape:'square';
    o.dots=clamp(s.dots|0||6,3,12);o.dotsW=clamp(s.dotsW|0||6,3,12);o.dotsH=clamp(s.dotsH|0||6,3,12);
    o.walls=['none','scattered','rooms','maze'].includes(s.walls)?s.walls:'none';
    o.seed=(s.seed|0)||1;o.scoring=s.scoring===1?1:0;
    if(o.seats===1){o.players[0].cpu=false;o.players[1].cpu=true;}
    enforceMin(o);
    return o;
  }catch(e){return d;}
}
function enforceMin(s){const m=C.SHAPE_MIN_DOTS[s.shape]||3;if(s.shape!=='rect')s.dots=Math.max(s.dots,m);}
function saveSetup(){store.set(K_SETUP,setup);}
function nPlayers(s){return s.seats===1?2:s.seats;}
function robotName(i){return ROBOTS[(i+3)%4];}
function defaultName(i,cpu){return cpu?robotName(i):'Player '+(i+1);}

/* screens */
let curScreen='title';
function go(name){
  curScreen=name;document.body.dataset.screen=name;bgDirty=true;
  $$('.screen').forEach(s=>s.classList.toggle('active',s.id==='s-'+name));
  if(name==='title')refreshResume();
  if(name==='players')renderPlayers();
  if(name==='board'){renderBoardSetup();requestAnimationFrame(drawPreview);}
  if(name==='game')requestAnimationFrame(()=>{layout();dirty();});
}
$$('[data-back]').forEach(b=>b.addEventListener('click',()=>{A.click();go(b.dataset.back);}));

/* modals */
const openModals=new Set();
function openModal(id){
  $('#'+id).classList.add('open');openModals.add(id);
  if(curScreen==='game'&&G&&!G.over&&id!=='m-over')pauseGame();
}
function closeModal(id){
  $('#'+id).classList.remove('open');openModals.delete(id);
  if(id==='m-diff'&&curScreen==='players')return;
  if(curScreen==='game'&&G&&!G.over&&![...openModals].some(m=>m!=='m-over'))resumeGame();
}
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>{A.click();closeModal(b.dataset.close);}));
$$('.modal').forEach(m=>m.addEventListener('pointerdown',e=>{if(e.target===m&&m.id!=='m-over')closeModal(m.id);}));

/* title */
$('#btnPlay').addEventListener('click',()=>{A.click();go('players');});
$('#btnHow').addEventListener('click',()=>{A.click();openModal('m-how');});
$('#btnTitleSet').addEventListener('click',()=>{A.click();openSettings();});
$('#btnResume').addEventListener('click',()=>{A.click();resumeSaved();});
function refreshResume(){$('#btnResume').style.display=loadSave()?'':'none';}

/* players screen */
let diffSeat=-1;
function renderPlayers(){
  const seg=$('#seatSeg');seg.innerHTML='';
  [[1,'Solo vs CPU'],[2,'2'],[3,'3'],[4,'4']].forEach(([n,l])=>{
    const b=document.createElement('button');b.className='btn'+(setup.seats===n?' on':'');b.textContent=n===1?l:l+' players';
    b.addEventListener('click',()=>{A.click();setSeats(n);});seg.appendChild(b);
  });
  const cards=$('#cards');cards.innerHTML='';
  const np=nPlayers(setup);
  for(let i=0;i<np;i++){
    const p=setup.players[i],col=TH.pal[p.color].c,locked=setup.seats===1;
    const d=document.createElement('div');d.className='card';d.style.setProperty('--pc',col);d.style.setProperty('--pcg',col+'44');
    d.innerHTML='<div class="top"><div class="num">'+(i+1)+'</div><input type="text" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Player name"></div>'+
      '<div class="mid"><div class="seg"><button class="btn h'+(p.cpu?'':' on')+'">Human</button><button class="btn c'+(p.cpu?' on':'')+'">CPU</button></div></div>'+
      '<div class="swatches"></div>';
    const inp=$('input',d);inp.value=p.name;
    inp.addEventListener('input',()=>{p.name=inp.value;p.touched=inp.value!==defaultName(i,p.cpu);saveSetup();});
    inp.addEventListener('blur',()=>{if(!inp.value.trim()){p.name=defaultName(i,p.cpu);inp.value=p.name;p.touched=false;saveSetup();}});
    inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();});
    const bh=$('.h',d),bc=$('.c',d);
    if(locked){bh.disabled=bc.disabled=true;}
    bh.addEventListener('click',()=>{A.click();setCpu(i,false);});
    bc.addEventListener('click',()=>{A.click();setCpu(i,true);});
    if(p.cpu){
      const mid=$('.mid',d);
      const chip=document.createElement('span');chip.className='cpuchip';chip.textContent=DIFF_LABEL[p.diff];mid.appendChild(chip);
      const cog=document.createElement('button');cog.className='btn icon';cog.innerHTML='&#9881;';cog.setAttribute('aria-label','CPU settings');cog.style.setProperty('--c',col);
      cog.addEventListener('click',()=>{A.click();openDiff(i);});mid.appendChild(cog);
    }
    const sw=$('.swatches',d);
    TH.pal.forEach((pc,ci)=>{
      const b=document.createElement('button');b.className='sw';b.style.setProperty('--sc',pc.c);b.setAttribute('aria-label',pc.n);
      const takenBy=setup.players.findIndex((q,qi)=>qi!==i&&q.color===ci);
      if(p.color===ci)b.classList.add('sel');
      else if(takenBy>=0&&takenBy<np){b.classList.add('taken');}
      b.addEventListener('click',()=>{
        if(p.color===ci)return;
        const other=setup.players.findIndex((q,qi)=>qi!==i&&q.color===ci);
        if(other>=0&&other<np)return;
        A.click();
        if(other>=0)setup.players[other].color=p.color;
        p.color=ci;saveSetup();renderPlayers();
      });
      sw.appendChild(b);
    });
    cards.appendChild(d);
  }
  const allCpu=setup.players.slice(0,np).every(p=>p.cpu);
  $('#playersHint').textContent=setup.seats===1?'Solo mode: you vs the computer.':(allCpu?'All CPU: sit back and watch!':'');
}
function setSeats(n){setup.seats=n;if(n===1){setup.players[0].cpu=false;setup.players[1].cpu=true;for(let i=0;i<2;i++)if(!setup.players[i].touched)setup.players[i].name=defaultName(i,setup.players[i].cpu);}saveSetup();renderPlayers();}
function setCpu(i,cpu){const p=setup.players[i];p.cpu=cpu;if(!p.touched)p.name=defaultName(i,cpu);saveSetup();renderPlayers();}
function openDiff(i){
  diffSeat=i;const p=setup.players[i];$('#diffTitle').textContent=p.name.toUpperCase()+' • CPU LEVEL';
  drawDiffSeg(setup.players[i].diff,(d)=>{setup.players[i].diff=d;saveSetup();renderPlayers();drawDiffSeg(d);});
  openModal('m-diff');
}
function drawDiffSeg(cur,onPick){
  const seg=$('#diffSeg');seg.innerHTML='';
  if(onPick)seg._pick=onPick;
  C.DIFFS.forEach(d=>{
    const b=document.createElement('button');b.className='btn'+(d===cur?' on':'');b.innerHTML=DIFF_LABEL[d].toUpperCase()+'<span class="sub">'+DIFF_DESC[d]+'</span>';
    b.addEventListener('click',()=>{A.click();seg._pick&&seg._pick(d);});seg.appendChild(b);
  });
}
$('#btnToBoard').addEventListener('click',()=>{
  A.click();const np=nPlayers(setup);
  for(let i=0;i<np;i++){const p=setup.players[i];if(!p.name.trim())p.name=defaultName(i,p.cpu);}
  saveSetup();go('board');
});

/* board setup screen */
function specFromSetup(s,first){
  const np=nPlayers(s);
  const d=s.shape==='rect'?C.shapeDims('rect',s.dotsW,s.dotsH):C.shapeDims(s.shape,s.dots,s.dots);
  const mask=C.makeMask(s.shape,d.W,d.H);
  const b0=C.buildBoard(d.W,d.H,mask,[]);
  const walls=C.genWalls(b0,s.walls,s.seed);
  return {W:d.W,H:d.H,mask:Array.from(mask),walls,np,mode:s.scoring,first:first|0,shape:s.shape};
}
const shapeIcons={};
function shapeIcon(shape,cv){
  const x=cv.getContext('2d'),dpr=2;cv.width=cv.height=44*dpr;x.scale(dpr,dpr);
  const d=shape==='rect'?{W:6,H:4}:{W:5,H:5};const m=C.makeMask(shape,d.W,d.H);
  const cs=Math.min(40/d.W,40/d.H),ox=(44-d.W*cs)/2,oy=(44-d.H*cs)/2;
  x.fillStyle=TH.accent;if(TH.glow){x.shadowColor=TH.accent;x.shadowBlur=6;}
  for(let r=0;r<d.H;r++)for(let c=0;c<d.W;c++)if(m[r*d.W+c])x.fillRect(ox+c*cs+1,oy+r*cs+1,cs-2,cs-2);
}
function renderBoardSetup(){
  enforceMin(setup);
  const sh=$('#shapes');sh.innerHTML='';
  C.SHAPES.forEach(s=>{
    const b=document.createElement('button');b.className='btn seg-b'+(setup.shape===s?' on':'');
    const cv=document.createElement('canvas');b.appendChild(cv);b.appendChild(document.createTextNode(SHAPE_LABEL[s]));
    b.addEventListener('click',()=>{A.click();setup.shape=s;enforceMin(setup);saveSetup();renderBoardSetup();drawPreview();});
    sh.appendChild(b);shapeIcon(s,cv);
  });
  const st=$('#steppers');st.innerHTML='';
  const mk=(label,key,min)=>{
    const r=document.createElement('div');r.className='stepper';
    r.innerHTML='<span class="nm">'+label+'</span><button class="btn icon" aria-label="less">&minus;</button><span class="val">'+setup[key]+'</span><button class="btn icon" aria-label="more">+</button>';
    const [bm,bp]=$$('button',r);bm.disabled=setup[key]<=min;bp.disabled=setup[key]>=12;
    bm.addEventListener('click',()=>{A.click();setup[key]=Math.max(min,setup[key]-1);saveSetup();renderBoardSetup();drawPreview();});
    bp.addEventListener('click',()=>{A.click();setup[key]=Math.min(12,setup[key]+1);saveSetup();renderBoardSetup();drawPreview();});
    st.appendChild(r);
  };
  if(setup.shape==='rect'){mk('WIDTH','dotsW',3);mk('HEIGHT','dotsH',3);}
  else mk('DOTS','dots',C.SHAPE_MIN_DOTS[setup.shape]||3);
  const ws=$('#wallSeg');ws.innerHTML='';
  ['none','scattered','rooms','maze'].forEach(w=>{
    const b=document.createElement('button');b.className='btn'+(setup.walls===w?' on':'');b.textContent=WALL_LABEL[w];b.style.setProperty('--c','#9db2ce');
    b.addEventListener('click',()=>{A.click();setup.walls=w;saveSetup();renderBoardSetup();drawPreview();});ws.appendChild(b);
  });
  $('#btnReroll').style.display=setup.walls==='none'?'none':'';
  $('#wallHint').textContent=WALL_HINT[setup.walls];
  const ss=$('#scoreSeg');ss.innerHTML='';
  [['Classic',0],['Combo',1]].forEach(([l,v])=>{
    const b=document.createElement('button');b.className='btn'+(setup.scoring===v?' on':'');b.style.setProperty('--c',v?'#ff2bd6':'#00f0ff');b.textContent=l;
    b.addEventListener('click',()=>{A.click();setup.scoring=v;saveSetup();renderBoardSetup();});ss.appendChild(b);
  });
  $('#scoreHint').textContent=SCORE_HINT[setup.scoring];
}
$('#btnReroll').addEventListener('click',()=>{A.click();setup.seed=(Math.random()*1e9|0)+1;saveSetup();drawPreview();});
function drawBoardMini(cv,spec){
  // clientWidth, not getBoundingClientRect: the screen is still mid slide-in (scaled) when this runs
  const dpr=Math.min(window.devicePixelRatio||1,3),cw=Math.round((cv.clientWidth||340)*dpr),ch=Math.round((cv.clientHeight||340)*dpr);
  if(cv.width!==cw||cv.height!==ch){cv.width=cw;cv.height=ch;}
  const x=cv.getContext('2d'),T=TH;x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,cw,ch);
  const b=C.buildBoard(spec.W,spec.H,spec.mask,spec.walls);
  const pad=cw*.09,sp=Math.min((cw-2*pad)/spec.W,(ch-2*pad)/spec.H),ox=(cw-spec.W*sp)/2,oy=(ch-spec.H*sp)/2;
  const lw=clamp(sp*.085,2*dpr,9*dpr),rd=clamp(sp*.072,1.5*dpr,8*dpr);
  if(T.miniBG)T.bg(x,cw,ch,0,{ox,oy,sp});
  for(let i=0;i<b.WH;i++)if(b.mask[i])T.cell(x,ox+(i%b.W)*sp,oy+((i/b.W)|0)*sp,sp);
  x.save();x.lineCap='round';T.guide(x,lw,sp);x.beginPath();
  for(let e=0;e<b.nE;e++)if(b.exists[e]&&!b.isWall[e]){x.moveTo(ox+b.ex1[e]*sp,oy+b.ey1[e]*sp);x.lineTo(ox+b.ex2[e]*sp,oy+b.ey2[e]*sp);}
  x.stroke();x.restore();
  for(let e=0;e<b.nE;e++)if(b.isWall[e])T.wall(x,ox+b.ex1[e]*sp,oy+b.ey1[e]*sp,ox+b.ex2[e]*sp,oy+b.ey2[e]*sp,lw,e);
  const list=[];for(let y=0;y<=b.H;y++)for(let c=0;c<=b.W;c++)if(b.dotUsed[y*(b.W+1)+c])list.push({px:ox+c*sp,py:oy+y*sp,H:false,ph:c*1.3+y*1.9,seed:y*(b.W+1)+c});
  T.dots(x,list,rd,0,null);
  return b;
}
function drawPreview(){
  const spec=specFromSetup(setup,0);const b=drawBoardMini($('#prev'),spec);
  $('#prevCount').innerHTML='<b>'+b.nCells+'</b> SQUARES'+(b.nWalls?' &middot; '+b.nWalls+' WALLS':'');
}
$('#btnStart').addEventListener('click',()=>{
  A.click();saveSetup();const np=nPlayers(setup);
  const players=[];for(let i=0;i<np;i++){const p=setup.players[i];players.push({name:(p.name.trim()||defaultName(i,p.cpu)).toUpperCase(),ci:p.color,cpu:p.cpu,diff:p.diff});}
  startGame({spec:specFromSetup(setup,0),players});
});

/* =====================================================================
   GAME CONTROLLER
   ===================================================================== */
let G=null,gameIdCtr=0;
const cv=$('#cv'),ctx=cv.getContext('2d');
const L={cw:0,ch:0,dpr:1,sp:60,ox:0,oy:0,lw:5,rd:5};
let needDraw=true;function dirty(){needDraw=true;}

function startGame(cfg){
  cancelAI();
  const spec=cfg.spec;
  G={id:++gameIdCtr,spec,players:cfg.players.map((p,i)=>{const ci=ciOf(p,i);return {name:p.name,ci,color:TH.pal[ci].c,cpu:!!p.cpu,diff:p.diff||'medium'};}),S:null,history:[],movers:[],over:false,paused:false,
    token:0,thinking:false,manual:!!cfg.manual,busyUntil:0,lineT:null,capT:null,fx:{parts:[],pops:[],groups:[]},animUntil:0,dotEdges:null,
    shake:{until:0,dur:1,amp:0},drag:null,hover:-1,lastScores:[],first:spec.first|0};
  G.S=C.stateFromSpec(spec);
  const nE=G.S.b.nE;G.lineT=new Float64Array(nE);G.capT=new Float64Array(G.S.b.WH);
  if(cfg.moves){try{for(const e of cfg.moves){if(!(G.S.b.exists[e]&&!G.S.b.isWall[e]&&!G.S.drawn[e]))break;G.movers.push(G.S.cur);C.applyMove(G.S,e);G.history.push(e);}}catch(e){}}
  buildDotEdges();buildHUD();
  openModals.forEach(m=>{if(m!=='m-over'){$('#'+m).classList.remove('open');openModals.delete(m);}});
  $('#m-over').classList.remove('open');$('#resultsPill').style.display='none';
  go('game');updateHUD(true);
  setFrame(G.players[G.S.cur].color);
  if(G.S.left===0){endGame();return;}
  showBanner();
  if(!G.manual&&G.players[G.S.cur].cpu)cpuTurn();
}
function buildDotEdges(){
  const b=G.S.b,W1=b.W+1;G.dotEdges=[];for(let i=0;i<W1*(b.H+1);i++)G.dotEdges.push([]);
  for(const e of b.drawable){G.dotEdges[b.ey1[e]*W1+b.ex1[e]].push(e);G.dotEdges[b.ey2[e]*W1+b.ex2[e]].push(e);}
}
function resumeSaved(){
  const sv=loadSave();if(!sv)return;
  startGame({spec:sv.spec,players:sv.players,moves:sv.moves});
}
function loadSave(){
  const sv=store.get(K_SAVE);
  try{
    if(!sv||sv.v!==1||!sv.spec||!Array.isArray(sv.moves)||!Array.isArray(sv.players))return null;
    const s=sv.spec;if(!(s.W>0&&s.H>0&&Array.isArray(s.mask)&&s.mask.length===s.W*s.H&&Array.isArray(s.walls)))return null;
    if(sv.players.length!==s.np)return null;
    const S=C.stateFromSpec(s,sv.moves);if(S.left===0)return null;
    return sv;
  }catch(e){return null;}
}
function saveGame(){
  if(!G||G.over||G.manual&&G.noSave)return;
  store.set(K_SAVE,{v:1,spec:G.spec,players:G.players,moves:G.history});
}
function setFrame(col){const r=document.documentElement.style;r.setProperty('--pc',col);r.setProperty('--pcg',col+'66');}
function legalNow(e){const S=G.S,b=S.b;return e>=0&&e<b.nE&&b.exists[e]===1&&!b.isWall[e]&&!S.drawn[e];}
function randomLegal(){const m=C.legalMoves(G.S);return m[(Math.random()*m.length)|0];}

/* --- AI worker plumbing --- */
let worker=null,wid=0;const pendingAI=new Map();
function initWorker(){
  try{
    const glue='\nself.onmessage=function(ev){var m=ev.data;try{var S=CORE.stateFromSpec(m.spec,m.moves);var mv=CORE.chooseMove(S,m.diff,{timeMs:m.timeMs});self.postMessage({id:m.id,move:mv});}catch(err){self.postMessage({id:m.id,error:String(err)});}};';
    const blob=new Blob(['const CORE=(function(){'+CORE_SRC+'\n})();'+glue],{type:'text/javascript'});
    worker=new Worker(URL.createObjectURL(blob));
    worker.onmessage=ev=>{const m=ev.data,p=pendingAI.get(m.id);if(!p)return;pendingAI.delete(m.id);if(m.error||typeof m.move!=='number')p.fallback();else p.done(m.move);};
    worker.onerror=()=>{worker=null;const ps=[...pendingAI.values()];pendingAI.clear();ps.forEach(p=>p.fallback());};
  }catch(e){worker=null;}
}
function cancelAI(){pendingAI.clear();}
function requestAI(g,diff,timeMs){
  return new Promise(res=>{
    const id=++wid,spec=g.spec,moves=g.history.slice();let fin=false;
    const done=m=>{if(fin)return;fin=true;pendingAI.delete(id);res(m);};
    const fallback=()=>{setTimeout(()=>{if(fin)return;let m;try{const S=C.stateFromSpec(spec,moves);m=C.chooseMove(S,diff,{timeMs:Math.min(timeMs,400)});}catch(e){m=-1;}done(m);},10);};
    if(!worker){fallback();return;}
    pendingAI.set(id,{done,fallback});
    try{worker.postMessage({id,spec,moves,diff,timeMs});}catch(e){fallback();return;}
    setTimeout(()=>{if(!fin){pendingAI.delete(id);fallback();}},timeMs+3000);
  });
}
function setThinking(v){if(!G)return;G.thinking=v;updateHUD();}
function cpuTurn(){
  const g=G;if(!g||g.over||g.paused)return;
  const p=g.players[g.S.cur];if(!p||!p.cpu){setThinking(false);return;}
  const token=++g.token;setThinking(true);
  const t0=performance.now(),wait=500+Math.random()*400,tm=p.diff==='impossible'?700:250;
  requestAI(g,p.diff,tm).then(e=>{
    const rem=Math.max(0,wait-(performance.now()-t0));
    setTimeout(()=>{
      if(G!==g||g.token!==token||g.over||g.paused)return;
      g.thinking=false;
      if(!legalNow(e))e=randomLegal();
      doMove(e);
    },rem);
  });
}
function pauseGame(){if(!G)return;G.paused=true;G.token++;G.thinking=false;updateHUD();}
function resumeGame(){
  if(!G||G.over)return;G.paused=false;
  if(!G.manual&&G.players[G.S.cur].cpu)cpuTurn();else updateHUD();
}

/* --- making a move --- */
function doMove(e){
  const g=G;if(!g||g.over)return false;
  const S=g.S,b=S.b;
  if(!legalNow(e))return false;
  const now=performance.now(),p=S.cur;
  g.lineT[e]=now;
  const code=C.applyMove(S,e);
  g.history.push(e);g.movers.push(p);
  g.busyUntil=now+230;g.hover=-1;
  A.line(p);
  const cells=C.codeCells(code);
  if(cells.length)captureFx(g,cells,p,e,now+150);
  g.animUntil=Math.max(g.animUntil,now+800);
  saveGame();updateHUD();
  if(S.left===0){endGame();return true;}
  setFrame(g.players[S.cur].color);showBanner();
  setTimeout(()=>{if(G===g)A.turn();},cells.length?420:120);
  if(!g.manual&&g.players[S.cur].cpu)cpuTurn();
  return true;
}
function cellCenter(i){const W=G.S.b.W;return {x:(i%W)+.5,y:((i/W)|0)+.5};}
function captureFx(g,cells,p,e,t0){
  const S=g.S,col=g.players[p].color,combo=S.mode===1;
  for(const c of cells)g.capT[c]=t0;
  const grp=C.groupCells(S,cells[0]);
  const n=grp.length;
  let cx=0,cy=0;for(const c of cells){const q=cellCenter(c);cx+=q.x;cy+=q.y;}cx/=cells.length;cy/=cells.length;
  const dbl=cells.length===2;
  let text,size,chime;
  if(combo&&n>=2){text='COMBO ×'+n+' → '+n*n;size=clamp(24+n*3,28,60);chime=n;}
  else{text='+'+cells.length+(dbl?' DOUBLE!':'');size=dbl?38:30;chime=combo?1:cells.length;}
  const big=combo?n:(dbl?3:1);
  const gid=g.id;
  setTimeout(()=>{
    if(G!==g)return;
    A.capture(dbl&&!combo?3:chime);
    for(const c of cells){const q=cellCenter(c);burst(q.x,q.y,col,dbl?26:18,dbl?260:190);}
    g.fx.pops.push({x:cx,y:cy,text,col,t0:performance.now(),dur:combo&&n>=4?1700:1300,size});
    if(combo&&n>=2)g.fx.groups.push({cells:grp,set:new Set(grp),col,t0:performance.now(),dur:1000});
    if(big>=4||dbl){const amp=Math.min(3+big*.8,10);g.shake={until:performance.now()+350,dur:350,amp};}
    if(n>=4&&combo)burst(cx,cy,'#ffffff',16,300);
    g.animUntil=Math.max(g.animUntil,performance.now()+1800);dirty();
  },150);
}
function burst(x,y,col,n,speed){
  const sp=L.sp||60,P=G.fx.parts,now=performance.now();
  for(let i=0;i<n;i++){const a=Math.random()*6.283,v=(.35+Math.random()*.65)*speed/sp;
    P.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,t0:now,life:500+Math.random()*500,col,s:.5+Math.random()*.9});}
  if(P.length>420)P.splice(0,P.length-420);
}
function endGame(){
  const g=G;g.over=true;g.token++;g.thinking=false;store.del(K_SAVE);updateHUD();
  setTimeout(()=>{if(G===g&&g.over)showGameOver();},1100);
}
function undo(){
  const g=G;if(!g||g.over)return;
  let i=g.history.length-1;for(;i>=0;i--)if(!g.players[g.movers[i]].cpu)break;
  if(i<0)return;
  A.undo();
  g.history.length=i;g.movers.length=i;
  const S=C.stateFromSpec(g.spec);g.movers.length=0;
  const hist=g.history.slice();g.history.length=0;
  for(const e of hist){g.movers.push(S.cur);C.applyMove(S,e);g.history.push(e);}
  g.S=S;g.lineT.fill(0);g.capT.fill(0);g.fx.parts.length=0;g.fx.pops.length=0;g.fx.groups.length=0;g.drag=null;g.hover=-1;g.token++;g.thinking=false;
  saveGame();updateHUD(true);setFrame(g.players[S.cur].color);showBanner();dirty();
  if(!g.manual&&!g.paused&&g.players[S.cur].cpu)cpuTurn();
}
$('#btnUndo').addEventListener('click',()=>undo());

/* --- HUD --- */
function buildHUD(){
  const wrap=$('#chips');wrap.innerHTML='';
  G.players.forEach((p,i)=>{
    const d=document.createElement('div');d.className='pchip';d.style.setProperty('--pc',p.color);d.style.setProperty('--pcg',p.color+'66');
    d.innerHTML='<div class="nm"><span class="n"></span><span class="dots3"><i></i><i></i><i></i></span></div><div class="sc">0</div><div class="bc"></div>';
    $('.n',d).textContent=p.name;wrap.appendChild(d);
  });
  G.lastScores=G.players.map(()=>0);
}
function updateHUD(force){
  const g=G;if(!g)return;const S=g.S,chips=$$('#chips .pchip');
  const info=S.mode===1?C.computeScores(S):null;
  chips.forEach((d,i)=>{
    const active=!g.over&&i===S.cur;
    d.classList.toggle('active',active);d.classList.toggle('think',active&&g.thinking&&g.players[i].cpu);
    const sc=$('.sc',d),v=S.scores[i];
    if(sc.textContent!==String(v)){sc.textContent=v;if(!force){sc.classList.remove('bump');void sc.offsetWidth;sc.classList.add('bump');}}
    const bc=$('.bc',d);
    if(S.mode===1)bc.innerHTML='Best combo <b>×'+(info.best[i]||0)+'</b>';
    else bc.textContent=g.players[i].cpu?'CPU · '+DIFF_LABEL[g.players[i].diff]:'';
  });
  let taken=0;for(let i=0;i<S.b.WH;i++)if(S.owner[i]>=0)taken++;
  $('#leftN').textContent=S.b.nCells-taken;
  let hasHuman=false;for(let i=0;i<g.movers.length;i++)if(!g.players[g.movers[i]].cpu){hasHuman=true;break;}
  $('#btnUndo').disabled=!hasHuman||g.over;
}
let bannerT=0;
function showBanner(){
  const g=G;if(!g||g.over)return;
  const b=$('#banner'),p=g.players[g.S.cur];
  b.textContent='TURN: '+p.name;b.style.setProperty('--pc',p.color);
  b.classList.remove('show');void b.offsetWidth;b.classList.add('show');
}

/* --- settings modal --- */
function renderThemes(){
  const seg=$('#themeSeg');seg.innerHTML='';
  Object.keys(THEMES).forEach(id=>{
    const T=THEMES[id],b=document.createElement('button');b.className='theme-opt th-'+id+(TH===T?' on':'');
    b.innerHTML='<canvas></canvas><span class="tn"></span><span class="ts"></span>';
    $('.tn',b).textContent=T.label;$('.ts',b).textContent=T.sub;
    b.addEventListener('click',()=>{if(TH===T)return;A.click();setTheme(id);renderThemes();});
    seg.appendChild(b);requestAnimationFrame(()=>drawThemeSample($('canvas',b),T));
  });
}
/* destructive buttons need a second tap within 2.5s */
function armConfirm(btn,act){
  const label=btn.textContent;
  btn._reset=()=>{clearTimeout(btn._t);delete btn.dataset.armed;btn.textContent=label;};
  btn.addEventListener('click',()=>{
    A.click();
    if(btn.dataset.armed){btn._reset();act();return;}
    btn.dataset.armed='1';btn.textContent='Tap again';btn._t=setTimeout(btn._reset,2500);
  });
}
function openSettings(){
  const inGame=curScreen==='game'&&!!G;
  $('#btnSound').textContent=A.muted?'OFF':'ON';
  renderThemes();
  $$('#m-set .game-only').forEach(el=>el.style.display=inGame?'':'none');
  $('#btnSetClose').textContent=inGame?'Resume':'Done';
  $$('#m-set .btn').forEach(b=>b._reset&&b._reset());
  const wrap=$('#setCpus');wrap.innerHTML='';
  if(inGame&&!G.over)G.players.forEach((p,i)=>{
    if(!p.cpu)return;
    const r=document.createElement('div');r.className='setrow';
    r.innerHTML='<span class="who"><i class="dsw" style="--c:'+p.color+'"></i><span class="pn"></span></span><div class="seg"></div>';
    $('.pn',r).textContent=p.name;
    const seg=$('.seg',r);
    C.DIFFS.forEach(d=>{const b=document.createElement('button');b.className='btn'+(p.diff===d?' on':'');b.style.setProperty('--c',p.color);b.textContent=DIFF_LABEL[d];
      b.addEventListener('click',()=>{A.click();p.diff=d;saveGame();$$('.btn',seg).forEach(x=>x.classList.toggle('on',x===b));updateHUD();});seg.appendChild(b);});
    wrap.appendChild(r);
  });
  openModal('m-set');
}
$('#btnCog').addEventListener('click',()=>{A.click();openSettings();});
$('#btnSound').addEventListener('click',()=>{A.setMuted(!A.muted);A.unlock();$('#btnSound').textContent=A.muted?'OFF':'ON';A.click();});
$('#btnSetHow').addEventListener('click',()=>{A.click();openModal('m-how');});
armConfirm($('#btnRestart'),()=>{closeModal('m-set');restart(false);});
armConfirm($('#btnNewGame'),()=>{closeModal('m-set');store.del(K_SAVE);cancelAI();if(G){G.token++;}go('players');});
/* quit keeps the autosave, so the title screen offers Resume game */
$('#btnQuit').addEventListener('click',()=>{
  A.click();const g=G;
  if(g){g.paused=true;g.token++;g.thinking=false;g.drag=null;}
  cancelAI();ptr=null;go('title');closeModal('m-set');
});
function restart(rotate){
  const g=G;const spec=Object.assign({},g.spec,{first:rotate?(g.first+1)%g.players.length:g.first});
  startGame({spec,players:g.players,manual:g.manual});
}

/* --- game over --- */
function showGameOver(){
  const g=G,S=g.S,info=C.computeScores(S);
  const rk=g.players.map((p,i)=>({i,name:p.name,color:p.color,score:S.scores[i],best:info.best[i]})).sort((a,b)=>b.score-a.score);
  const top=rk[0].score,winners=rk.filter(r=>r.score===top);
  const tie=winners.length>1;
  const nameEl=$('#overName');
  $('#overKick').textContent=tie?'IT\'S A DRAW':'WINNER';
  nameEl.textContent=tie?'TIE! '+winners.map(w=>w.name).join(' & '):winners[0].name;
  const col=tie?TH.tie:winners[0].color;
  const sheet=$('#m-over .sheet');sheet.style.setProperty('--pc',col);sheet.style.setProperty('--pcg',col+'55');
  let rank=0,lastScore=null;rk.forEach((r,idx)=>{if(r.score!==lastScore){rank=idx+1;lastScore=r.score;}r.rank=rank;});
  const order=[];rk.forEach((r,idx)=>{if(idx%2===0)order.push(r);else order.unshift(r);});
  const pod=$('#podium');pod.innerHTML='';
  const maxS=Math.max(1,top),maxH=pod.clientHeight?Math.min(pod.clientHeight-70,190):160;
  order.forEach(r=>{
    const d=document.createElement('div');d.className='pod'+(r.score===top?' win':'');d.style.setProperty('--pc',r.color);d.style.setProperty('--pcg',r.color+'66');
    d.innerHTML='<div class="pb"></div><div class="bar"></div><div class="pn"></div><div class="rk"></div>';
    $('.pn',d).textContent=r.name;$('.rk',d).textContent=r.rank===1?'1ST':r.rank===2?'2ND':r.rank===3?'3RD':r.rank+'TH';
    $('.pb',d).textContent=S.mode===1?'best group '+r.best:'';
    $('.bar',d).textContent=r.score;
    pod.appendChild(d);
    const bar=$('.bar',d);setTimeout(()=>{bar.style.height=(46+(maxH-46)*r.score/maxS)+'px';},250+(r.rank-1)*220);
  });
  $('#resultsPill').style.display='none';
  openModal('m-over');
  setFrame(col);
  g.winCols=tie?[TH.tie,'#ffffff']:[winners[0].color,'#ffffff',lightCol(winners[0].color)];
  A.fanfare(tie);startConfetti(g.winCols);
}
function lightCol(h){const c=rgb(h);return '#'+[c[0],c[1],c[2]].map(v=>Math.round(lerp(v,255,.5)).toString(16).padStart(2,'0')).join('');}
$('#btnRematch').addEventListener('click',()=>{A.click();stopConfetti();closeModal('m-over');restart(true);});
$('#btnOverNew').addEventListener('click',()=>{A.click();stopConfetti();closeModal('m-over');go('players');});
$('#btnOverView').addEventListener('click',()=>{A.click();stopConfetti();closeModal('m-over');$('#resultsPill').style.display='';});
$('#resultsPill').addEventListener('click',()=>{A.click();$('#resultsPill').style.display='none';openModal('m-over');startConfetti(G.winCols);});

/* confetti / fireworks on the #fx canvas */
const fxc=$('#fx'),fxx=fxc.getContext('2d');let confetti=[],confOn=false,confT=0,fwT=0,confCols=[];
function startConfetti(cols){
  confCols=cols;confOn=true;confetti=[];fwT=0;
  fxc.width=Math.round(window.innerWidth*Math.min(devicePixelRatio||1,2));fxc.height=Math.round(window.innerHeight*Math.min(devicePixelRatio||1,2));
  for(let i=0;i<110;i++)confetti.push(mkConf(true));
}
function mkConf(init){
  return {k:'c',x:Math.random(),y:init?-Math.random()*.8:-.05,vx:(Math.random()-.5)*.08,vy:.10+Math.random()*.16,r:Math.random()*6.28,vr:(Math.random()-.5)*8,w:6+Math.random()*7,h:3+Math.random()*5,col:confCols[(Math.random()*confCols.length)|0],ph:Math.random()*6.28};
}
function stopConfetti(){confOn=false;confetti=[];fxx.clearRect(0,0,fxc.width,fxc.height);}
function drawFX(t,dt){
  if(!confOn)return;
  const w=fxc.width,h=fxc.height,d=w/window.innerWidth;fxx.clearRect(0,0,w,h);
  fwT-=dt;if(fwT<=0){fwT=.55+Math.random()*.6;const cx=.15+Math.random()*.7,cy=.12+Math.random()*.4,col=confCols[(Math.random()*confCols.length)|0];
    for(let i=0;i<34;i++){const a=i/34*6.283+Math.random()*.2,v=.12+Math.random()*.16;confetti.push({k:'f',x:cx,y:cy,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:1.3,age:0,col});}}
  fxx.globalCompositeOperation=TH.additive?'lighter':'source-over';
  for(let i=confetti.length-1;i>=0;i--){
    const p=confetti[i];
    if(p.k==='c'){
      p.x+=p.vx*dt+Math.sin(t*.002+p.ph)*.0008;p.y+=p.vy*dt;p.r+=p.vr*dt;
      if(p.y>1.05){if(confOn){confetti[i]=mkConf(false);}continue;}
      fxx.save();fxx.translate(p.x*w,p.y*h);fxx.rotate(p.r);fxx.fillStyle=p.col;fxx.globalAlpha=.85;fxx.fillRect(-p.w*d/2,-p.h*d/2,p.w*d,p.h*d);fxx.restore();
    }else{
      p.age+=dt;if(p.age>p.life){confetti.splice(i,1);continue;}
      p.vy+=.08*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.985;
      const a=1-p.age/p.life;fxx.globalAlpha=a;fxx.fillStyle=p.col;fxx.beginPath();fxx.arc(p.x*w,p.y*h,(2+2*a)*d,0,6.283);fxx.fill();
      if(TH.glow){fxx.globalAlpha=a*.4;fxx.drawImage(glowSprite(p.col),p.x*w-8*d,p.y*h-8*d,16*d,16*d);}
    }
  }
  fxx.globalCompositeOperation='source-over';fxx.globalAlpha=1;
}

/* =====================================================================
   RENDERING
   ===================================================================== */
function layout(){
  // clientWidth, not getBoundingClientRect: the game screen is still scaled by its slide-in when this runs
  const wrap=$('#boardWrap'),r={width:wrap.clientWidth,height:wrap.clientHeight};if(!r.width||!r.height)return;
  L.dpr=Math.min(window.devicePixelRatio||1,3);L.cw=r.width;L.ch=r.height;
  cv.width=Math.round(r.width*L.dpr);cv.height=Math.round(r.height*L.dpr);
  if(G){
    const W=G.spec.W,H=G.spec.H,pad=Math.max(26,Math.min(r.width,r.height)*.05);
    L.sp=Math.min((r.width-pad*2)/W,(r.height-pad*2)/H,150);
    L.ox=(r.width-W*L.sp)/2;L.oy=(r.height-H*L.sp)/2;
    L.lw=clamp(L.sp*.085,3,9);L.rd=clamp(L.sp*.072,3,8);
  }
  if(G){G.fx.parts.length=0;}
  bgDirty=true;dirty();
}
new ResizeObserver(()=>{layout();sizeBG();}).observe($('#boardWrap'));
window.addEventListener('resize',()=>{sizeBG();layout();});
window.addEventListener('orientationchange',()=>setTimeout(()=>{sizeBG();layout();},250));
const dpx=x=>L.ox+x*L.sp, dpy=y=>L.oy+y*L.sp;

function cellSide(i,k){const W=G.S.b.W,c=i%W,r=(i/W)|0;
  switch(k){case 0:return [c,r,c+1,r];case 1:return [c+1,r,c+1,r+1];case 2:return [c,r+1,c+1,r+1];default:return [c,r,c,r+1];}}

let shakeX=0,shakeY=0;
function draw(t,dt){
  const g=G;if(!g)return;const S=g.S,b=S.b,sp=L.sp,lw=L.lw,T=TH,x=ctx;
  x.setTransform(L.dpr,0,0,L.dpr,0,0);x.clearRect(0,0,L.cw,L.ch);
  if(t<g.shake.until){const k=(g.shake.until-t)/g.shake.dur;shakeX=(Math.random()-.5)*2*g.shake.amp*k;shakeY=(Math.random()-.5)*2*g.shake.amp*k;}else{shakeX=shakeY=0;}
  x.translate(shakeX,shakeY);
  // cells
  for(let i=0;i<b.WH;i++){
    if(!b.mask[i])continue;const X=dpx(i%b.W),Y=dpy((i/b.W)|0);
    T.cell(x,X,Y,sp);
    const o=S.owner[i];if(o>=0)T.captured(x,g.players[o].color,X,Y,sp,lw,g.capT[i]?t-g.capT[i]:1e9,i);
  }
  // faint guides for every line still available (helps on odd shapes)
  x.save();x.lineCap='round';T.guide(x,lw,sp);x.beginPath();
  for(let i=0;i<S.left;i++){const e=S.und[i];x.moveTo(dpx(b.ex1[e]),dpy(b.ey1[e]));x.lineTo(dpx(b.ex2[e]),dpy(b.ey2[e]));}
  x.stroke();x.restore();
  // walls
  for(let e=0;e<b.nE;e++)if(b.isWall[e])T.wall(x,dpx(b.ex1[e]),dpy(b.ey1[e]),dpx(b.ex2[e]),dpy(b.ey2[e]),lw,e);
  // last-move marker: pulsing halo so everyone sees what just happened (esp. CPU moves)
  const lastE=g.history.length?g.history[g.history.length-1]:-1;let lastA=0;
  if(lastE>=0&&!g.over){const age=t-(g.lineT[lastE]||0);if(age<4000){
    lastA=Math.max(0,(age<3000?1:1-(age-3000)/1000)*(.35+.25*Math.sin(t*.008)));
    if(g.animUntil<t+50)g.animUntil=Math.min((g.lineT[lastE]||0)+4000,t+100);}}
  const lastMove=()=>{if(lastA>0){const col=g.players[g.movers[g.movers.length-1]].color;T.lastMove(x,dpx(b.ex1[lastE]),dpy(b.ey1[lastE]),dpx(b.ex2[lastE]),dpy(b.ey2[lastE]),col,lw,lastA);}};
  if(T.under)lastMove();
  // hover ghost / drag
  const curCol=g.players[S.cur].color;
  const ptrOk=canInput();
  if(g.hover>=0&&ptrOk&&!S.drawn[g.hover]){const e=g.hover;T.line(x,dpx(b.ex1[e]),dpy(b.ey1[e]),dpx(b.ex2[e]),dpy(b.ey2[e]),curCol,lw,.32,e,1);}
  const dr=g.drag;
  if(dr&&dr.dot&&ptrOk){
    if(dr.cand>=0){const e=dr.cand;T.line(x,dpx(b.ex1[e]),dpy(b.ey1[e]),dpx(b.ex2[e]),dpy(b.ey2[e]),curCol,lw*1.15,.45+.35*Math.min(1,dr.prog/.4),e,1);}
    if(dr.moved){T.line(x,dpx(dr.dot.x),dpy(dr.dot.y),dr.x,dr.y,curCol,lw*.9,.85,-1,1);T.dragTip(x,dr.x,dr.y,curCol,lw);}
  }
  // lines
  for(const e of b.drawable){
    if(!S.drawn[e])continue;
    const p=S.edgeOwner[e],col=g.players[p].color;
    const x1=dpx(b.ex1[e]),y1=dpy(b.ey1[e]),x2=dpx(b.ex2[e]),y2=dpy(b.ey2[e]),t0=g.lineT[e];
    let u=1;if(t0){u=clamp((t-t0)/160,0,1);}
    if(u<1){const k=easeOut(u);T.line(x,x1,y1,x2,y2,col,lw,1,e,k);T.tip(x,lerp(x1,x2,k),lerp(y1,y2,k),col,lw);}
    else T.line(x,x1,y1,x2,y2,col,lw,1,e,1);
  }
  if(!T.under)lastMove();
  // dots
  const W1=b.W+1,hl=new Set();
  if(dr&&dr.dot){hl.add(dr.dot.y*W1+dr.dot.x);if(dr.cand>=0){hl.add(b.ey1[dr.cand]*W1+b.ex1[dr.cand]);hl.add(b.ey2[dr.cand]*W1+b.ex2[dr.cand]);}}
  if(g.hover>=0&&ptrOk){const e=g.hover;hl.add(b.ey1[e]*W1+b.ex1[e]);hl.add(b.ey2[e]*W1+b.ex2[e]);}
  const dots=[];
  for(let y=0;y<=b.H;y++)for(let c=0;c<=b.W;c++){const k=y*W1+c;if(b.dotUsed[k])dots.push({px:dpx(c),py:dpy(y),H:hl.has(k),ph:c*1.3+y*1.9,seed:k});}
  T.dots(x,dots,L.rd,t,curCol);
  // group pulse outlines
  const F=g.fx;
  for(let i=F.groups.length-1;i>=0;i--){
    const q=F.groups[i],u=(t-q.t0)/q.dur;if(u>=1){F.groups.splice(i,1);continue;}if(u<0)continue;
    const a=(1-u)*(.6+.4*Math.sin(u*22));
    for(const c of q.cells){for(let k=0;k<4;k++){
      const n=b.cellNbr[c*4+k];if(n>=0&&q.set.has(n))continue;
      const s=cellSide(c,k);T.line(x,dpx(s[0]),dpy(s[1]),dpx(s[2]),dpy(s[3]),T.outline,lw*1.2,clamp(a,0,1),-1,1);
    }}
    x.fillStyle=rgba(q.col,.18*(1-u));for(const c of q.cells){x.fillRect(dpx(c%b.W)+2,dpy((c/b.W)|0)+2,sp-4,sp-4);}
  }
  // particles
  if(T.additive)x.globalCompositeOperation='lighter';
  for(let i=F.parts.length-1;i>=0;i--){
    const p=F.parts[i],age=t-p.t0;if(age>p.life){F.parts.splice(i,1);continue;}
    const u=age/p.life;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.97;p.vy*=.97;p.vy+=.25*dt;
    x.globalAlpha=1-u;T.particle(x,p,u,dpx(p.x),dpy(p.y),L.rd*3.4*p.s*(1-u*.6));
  }
  x.globalAlpha=1;x.globalCompositeOperation='source-over';
  // popups
  for(let i=F.pops.length-1;i>=0;i--){
    const p=F.pops[i],age=t-p.t0,u=age/p.dur;if(u>=1){F.pops.splice(i,1);continue;}
    const sc=u<.15?easeOutBack(u/.15):1,px0=dpx(p.x),py=dpy(p.y)-easeOut(u)*sp*.55,a=u>.7?1-(u-.7)/.3:1;
    x.save();x.globalAlpha=a;x.font=T.fontW+' '+Math.round(p.size)+'px '+T.font;x.textAlign='center';x.textBaseline='middle';
    const tw=x.measureText(p.text).width*sc/2+8,px=clamp(px0,tw,L.cw-tw);
    x.translate(px,py);x.scale(sc,sc);T.popup(x,p.text,p.col);x.restore();
  }
}
function animating(t){
  const g=G;if(!g)return false;
  return t<g.animUntil||g.fx.parts.length>0||g.fx.pops.length>0||g.fx.groups.length>0||!!g.drag||g.hover>=0||t<g.shake.until;
}
let lastT=0,lastDraw=0,lastBG=0;
function loop(t){
  requestAnimationFrame(loop);
  const dt=Math.min(.05,(t-lastT)/1000||.016);lastT=t;
  if(TH.staticBG){if(bgDirty){bgDirty=false;drawBG(t);}}
  else if(t-lastBG>(curScreen==='game'?50:33)){lastBG=t;drawBG(t);}
  if(confOn)drawFX(t,dt);
  if(curScreen==='game'&&G){
    const anim=animating(t);
    if(anim||needDraw||t-lastDraw>60){lastDraw=t;needDraw=false;draw(t,dt);}
  }
}

/* =====================================================================
   INPUT (Pointer Events: pen / touch / mouse)
   ===================================================================== */
let ptr=null,penDown=false,lastPen=0;
function canInput(){
  const g=G;if(!g||g.over||g.paused||curScreen!=='game')return false;
  if(openModals.size)return false;
  return !g.players[g.S.cur].cpu;
}
function toBoard(ev){const r=cv.getBoundingClientRect();return {x:ev.clientX-r.left,y:ev.clientY-r.top};}
function segDist(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1;let t=((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy);t=clamp(t,0,1);return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));}
function nearestEdge(px,py){
  const g=G,S=g.S,b=S.b,thr=Math.max(26,L.sp*.45);let best=-1,bs=1e9;
  for(let i=0;i<S.left;i++){const e=S.und[i];
    const x1=dpx(b.ex1[e]),y1=dpy(b.ey1[e]),x2=dpx(b.ex2[e]),y2=dpy(b.ey2[e]);
    const d=segDist(px,py,x1,y1,x2,y2);if(d>thr)continue;
    const sc=d+.02*Math.hypot(px-(x1+x2)/2,py-(y1+y2)/2);if(sc<bs){bs=sc;best=e;}}
  return best;
}
function nearestDot(px,py){
  const g=G,b=g.S.b,W1=b.W+1,maxd=Math.max(20,L.sp*.36);let best=null,bd=maxd;
  for(let y=0;y<=b.H;y++)for(let x=0;x<=b.W;x++){
    const list=g.dotEdges[y*W1+x];if(!list.length)continue;
    let any=false;for(const e of list)if(!g.S.drawn[e]){any=true;break;}if(!any)continue;
    const d=Math.hypot(px-dpx(x),py-dpy(y));if(d<bd){bd=d;best={x,y};}
  }
  return best;
}
function updateDrag(){
  const g=G,S=g.S,b=S.b,dr=g.drag;if(!dr||!dr.dot)return;
  const vx=dr.x-dpx(dr.dot.x),vy=dr.y-dpy(dr.dot.y);let nx=dr.dot.x,ny=dr.dot.y,prog;
  if(Math.abs(vx)>=Math.abs(vy)){nx+=vx>=0?1:-1;prog=Math.abs(vx)/L.sp;}else{ny+=vy>=0?1:-1;prog=Math.abs(vy)/L.sp;}
  const e=C.edgeBetween(b,dr.dot.x,dr.dot.y,nx,ny);
  if(e>=0&&!b.isWall[e]&&!S.drawn[e]){dr.cand=e;dr.prog=prog;}else{dr.cand=-1;dr.prog=0;}
}
function humanCommit(e){if(e>=0&&canInput()&&performance.now()>=G.busyUntil)doMove(e);}
cv.addEventListener('pointerdown',ev=>{
  if(ev.pointerType==='pen'){penDown=true;lastPen=performance.now();}
  if(!canInput())return;
  if(ev.pointerType==='touch'&&(penDown||performance.now()-lastPen<600))return;
  if(ptr&&ptr.id!==ev.pointerId)return;
  ev.preventDefault();
  const p=toBoard(ev);
  ptr={id:ev.pointerId,type:ev.pointerType,sx:p.x,sy:p.y};
  G.drag={x:p.x,y:p.y,sx:p.x,sy:p.y,dot:nearestDot(p.x,p.y),moved:false,cand:-1,prog:0};
  G.hover=-1;
  try{cv.setPointerCapture(ev.pointerId);}catch(e){}
  dirty();
});
cv.addEventListener('pointermove',ev=>{
  if(ev.pointerType==='pen')lastPen=performance.now();
  if(!G)return;
  const p=toBoard(ev);
  if(ptr&&ptr.id===ev.pointerId){
    const dr=G.drag;if(!dr)return;dr.x=p.x;dr.y=p.y;
    if(!dr.moved&&Math.hypot(p.x-dr.sx,p.y-dr.sy)>8)dr.moved=true;
    if(dr.dot&&dr.moved)updateDrag();
    dirty();ev.preventDefault();return;
  }
  if((ev.pointerType==='mouse'||ev.pointerType==='pen')&&ev.buttons===0&&canInput()){
    const e=nearestEdge(p.x,p.y);if(e!==G.hover){G.hover=e;dirty();}
  }
});
function endPtr(ev,cancel){
  if(ev.pointerType==='pen'){penDown=false;lastPen=performance.now();}
  if(!ptr||ptr.id!==ev.pointerId)return;
  const dr=G&&G.drag;const p=toBoard(ev);
  ptr=null;if(G)G.drag=null;
  try{cv.releasePointerCapture(ev.pointerId);}catch(e){}
  dirty();
  if(cancel||!dr)return;
  dr.x=p.x;dr.y=p.y;
  if(dr.moved&&dr.dot){G.drag=dr;updateDrag();G.drag=null;if(dr.cand>=0&&dr.prog>=.4)humanCommit(dr.cand);}
  else if(!dr.moved){const e=nearestEdge(dr.sx,dr.sy);if(e>=0)humanCommit(e);}
}
cv.addEventListener('pointerup',ev=>endPtr(ev,false));
cv.addEventListener('pointercancel',ev=>endPtr(ev,true));
cv.addEventListener('lostpointercapture',ev=>{if(ptr&&ptr.id===ev.pointerId&&ev.pointerType!=='mouse'){}});
cv.addEventListener('pointerleave',ev=>{if(G&&G.hover>=0){G.hover=-1;dirty();}});
/* page-level guards: no zoom, no rubber-banding, no callout */
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('gesturechange',e=>e.preventDefault());
document.addEventListener('touchmove',e=>{if(!e.target.closest('.scroll,.sheet'))e.preventDefault();},{passive:false});
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('dblclick',e=>{if(!e.target.closest('input'))e.preventDefault();});

/* =====================================================================
   TEST HOOK
   ===================================================================== */
function stateSnapshot(){
  const g=G;if(!g)return null;const S=g.S,b=S.b;
  const edges=new Array(b.nE),owners=new Array(b.WH);
  for(let e=0;e<b.nE;e++)edges[e]=!b.exists[e]?-3:b.isWall[e]?-2:S.drawn[e]?S.edgeOwner[e]:-1;
  for(let i=0;i<b.WH;i++)owners[i]=!b.mask[i]?-2:S.owner[i];
  return {board:{W:b.W,H:b.H,nCells:b.nCells,nEdges:b.nE,nDrawable:b.drawable.length,nWalls:b.nWalls,mask:Array.from(b.mask),shape:g.spec.shape},
    edges,owners,scores:Array.from(S.scores),current:S.cur,gameOver:S.left===0,left:S.left,mode:S.mode,moves:g.history.slice(),
    players:g.players.map(p=>({name:p.name,color:p.color,cpu:p.cpu,diff:p.diff})),first:g.first};
}
function cfgToSpec(cfg){
  const s=Object.assign({shape:'square',size:6,walls:'none',scoring:'classic',seed:1},cfg||{});
  const shape=s.shape,scoring=(s.scoring===1||s.scoring==='combo')?1:0;
  const dotsW=s.dotsW||s.size||6,dotsH=s.dotsH||s.size||6;
  const d=shape==='rect'?C.shapeDims('rect',dotsW,dotsH):C.shapeDims(shape,s.size||dotsW,s.size||dotsW);
  const mask=C.makeMask(shape,d.W,d.H);const b0=C.buildBoard(d.W,d.H,mask,[]);
  const walls=C.genWalls(b0,s.walls,s.seed);
  const players=(s.players&&s.players.length?s.players:[{cpu:false},{cpu:true}]).map((p,i)=>({name:(p.name||('P'+(i+1))).toUpperCase(),ci:p.ci,color:p.color,cpu:!!p.cpu,diff:p.diff||'medium'}));
  return {spec:{W:d.W,H:d.H,mask:Array.from(mask),walls,np:players.length,mode:scoring,first:s.first|0,shape},players};
}
window.__grid={
  getState:stateSnapshot,
  move(a,y1,x2,y2){
    if(!G)return false;let e=a;
    if(y1!==undefined){e=C.edgeBetween(G.S.b,a,y1,x2,y2);}
    return doMove(e);
  },
  edgeId(x1,y1,x2,y2){return G?C.edgeBetween(G.S.b,x1,y1,x2,y2):-1;},
  legalMoves(){return G?C.legalMoves(G.S):[];},
  newGame(cfg){const {spec,players}=cfgToSpec(cfg);startGame({spec,players,manual:!(cfg&&cfg.manual===false)});if(cfg&&cfg.noSave!==false&&G)G.noSave=true;return stateSnapshot();},
  aiMove(diff,opts){if(!G)return -1;const S=C.stateFromSpec(G.spec,G.history);return C.chooseMove(S,diff||G.players[G.S.cur].diff,opts||{});},
  computeScores(){return G?C.computeScores(G.S):null;},
  geom(){const r=cv.getBoundingClientRect();return {left:r.left,top:r.top,sp:L.sp,ox:L.ox,oy:L.oy,W:G&&G.spec.W,H:G&&G.spec.H};},
  undo(){undo();},
  setup:()=>setup,
  core:C,
  ui:{go,openSettings,showGameOver,openModal,closeModal,startGame,setTheme},
  version:'1.0'
};

/* =====================================================================
   BOOT
   ===================================================================== */
function boot(){
  const saved=store.get(K_SETUP);if(saved)setup=sanitizeSetup(saved);
  setTheme(store.get(K_THEME)||'neon');
  sizeBG();initWorker();
  requestAnimationFrame(loop);
  refreshResume();
}
boot();
})();
