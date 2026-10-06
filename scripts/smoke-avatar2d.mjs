import { chromium, _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const executable = process.argv[2];
const directory = path.join(process.cwd(), '.cache', executable ? 'avatar2d-installed' : 'avatar2d-preview');
await mkdir(directory, {recursive:true});
let app, browser, page, originalConfig;
if (executable) {
  originalConfig = createHash('sha256').update(await readFile(path.join(process.env.APPDATA, 'english-speaking-companion', 'services.bin'))).digest('hex');
  app = await electron.launch({executablePath:executable,args:[],cwd:path.dirname(executable),env:{...process.env,VITE_DEV_SERVER_URL:''}});
  page = await app.firstWindow();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true));
} else { browser = await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio']});page = await browser.newPage({viewport:{width:1100,height:900}}); }
const errors=[], results={};page.on('pageerror', e=>errors.push(e.message));
try {
  if (app) {
    await expect(page.getByText('陪练服务已就绪',{exact:true})).toBeVisible({timeout:30000});
    await expect(page.locator('.avatar-2d')).toHaveAttribute('data-ready','true');
    await page.screenshot({path:path.join(directory,'home.png')});
    const url=new URL(page.url());url.searchParams.set('avatar-preview','1');await page.goto(url.href);
  } else await page.goto(process.env.AVATAR_PREVIEW_URL || 'http://127.0.0.1:18792/?avatar-preview=1');
  const avatar=page.locator('.avatar-2d');
  await expect(avatar).toHaveAttribute('data-ready','true');
  await expect(avatar).toHaveAttribute('data-mouth','closed');
  await page.getByRole('button',{name:'眨眼一次',exact:true}).click();
  await expect(avatar).toHaveAttribute('data-eyes','closed');
  await page.screenshot({path:path.join(directory,'blink.png')});
  await expect(avatar).toHaveAttribute('data-eyes','open');
  results.manualBlink=true;
  // Observe the automatic blink independently of timing-sensitive screenshots.
  await page.evaluate(()=>{window.sawBlink=false;window.avatarObserver=new MutationObserver(()=>{if(document.querySelector('.avatar-2d')?.dataset.eyes==='closed')window.sawBlink=true;});window.avatarObserver.observe(document.querySelector('.avatar-2d'),{attributes:true,attributeFilter:['data-eyes']});});
  await expect.poll(()=>page.evaluate(()=>window.sawBlink),{timeout:8000}).toBe(true);
  await page.getByLabel('减少动作（关闭自动眨眼与呼吸）').check();
  await expect(avatar).toHaveAttribute('data-eyes','open');
  expect(await page.locator('.avatar-breath').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  await page.evaluate(()=>{window.sawBlink=false;});await page.waitForTimeout(6500);
  expect(await page.evaluate(()=>window.sawBlink)).toBe(false);results.reducedMotion=true;results.automaticBlink=true;
  for(let cycle=0;cycle<3;cycle++){
    await page.getByRole('button',{name:'播放英文试听',exact:true}).click();
    await expect(avatar).toHaveAttribute('data-mouth','open',{timeout:10000});
    if(cycle===0)await page.screenshot({path:path.join(directory,'speaking.png')});
    await page.getByRole('button',{name:'打断并闭嘴',exact:true}).click();
    await expect(avatar).toHaveAttribute('data-mouth','closed');
    await expect(page.locator('.avatar-mouth')).toHaveCSS('visibility','hidden');
    await page.waitForTimeout(180);await expect(avatar).toHaveAttribute('data-mouth','closed');
  }
  results.repeatedInterrupts=3;
  await page.getByRole('button',{name:'播放英文试听',exact:true}).click();
  await expect(avatar).toHaveAttribute('data-mouth','open');
  await expect(page.getByRole('button',{name:'播放英文试听',exact:true})).toBeEnabled({timeout:15000});
  await expect(avatar).toHaveAttribute('data-mouth','closed');results.playbackCompletion=true;
  await page.getByLabel('减少动作（关闭自动眨眼与呼吸）').uncheck();
  await page.screenshot({path:path.join(directory,'idle.png')});
  results.rendererErrors=errors;results.status='passed';if(errors.length)throw Error(errors.join(';'));
  if (app) {const url=new URL(page.url());url.search='';await page.goto(url.href);await expect(page.getByText('陪练服务已就绪',{exact:true})).toBeVisible();results.returnToApp=true;}
} catch(e) {results.status='failed';results.failure=e.message;process.exitCode=1;}
finally {
  if(app){await app.close();results.configPreserved=originalConfig===createHash('sha256').update(await readFile(path.join(process.env.APPDATA,'english-speaking-companion','services.bin'))).digest('hex');}
  if(browser)await browser.close();await writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}
