// Open a workload, close its tab, wait 15 s and save a heap snapshot of the
// app's page (heap-<time>.json in the current directory). Use a small
// workload: a snapshot of a large heap can take WebKit down. Then
// scripts/perf/heap-retainers.py shows what still holds the closed document.
//
// Usage: node scripts/perf/heap-after-close.mjs <app-binary> <pdf>
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [binary, pdf, phase = 'list'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const temp = await mkdtemp(join(tmpdir(), 'oculith-heap-'));
for (const d of ['config', 'data', 'cache']) await mkdir(join(temp, d));
const port = 45000 + Math.floor(Math.random() * 1000), iport = port + 1;
const env = { ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'), XDG_CACHE_HOME: join(temp, 'cache'), OPS_ENABLE_MCP: '1', WEBKIT_INSPECTOR_HTTP_SERVER: `127.0.0.1:${iport}` };
const app = spawn(binary, ['--mcp-server', '--mcp-port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stop = () => { try { process.kill(-app.pid, 'SIGTERM'); } catch {} };
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { stop(); process.exit(1); });
let id = 0;
async function call(name, args = {}, t = 300000) {
  const r = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(t),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
  return r.json();
}
try {
  for (let i = 0; i < 90; i++) { await sleep(1000); try { await call('app_perf_snapshot', {}, 2000); break; } catch {} }
  if (pdf) { try { await call('app_open_pdf', { path: pdf }); } catch (e) { console.log('open', e.message); } await sleep(8000); }
  console.log('close', JSON.stringify(await call('app_close_tab', { index: 0, force: true })).slice(0, 200));
  await sleep(15000);
  const ws = new WebSocket(`ws://127.0.0.1:${iport}/socket/1/1/WebPage`);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let target = null; let mid = 0; const waiting = new Map();
  const handle = (msg) => {
    if (msg.method === 'Target.targetCreated') target = target || msg.params.targetInfo.targetId;
    if (msg.method === 'Target.dispatchMessageFromTarget') return handle(JSON.parse(msg.params.message));
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  await sleep(1500);
  const send = (method, params = {}) => new Promise((ok) => {
    const m = { id: ++mid, method, params };
    waiting.set(m.id, ok);
    if (target) ws.send(JSON.stringify({ id: ++mid + 100000, method: 'Target.sendMessageToTarget', params: { targetId: target, message: JSON.stringify(m) } }));
    else ws.send(JSON.stringify(m));
  });
  console.log('target', target);
  await send('Heap.enable');
  const g = await send('Heap.gc'); console.log('gc', JSON.stringify(g).slice(0, 200));
  await sleep(2000);
  const snap = await send('Heap.snapshot');
  if (!snap.result) { console.log('snapshot failed', JSON.stringify(snap).slice(0, 500)); }
  else {
    const data = JSON.parse(snap.result.snapshotData);
    const names = data.nodeClassNames; const n = data.nodes; const by = new Map(); let total = 0;
    const stride = data.version >= 2 ? 4 : 4;
    for (let i = 0; i < n.length; i += stride) { const size = n[i + 1], cls = names[n[i + 2]]; total += size; const e = by.get(cls) || { size: 0, count: 0 }; e.size += size; e.count++; by.set(cls, e); }
    console.log('heap total MB', (total / 1048576).toFixed(1), 'nodes', n.length / stride);
    for (const [cls, e] of [...by].sort((a, b) => b[1].size - a[1].size).slice(0, 35)) console.log(String((e.size / 1048576).toFixed(1)).padStart(8), 'MB', String(e.count).padStart(9), cls);
    require_fs: { const fs = await import('node:fs'); fs.writeFileSync('heap-' + Date.now() + '.json', snap.result.snapshotData); }
  }
  ws.close();
} finally { stop(); await sleep(2000); (await import("node:fs/promises")).rm(temp, { recursive: true, force: true }).catch(() => {}); }
