import asyncio,sys
from playwright.async_api import async_playwright
OUT='/home/claude/the-grid/screens/'
async def run(p,name,w,h):
    b=await p.chromium.launch()
    ctx=await b.new_context(viewport={'width':w,'height':h},device_scale_factor=2,has_touch=True)
    page=await ctx.new_page();errs=[]
    await page.route('**/fonts.g*/**',lambda r:r.abort())
    page.on('console',lambda m:errs.append((m.type,m.text)) if m.type=='error' and 'ERR_' not in m.text else None)
    page.on('pageerror',lambda e:errs.append(('pageerror',str(e))))
    await page.goto('file:///home/claude/the-grid/index.html');await page.wait_for_timeout(3200)
    await page.screenshot(path=f'{OUT}{name}_1_title.png')
    await page.click('#btnPlay');await page.wait_for_timeout(700)
    await page.click('#seatSeg button:nth-child(3)');await page.wait_for_timeout(200)
    await page.click('#cards .card:nth-child(3) .c');await page.wait_for_timeout(200)
    await page.click('#cards .card:nth-child(3) .btn.icon');await page.wait_for_timeout(500)
    await page.screenshot(path=f'{OUT}{name}_2a_diff.png')
    await page.click('#m-diff [data-close]');await page.wait_for_timeout(400)
    await page.screenshot(path=f'{OUT}{name}_2_players.png')
    await page.click('#btnToBoard');await page.wait_for_timeout(700)
    await page.click('#shapes button:nth-child(5)');await page.click('#wallSeg button:nth-child(3)');await page.click('#scoreSeg button:nth-child(2)');await page.wait_for_timeout(500)
    await page.screenshot(path=f'{OUT}{name}_3_board.png')
    await page.click('#btnStart');await page.wait_for_timeout(1500)
    # play random moves w/ hook
    await page.evaluate("""()=>{const g=window.__grid;let n=0;while(n<24){const m=g.legalMoves();if(!m.length)break;g.move(g.aiMove('medium'));n++;}}""")
    await page.wait_for_timeout(2500)
    await page.screenshot(path=f'{OUT}{name}_4_game.png')
    await page.evaluate("""()=>{const g=window.__grid;while(g.legalMoves().length){g.move(g.aiMove('medium'));}}""")
    await page.wait_for_timeout(3500)
    await page.screenshot(path=f'{OUT}{name}_5_over.png')
    await page.click('#btnOverView');await page.wait_for_timeout(600)
    await page.screenshot(path=f'{OUT}{name}_6_final.png')
    print(name,errs)
    await b.close()
async def main():
    async with async_playwright() as p:
        await run(p,'land',1180,820);await run(p,'port',820,1180)
asyncio.run(main())
