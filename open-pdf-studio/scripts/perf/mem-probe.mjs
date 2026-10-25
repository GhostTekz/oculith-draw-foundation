// Memory of the app's web process through one document's life: open, zoom,
// page changes, save, two quiet minutes, close. Each step reports resident
// memory by mapping, WebKit's own memory categories, the live workers and
// threads, and what the app's retention watch still holds after the close.
//
// Usage: node scripts/perf/mem-probe.mjs <app-binary> <pdf>
// SHORT=1 skips the two quiet minutes; RELEASE=1 releases the list, the
// PDF.js pages and the pdf-lib parse one by one instead of zooming and saving.
// Run on the machine the app is installed on, with the app closed.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [binary, pdf] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const temp = await mkdtemp(join(tmpdir(), 'oculith-mem-'));
for (const d of ['config', 'data', 'cache']) await mkdir(join(temp, d));
const port = 46000 + Math.floor(Math.random() * 1000), iport = port + 1;
const env = { ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'), XDG_CACHE_HOME: join(temp, 'cache'), OPS_ENABLE_MCP: '1', WEBKIT_INSPECTOR_HTTP_SERVER: `127.0.0.1:${iport}` };
const app = spawn(binary, ['--mcp-server', '--mcp-port', String(port)], { env, stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-app.pid, 'SIGTERM'); } catch {} };
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { stop(); process.exit(1); });
let id = 0;
const call = async (name, args = {}, t = 600000) => (await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(t), body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) })).json();
const web = () => execFileSync('pgrep', ['-f', 'WebKitWebProcess']).toString().trim().split('\n').filter((p) => { try { return execFileSync('cat', [`/proc/${p}/status`]).toString().includes('PPid:\t' + app.pid); } catch { return false; } })[0];
let lastCats = null; const liveWorkers = new Map(); let ws = null, target = null, mid = 0; const waiting = new Map();
async function inspector() {
  if (ws) return;
  ws = new WebSocket(`ws://127.0.0.1:${iport}/socket/1/1/WebPage`);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  const handle = (m) => { if (m.method === 'Memory.trackingUpdate') lastCats = m.params.event.categories; if (m.method === 'Worker.workerCreated') liveWorkers.set(m.params.workerId, (m.params.url || '').split('/').pop() + (m.params.name ? ' [' + m.params.name + ']' : '')); if (m.method === 'Worker.workerCreated') send('Worker.initialized', { workerId: m.params.workerId }); if (m.method === 'Worker.workerTerminated') liveWorkers.delete(m.params.workerId); if (m.method === 'Target.targetCreated') target = target || m.params.targetInfo.targetId; if (m.method === 'Target.dispatchMessageFromTarget') return handle(JSON.parse(m.params.message)); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  await sleep(1500);
}
const send = (method, params = {}) => new Promise((ok) => { const m = { id: ++mid, method, params }; waiting.set(m.id, ok); ws.send(JSON.stringify(target ? { id: 100000 + mid, method: 'Target.sendMessageToTarget', params: { targetId: target, message: JSON.stringify(m) } } : m)); setTimeout(() => ok({ timeout: true }), 60000); });
async function gc() { try { await inspector(); await send('Heap.gc'); await sleep(4000); } catch (e) { console.log('gc failed', e.message); } }
async function report(label) {
  await gc();
  const pid = web(); if (!pid) { console.log(label, 'no web process'); return; }
  const st = await readFile(`/proc/${pid}/status`, 'utf8');
  const g = (k) => Math.round(Number(new RegExp(k + ':\\s+(\\d+)').exec(st)?.[1] || 0) / 1024);
  const smaps = await readFile(`/proc/${pid}/smaps`, 'utf8');
  const by = new Map(); let cur = null;
  for (const line of smaps.split('\n')) {
    const m = /^[0-9a-f]+-[0-9a-f]+ \S+ \S+ \S+ \S+\s*(.*)$/.exec(line);
    if (m) { cur = m[1] || '[anon]'; continue; }
    const r = /^Rss:\s+(\d+) kB/.exec(line); if (r && cur) by.set(cur, (by.get(cur) || 0) + Number(r[1]));
  }
  const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${Math.round(v / 1024)}MB ${k.replace(/.*\//, '')}`);
  try { if (!globalThis.__tracking) { globalThis.__tracking = 1; console.log('enable', JSON.stringify(await send('Memory.enable')).slice(0, 200)); console.log('track', JSON.stringify(await send('Memory.startTracking')).slice(0, 200)); console.log('worker enable', JSON.stringify(await send('Worker.enable')).slice(0, 200)); } await sleep(2500); console.log('  categories MB:', lastCats ? lastCats.map((c) => c.type + '=' + Math.round(c.size / 1048576)).join(' ') : 'none'); } catch (e) { console.log('memory domain', e.message); }
  try { const names = {}; for (const t of execFileSync('ls', [`/proc/${pid}/task`]).toString().trim().split('\n')) { try { const n = execFileSync('cat', [`/proc/${pid}/task/${t}/comm`]).toString().trim(); names[n] = (names[n] || 0) + 1; } catch {} } console.log('  threads', Object.values(names).reduce((a, b) => a + b, 0), JSON.stringify(Object.fromEntries(Object.entries(names).filter(([n]) => !/^(WebKitWebP:|WebKit:|WebKitWe:|WebKitW:|eadedCompositor|SkiaCPUWorker|JITWorker|gmain|gdbus|dconf|pool-|ReceiveQueue|EventDispatcher|rruptDispatcher|Core: Scrolling|WebKitWebProces)/.test(n))))); } catch (e) { console.log('threads?', e.message); }
  console.log('  workers', JSON.stringify([...liveWorkers.values()]));
  console.log(`${label}: rss ${g('VmRSS')}MB anon ${g('RssAnon')}MB file ${g('RssFile')}MB shmem ${g('RssShmem')}MB | ${top.join(' | ')}`);
}
try {
  for (let i = 0; i < 90; i++) { await sleep(1000); try { await call('app_perf_snapshot', {}, 2000); break; } catch {} }
  await sleep(3000); await report('idle');
  await call('app_open_pdf', { path: pdf }).catch(() => {});
  for (let i = 0; i < 60; i++) { await sleep(5000); try { await call('app_perf_snapshot', {}, 5000); break; } catch {} }
  await sleep(8000); await report('opened');
  if (process.env.RELEASE) for (const what of ['list', 'pdfjs-pages', 'pdf-lib']) { await call('app_perf_snapshot', { release: [what] }).catch(() => {}); await sleep(3000); await report('released ' + what); }
  else {
    for (let k = 0; k < 3; k++) { await call('app_wheel_zoom', { x: 800, y: 500, deltaY: -120, steps: 8 }); await sleep(400); await call('app_wheel_zoom', { x: 800, y: 500, deltaY: 120, steps: 8 }); await sleep(400); }
    for (let p = 2; p <= 6; p++) { await call('app_go_to_page', { page: p }); await sleep(400); }
    await call('app_go_to_page', { page: 1 }); await report('zoomed+paged');
    await call('app_save_pdf', { path: join(temp, 'saved.pdf') }).catch((e) => console.log('save', e.message)); await report('saved');
    await sleep(15000); await report('quiet 15s');
    if (!process.env.SHORT) { await sleep(100000); await report('quiet 2min'); }
  }
  await call('app_clear_caches', {}).catch(() => {}); await sleep(5000); await report('after clear_caches');
  console.log('close', JSON.stringify(await call('app_close_tab', { index: 0, force: true }).catch((e) => String(e))).slice(0, 300)); await sleep(3000); console.log('tabs', JSON.stringify(await call('app_list_tabs', {}).catch((e) => String(e))).slice(0, 300)); await sleep(7000); await report('after close');
  const snap = await call('app_perf_snapshot', {}).catch(() => null);
  try { console.log('retained:', JSON.parse(snap.result.content[0].text).retained); } catch { console.log('retained: ?', JSON.stringify(snap).slice(0, 300)); }
  for (const wait of [50000, 60000]) { await sleep(wait); await gc(); const again = await call('app_perf_snapshot', {}).catch(() => null); try { console.log('retained later:', JSON.parse(again.result.content[0].text).retained); } catch {} await report('later'); }
} finally { stop(); await sleep(2000); (await import('node:fs/promises')).rm(temp, { recursive: true, force: true }).catch(() => {}); }
