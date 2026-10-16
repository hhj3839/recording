import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';

test('shared dialog supports cancellation, editing, focus restoration and mobile layout without API calls', async () => {
  const server = await createServer({
    configFile: false, plugins: [react(), {
      name: 'dialog-test-entry',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== '/__dialog-test') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml('/__dialog-test', '<html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__dialog-entry.jsx"></script></body></html>'));
        });
      },
      resolveId(id) { if (id === '/__dialog-entry.jsx') return id; },
      load(id) { if (id === '/__dialog-entry.jsx') return entry; },
    }], server: { host: '127.0.0.1', port: 0 },
  });
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ActionDialogProvider,useActionDialog} from '/app/action-dialog.tsx';
    import '/app/globals.css';
    function Demo(){const ui=useActionDialog();const [value,setValue]=React.useState('대기');return React.createElement(React.Fragment,null,
      React.createElement('button',{id:'confirm',onClick:async()=>setValue(String(await ui.confirm('저장 문장 삭제 확인\\n기존 기록 유지')))},'삭제'),
      React.createElement('button',{id:'prompt',onClick:async()=>setValue(String(await ui.prompt('문장 수정','기존 문장')))},'수정'),
      React.createElement('button',{id:'choice',onClick:async()=>setValue(String(await ui.choose('행동특성 초기화 범위',[{value:'results',label:'결과만 초기화'},{value:'all',label:'입력 내용까지 초기화'}])))},'초기화'),
      React.createElement('output',null,value))}
    createRoot(document.getElementById('root')).render(React.createElement(ActionDialogProvider,null,React.createElement(Demo)));`;
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
    const page = await browser.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const address = server.httpServer.address();
    await page.goto(`http://127.0.0.1:${address.port}/__dialog-test`);
    await page.locator('#confirm').waitFor().catch(async error => { throw new Error(JSON.stringify({ errors, body: (await page.locator('body').innerText()).slice(0,1000), cause: error.message })); });
    await page.locator('#confirm').click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('button', {name:'취소', exact:true}).evaluate(el=>el===document.activeElement), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('output').textContent==='false');
    assert.equal(await page.locator('#confirm').evaluate(el=>el===document.activeElement), true);
    await page.locator('#confirm').click();
    await page.getByRole('button',{name:'확인',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('output').textContent==='true');
    await page.setViewportSize({width:360,height:720});
    await page.locator('#prompt').click();
    await page.getByLabel('입력 내용').fill('수정한 문장');
    assert.equal(await page.getByLabel('입력 내용').evaluate(el=>getComputedStyle(el).userSelect), 'text');
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=360);
    await page.getByRole('button',{name:'확인',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('output').textContent==='수정한 문장');
    for (const width of [320,360,768,1280]) {
      await page.setViewportSize({width,height:720});
      await page.locator('#choice').click();
      const box = await page.getByRole('dialog').boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=width);
      for (const button of await page.getByRole('dialog').getByRole('button').all()) {
        const bounds = await button.boundingBox();
        assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width);
      }
      await page.getByRole('button',{name:'취소',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('output').textContent==='null');
    }
    await page.locator('#choice').click();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'detached'});
    for (const [label,value] of [['결과만 초기화','results'],['입력 내용까지 초기화','all']]) {
      await page.locator('#choice').click();
      await page.getByRole('button',{name:label,exact:true}).click();
      await page.waitForFunction(value=>document.querySelector('output').textContent===value,value);
    }
    assert.deepEqual(errors, []);
    if (process.env.TEST_CDN_FONT === 'YES') {
      const loaded = await page.evaluate(async () => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css';
        await Promise.race([new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;document.head.append(link);}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('CDN timeout')),15000))]);
        return (await document.fonts.load('16px Pretendard','학급 기록')).length;
      });
      assert.ok(loaded>0, 'Pretendard font must load from CDN');
    }
  } finally { await browser?.close(); await server.close(); }
});
