import asyncio
from playwright.async_api import async_playwright
EV="""([type,id,ptype,x,y])=>{const c=document.getElementById('cv');const r=c.getBoundingClientRect();
 c.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:ptype,isPrimary:true,clientX:x,clientY:y,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1}));}"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch();ctx=await b.new_context(viewport={'width':1180,'height':820},device_scale_factor=2,has_touch=True);page=await ctx.new_page()
        errs=[];await page.route('**/fonts.g*/**',lambda r:r.abort())
        page.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'ERR_' not in m.text else None);page.on('pageerror',lambda e:errs.append(str(e)))
        await page.goto('file:///home/claude/the-grid/index.html');await page.wait_for_timeout(400)
        await page.evaluate("__grid.newGame({shape:'square',size:5,players:[{cpu:false},{cpu:false}]})");await page.wait_for_timeout(1500)
        g=await page.evaluate("__grid.geom()")
        def P(x,y):return g['left']+g['ox']+x*g['sp'],g['top']+g['oy']+y*g['sp']
        async def ev(t,i,pt,x,y):await page.evaluate(EV,[t,i,pt,x,y])
        async def edges():return await page.evaluate("__grid.getState().moves.length")
        res={}
        for pt in ['touch','pen','mouse']:
            n0=await edges();s=await page.evaluate("__grid.getState().current")
            # drag from dot (0,0) rightward to (1,0) with slight diagonal wobble
            x0,y0=P(0,0);x1,y1=P(0.9,0.2)
            await ev('pointerdown',7,pt,x0+2,y0+2);await ev('pointermove',7,pt,(x0+x1)/2,(y0+y1)/2);await ev('pointermove',7,pt,x1,y1);await ev('pointerup',7,pt,x1,y1)
            await page.wait_for_timeout(350)
            res[pt+'_drag']=(await edges())-n0==1
            # short drag should cancel (25% of spacing)
            n0=await edges();xa,ya=P(1,1);xb,yb=P(1.25,1)
            await ev('pointerdown',8,pt,xa,ya);await ev('pointermove',8,pt,xb,yb);await ev('pointerup',8,pt,xb,yb);await page.wait_for_timeout(350)
            res[pt+'_shortcancel']=(await edges())==n0
            # tap the midpoint of an edge (vertical edge between (2,2)-(2,3))
            n0=await edges();xm,ym=P(2,2.5)
            await ev('pointerdown',9,pt,xm+3,ym);await ev('pointerup',9,pt,xm+3,ym);await page.wait_for_timeout(350)
            res[pt+'_tap']=(await edges())-n0==1
            # cannot redraw
            n0=await edges();await ev('pointerdown',10,pt,xm,ym);await ev('pointerup',10,pt,xm,ym);await page.wait_for_timeout(350)
            res[pt+'_noredraw']=(await edges())==n0
            # new game for next pointer type
            await page.evaluate("__grid.newGame({shape:'square',size:5,players:[{cpu:false},{cpu:false}]})");await page.wait_for_timeout(300)
        # pen active -> touch ignored
        await ev('pointerdown',20,'pen',*P(0,4));n0=await edges()
        await ev('pointerdown',21,'touch',*P(2,2.5));await ev('pointerup',21,'touch',*P(2,2.5));await page.wait_for_timeout(300)
        res['palm_ignored']=(await edges())==n0
        await ev('pointerup',20,'pen',*P(0,4))
        # CPU turn ignores input
        await page.evaluate("__grid.newGame({shape:'square',size:5,players:[{cpu:false},{cpu:true}]})");await page.wait_for_timeout(300)
        await page.evaluate("__grid.move(0)");n0=await edges()
        await ev('pointerdown',30,'touch',*P(2,2.5));await ev('pointerup',30,'touch',*P(2,2.5));await page.wait_for_timeout(300)
        res['cpu_turn_ignored']=(await edges())==n0
        # walls not drawable
        await page.evaluate("__grid.newGame({shape:'square',size:5,walls:'rooms',seed:4,players:[{cpu:false},{cpu:false}]})");await page.wait_for_timeout(300)
        w=await page.evaluate("(()=>{const s=__grid.getState();return s.edges.indexOf(-2)})()")
        res['wall_move_rejected']=await page.evaluate(f"__grid.move({w})")==False
        print(res);print('all ok',all(v for k,v in res.items() if k!='wall_move_rejected') and res['wall_move_rejected']==True)
        # storage throwing
        ctx2=await b.new_context(viewport={'width':1180,'height':820});pg=await ctx2.new_page()
        e2=[];pg.on('pageerror',lambda e:e2.append(str(e)))
        await pg.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('denied')}})")
        await pg.route('**/fonts.g*/**',lambda r:r.abort())
        await pg.goto('file:///home/claude/the-grid/index.html');await pg.wait_for_timeout(500)
        await pg.click('#btnPlay');await pg.wait_for_timeout(500);await pg.click('#btnToBoard');await pg.wait_for_timeout(500);await pg.click('#btnStart');await pg.wait_for_timeout(800)
        await pg.evaluate("__grid.move(0)");print('storage-throws errors',e2,'moves',await pg.evaluate("__grid.getState().moves.length"))
        print('errors',errs)
        await b.close()
asyncio.run(main())
