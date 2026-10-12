// Attach to a desktop-launched diagnostic instance; never launch it from Codex.
// Temporarily use --inspect=127.0.0.1:18829 on the shortcut, then remove it.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const targets = await (await fetch('http://127.0.0.1:18829/json/list')).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen=resolve; socket.onerror=reject; });
const restart = process.argv.includes('--restart-backend');
const expression = `(async () => {
  const req = process.mainModule.require.bind(process.mainModule);
  const { app, BrowserWindow, safeStorage } = req('electron');
  const fs=req('node:fs'), path=req('node:path');
  const window=BrowserWindow.getAllWindows()[0];
  const data=app.getPath('userData');
  const status=JSON.parse(fs.readFileSync(path.join(data,'startup-status.json'),'utf8'));
  const config=JSON.parse(safeStorage.decryptString(Buffer.from(fs.readFileSync(path.join(data,'services.bin'),'utf8'),'base64')));
  const result={pid:process.pid, parent:process.ppid, version:app.getVersion(), stage:status.stage, primaryDecryptable:['DEEPSEEK_API_KEY','DASHSCOPE_API_KEY','DASHSCOPE_WORKSPACE_ID'].every(k=>!!config[k]), events:fs.readFileSync(path.join(data,'startup-events.jsonl'),'utf8').trim().split('\\n').map(x=>JSON.parse(x).stage)};
  result.parentName=req('node:child_process').execFileSync('powershell.exe',['-NoProfile','-Command','(Get-Process -Id '+process.ppid+').ProcessName'],{windowsHide:true,encoding:'utf8'}).trim();
  if (${restart}) {
    const cp=req('node:child_process');
    const output=cp.execFileSync('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_Process -Filter "Name = \\'CafeLingoBackend.exe\\'" | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress'],{windowsHide:true,encoding:'utf8'});
    const processes=JSON.parse(output||'[]');
    const child=(Array.isArray(processes)?processes:[processes]).find(x=>x.ParentProcessId===process.pid);
    if (!child) throw Error('owned-backend-missing');
    process.kill(child.ProcessId);
    await new Promise(r=>setTimeout(r,500));
    result.restarted=await window.webContents.executeJavaScript('window.desktop.startBackend()');
  }
  result.health=await (await fetch('http://127.0.0.1:18765/health')).json();
  result.ui=await window.webContents.executeJavaScript('({scenes:document.querySelectorAll(".scenario-tile").length, errors:document.querySelectorAll(".page-error").length, ready:document.body.innerText.includes("陪练服务已就绪")})');
  result.sessionCount=await window.webContents.executeJavaScript('(async()=>{const c=await window.desktop.getConnection();return (await (await fetch(c.httpUrl+"/api/sessions",{headers:{Authorization:"Bearer "+c.token}})).json()).length})()');
  result.screenshot=(await window.webContents.capturePage()).toPNG().toString('base64');
  return result;
})()`;
try {
  const response=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('verification-timeout')),30000);
    socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1){clearTimeout(timer);resolve(m);}};
    socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  });
  assert(!response.result?.exceptionDetails, JSON.stringify(response.result?.exceptionDetails));
  const value=response.result.result.value;
  assert.equal(value.parentName.toLowerCase(),'explorer');
  assert.equal(value.version,'0.2.12'); assert.equal(value.stage,'ready'); assert(value.primaryDecryptable);
  assert(value.health.deepseek_configured && value.health.speech_configured);
  assert.equal(value.ui.scenes,8); assert.equal(value.ui.errors,0); assert(value.ui.ready);
  if(restart) assert.equal(value.restarted.state,'ready');
  await mkdir('.cache/explorer-startup',{recursive:true});
  await writeFile('.cache/explorer-startup/desktop.png',Buffer.from(value.screenshot,'base64'));
  delete value.screenshot;
  await writeFile('.cache/explorer-startup/'+(restart?'restart':'startup')+'.json',JSON.stringify(value,null,2));
  console.log(JSON.stringify(value));
} finally {socket.close();}
