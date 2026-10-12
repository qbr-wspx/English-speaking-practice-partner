// Attach to the installed app already launched by Explorer with a temporary
// --remote-debugging-port=18831. All practice/deletion data below are in-memory.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:18831');
const context=browser.contexts()[0], page=context.pages()[0];
const failures=[]; let nativeDialogs=0, deletes=0, discards=0;
page.on('pageerror', error=>failures.push(error.message));
page.on('dialog', async dialog=>{nativeDialogs++; await dialog.dismiss();});
await expect(page.getByText('陪练服务已就绪',{exact:true})).toBeVisible();
const builtins=await page.evaluate(async()=>{const c=await window.desktop.getConnection();return (await fetch(c.httpUrl+'/api/scenarios',{headers:{Authorization:'Bearer '+c.token}})).json();});
let custom={...builtins[0],id:'focus-test-scenario',title_zh:'焦点测试场景',source:'custom',category:'自定义'};
let history=[{id:'focus-test-history',scenario_id:builtins[0].id,scenario:builtins[0],started_at:new Date().toISOString(),status:'ended',progress:[]}];
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()), method=route.request().method();
  let json;
  if(url.pathname==='/api/scenarios' && method==='GET') json=[...builtins,...(custom?[custom]:[])];
  else if(url.pathname==='/api/sessions' && method==='GET') json=history;
  else if(url.pathname==='/api/scenarios/focus-test-scenario' && method==='DELETE'){custom=null;deletes++;json={ok:true};}
  else if(url.pathname==='/api/sessions/focus-test-history' && method==='DELETE'){history=[];deletes++;json={ok:true};}
  else { failures.push('Unexpected API in offline test: '+method+' '+url.pathname); return route.abort(); }
  await route.fulfill({json});
});
await page.routeWebSocket('**/ws/conversation*',socket=>socket.onMessage(raw=>{
  if(typeof raw!=='string')return;
  const message=JSON.parse(raw);
  if(message.type==='session.start') socket.send(JSON.stringify({type:'session.ready',session_id:'focus-test-practice',turn_id:'opening',message_id:'opening',opening_line:'Test conversation.',progress:[]}));
  if(message.type==='session.discard'){discards++;socket.send(JSON.stringify({type:'session.discarded'}));}
}));
await page.reload();
await expect(page.locator('.scenario-tile')).toHaveCount(builtins.length+1);
async function checkInputs(index) {
  const level=page.locator('.level-select select');
  await level.click(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(level).toHaveValue('B1');
  await page.getByRole('button',{name:'自定义场景',exact:true}).click();
  const input=page.getByRole('textbox',{name:'场景描述',exact:true});
  await input.click(); await input.pressSequentially('Focus check '+index,{delay:5});
  await expect(input).toHaveValue('Focus check '+index); await expect(input).toBeFocused();
  await page.getByRole('button',{name:'关闭编辑',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'自定义场景',exact:true})).toBeFocused();
}
try {
  for(let i=0;i<20;i++) {
    await page.getByRole('button',{name:/^练习记录/}).click();
    await page.getByRole('button',{name:'删除练习',exact:true}).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    if(i%2) await page.keyboard.press('Escape'); else await page.getByRole('alertdialog').getByRole('button',{name:'取消'}).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.getByRole('button',{name:'场景练习',exact:true}).click();
    await checkInputs(i);
  }
  await page.getByRole('button',{name:/你的场景 焦点测试场景/}).click();
  await page.getByRole('button',{name:'删除场景',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'删除场景',exact:true}).click();
  await expect(page.locator('.scenario-tile')).toHaveCount(builtins.length);
  await checkInputs('after-scenario-delete');
  await page.getByRole('button',{name:/^练习记录/}).click();
  await page.getByRole('button',{name:'删除练习',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'删除记录',exact:true}).click();
  await expect(page.getByRole('button',{name:'删除练习',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'场景练习',exact:true}).click();
  await checkInputs('after-history-delete');
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Offline focus regression test','NotAllowedError');};});
  await page.getByRole('button',{name:'开始这个场景',exact:true}).click();
  await expect(page.getByRole('button',{name:'不保存退出',exact:true})).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'不保存退出',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'取消'}).click();
  expect(discards).toBe(0);
  await page.getByRole('button',{name:'不保存退出',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'不保存退出',exact:true}).click();
  await expect(page.locator('.scenario-tile')).toHaveCount(builtins.length);
  expect(discards).toBe(1); await checkInputs('after-discard');
  expect(deletes).toBe(2); expect(nativeDialogs).toBe(0); expect(failures).toEqual([]);
  await mkdir('.cache/interaction-focus',{recursive:true});
  await page.screenshot({path:'.cache/interaction-focus/complete.png'});
  const result={cancelCycles:20,inputChecks:23,confirmedDeletes:deletes,confirmedDiscards:discards,nativeDialogs,pageErrors:failures,cloudCalls:0,data:'in-memory test fixtures; no user records changed'};
  await writeFile('.cache/interaction-focus/results.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await page.unrouteAll({behavior:'wait'});await browser.close();}
