// Local main-process inspector probe. Reports metadata only, never configuration values.
const targets = await (await fetch('http://127.0.0.1:18829/json/list')).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const expression = `(async () => {
  const req = process.mainModule.require.bind(process.mainModule);
  const fs = req('node:fs'), path = req('node:path');
  const { app, safeStorage } = req('electron');
  const out = { pid: process.pid, appData: app.getPath('appData'), userData: app.getPath('userData'), temp: app.getPath('temp'), cwd: process.cwd(), files: [] };
  for (const file of [path.join(app.getPath('userData'),'services.bin'),path.join(process.resourcesPath,'local-config.bin')]) {
    const result = { path: file };
    try {
      const bytes = Buffer.from(fs.readFileSync(file,'utf8'),'base64'); result.bytes = bytes.length;
      try { result.sync = Object.keys(JSON.parse(safeStorage.decryptString(bytes))).length; } catch(e) { result.syncError = String(e.message); }
      try { result.async = Object.keys(JSON.parse((await safeStorage.decryptStringAsync(bytes)).result)).length; } catch(e) { result.asyncError = String(e.message); }
    } catch(e) { result.readError = e.code; result.syscall = e.syscall; }
    out.files.push(result);
  }
  try { const f=path.join(app.getPath('userData'),'diagnostic-write-probe.tmp'); fs.writeFileSync(f,'probe'); fs.unlinkSync(f); out.write = true; } catch(e) { out.writeError = e.code; out.writeSyscall = e.syscall; }
  return out;
})()`;
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('probe-timeout')), 15000);
  socket.onmessage = event => { const m=JSON.parse(event.data); if(m.id===1){clearTimeout(timer);resolve(m);} };
  socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
});
console.log(JSON.stringify(result)); socket.close();
