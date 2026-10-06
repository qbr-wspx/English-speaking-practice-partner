import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),directory=path.join(root,'.cache','desktop-smoke');await mkdir(directory,{recursive:true});
const app=await electron.launch({args:[root],cwd:root,env:{...process.env,DEEPSEEK_API_KEY:'render-test-only',DASHSCOPE_API_KEY:'render-test-only',DASHSCOPE_WORKSPACE_ID:'render-test-only',LINGO_TEST_DATA_DIR:path.join(directory,'data'),LINGO_TEST_PORT:'18777',VITE_DEV_SERVER_URL:''}});
try{
 const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.evaluate(()=>localStorage.clear());await page.reload();
 await expect(page.getByRole('heading',{name:'把英语用在生活里。'})).toBeVisible({timeout:30000});await expect(page.locator('.scenario-tile')).toHaveCount(8);
 await expect(page.locator('.avatar-2d')).toHaveAttribute('data-ready','true');await expect(page.locator('canvas')).toHaveCount(0);await page.screenshot({path:path.join(directory,'home.png')});
 await page.getByRole('button',{name:'练习偏好'}).click();await expect(page.locator('input[type=password]')).toHaveCount(0);await page.getByLabel('减少人物动作',{exact:false}).check();await page.keyboard.press('Escape');await expect(page.locator('.avatar-breath')).toHaveCSS('animation-name','none');
 await page.getByRole('button',{name:'自定义场景',exact:true}).click();await page.screenshot({path:path.join(directory,'editor.png')});await page.getByRole('button',{name:'关闭编辑'}).click();
 await page.addInitScript(()=>{const NativeImage=window.Image;window.Image=class extends NativeImage{set src(value){if(sessionStorage.getItem('avatar-fault')==='1'&&value.includes('a-original-matte.png'))setTimeout(()=>this.dispatchEvent(new Event('error')),0);else super.src=value;}get src(){return super.src;}};});
 await page.evaluate(()=>sessionStorage.setItem('avatar-fault','1'));await page.reload();await expect(page.locator('.avatar-fallback')).toBeVisible({timeout:30000});await page.screenshot({path:path.join(directory,'render-fallback.png')});
 await page.evaluate(()=>sessionStorage.removeItem('avatar-fault'));await page.getByRole('button',{name:'重新加载人物'}).click();await expect(page.locator('.avatar-fallback')).toHaveCount(0);await expect(page.locator('.avatar-2d')).toHaveAttribute('data-ready','true');
 const result={status:'passed',scenes:8,avatar:'2D original with expression patches',credentialsForm:false,rendererErrors:errors,reducedMotion:true,fallbackRecovery:true};if(errors.length)throw Error(errors.join(';'));await writeFile(path.join(directory,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app.close();}
