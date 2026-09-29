import asyncio,sys,os
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':1180,'height':820},device_scale_factor=2,has_touch=True)
        page=await ctx.new_page()
        errs=[]
        page.on('console',lambda m:errs.append(('console',m.type,m.text)) if m.type in('error','warning') else None)
        page.on('pageerror',lambda e:errs.append(('pageerror',str(e))))
        await page.goto('file:///home/claude/the-grid/index.html')
        await page.wait_for_timeout(2500)
        await page.screenshot(path='/tmp/claude-0/t1.png')
        print(errs)
        await b.close()
asyncio.run(main())
