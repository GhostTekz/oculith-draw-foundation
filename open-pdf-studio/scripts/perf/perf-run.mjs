// A measured run of the installed app on the machine it is installed on:
// starts the app with its MCP bridge and isolated settings, opens each
// workload PDF, and times open, zoom, page changes and save. Collects the
// app's own per-operation timings (app_perf_snapshot) and both processes'
// memory, checks them against the budgets, and compares them with the
// previous run in the results folder.
//
// Usage: node scripts/perf/perf-run.mjs <app-binary> <workload-dir> <results-dir> [--label name] [--force]
// Make workloads with scripts/perf/make-workload.mjs. Refuses to run while
// the app is already open (a second launch would hand over to it), unless
// --force.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] === '--label'));
const [binaryArg, workloadArg, resultsArg] = positional;
if (!binaryArg || !workloadArg || !resultsArg) {
  console.error('Usage: node scripts/perf/perf-run.mjs <app-binary> <workload-dir> <results-dir> [--label name] [--force]');
  process.exit(2);
}
const binary = resolve(binaryArg), workloads = resolve(workloadArg), results = resolve(resultsArg);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

// Budgets (ms unless noted). A run fails a measure over budget, or more
// than 25 % worse than the previous run.
const BUDGETS = {
  'open.firstPaint': 3000,
  'redraw.frame.p95': 16.7,
  'redraw.full.p95': 50,
  'list.build.p95': 300,
  'save': 2000,
  'stall.longest': 200,
  'rss.totalMB': 1536,
};
const REGRESSION = 1.25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function unusedPort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}

let endpoint = '';
let requestId = 0;
async function call(name, params = {}, timeoutMs = 120_000) {
  let response;
  try {
    response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: params } }),
    });
  } catch (error) {
    throw new Error(`${name}: ${error.cause?.message || error.message}`);
  }
  const body = await response.json();
  if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
  if (body.result?.isError) throw new Error(`${name}: ${JSON.stringify(body.result.content)}`);
  const text = body.result?.content?.find((c) => c.type === 'text')?.text;
  const result = text ? JSON.parse(text) : {};
  if (result.ok === false) throw new Error(`${name}: ${JSON.stringify(result)}`);
  return result;
}

// Resident memory (MB) of a process and its children (the web process).
function rssMB(pid) {
  let total = 0;
  const visit = (p) => {
    try {
      const status = execFileSync('cat', [`/proc/${p}/status`]).toString();
      const kb = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] || 0);
      total += kb / 1024;
      const kids = execFileSync('pgrep', ['-P', String(p)]).toString().trim().split('\n').filter(Boolean);
      for (const k of kids) visit(k);
    } catch { /* gone, or no children */ }
  };
  visit(pid);
  return Math.round(total);
}

async function main() {
  await stat(binary);
  if (!args.includes('--force')) {
    try {
      execFileSync('pgrep', ['-x', 'open-pdf-studio']);
      console.error('The app is open. Close it first (or pass --force).');
      process.exit(3);
    } catch { /* not running */ }
  }
  const files = (await readdir(workloads)).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  if (!files.length) throw new Error(`No PDF workloads in ${workloads}`);
  await mkdir(results, { recursive: true });
  const temp = await mkdtemp(join(tmpdir(), 'oculith-perf-'));
  for (const d of ['config', 'data', 'cache']) await mkdir(join(temp, d));
  const port = await unusedPort();
  endpoint = `http://127.0.0.1:${port}/mcp`;
  const env = {
    ...process.env, XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'), XDG_CACHE_HOME: join(temp, 'cache'),
    OPDS_LOG: process.env.OPDS_LOG || 'info',
    // A release build starts its MCP bridge only when asked to.
    OPS_ENABLE_MCP: '1',
  };
  const app = spawn(binary, ['--mcp-server', '--mcp-port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let ready = false;
  const tail = [];
  const watch = (s) => s.on('data', (c) => {
    const text = String(c);
    if (text.includes('[mcp-bridge] WebView ready')) ready = true;
    for (const line of text.split('\n')) if (line.trim()) { tail.push(line); if (tail.length > 40) tail.shift(); }
  });
  watch(app.stdout); watch(app.stderr);
  const stop = () => { try { process.kill(-app.pid, 'SIGTERM'); } catch { /* gone */ } };
  process.on('SIGINT', () => { stop(); process.exit(130); });
  try {
    const t0 = Date.now();
    // Ready when the bridge says so on its output, or answers a call (a
    // release build may not print the line).
    while (!ready) {
      if (app.exitCode !== null) throw new Error(`The app exited (${app.exitCode}) before its bridge was ready.`);
      if (Date.now() - t0 > 90_000) throw new Error('The app bridge was not ready within 90 s.');
      await sleep(1000);
      try { await call('app_perf_snapshot', {}, 2000); ready = true; } catch { /* not yet */ }
    }
    await call('app_set_window_size', { width: 1600, height: 1000 }).catch(() => {});
    const run = { label, at: new Date().toISOString(), binary: basename(binary), workloads: {} };
    for (const file of files) {
      const path = join(workloads, file);
      const r = {};
      try {
      await call('app_perf_snapshot', { reset: true });
      let t = Date.now();
      let opened;
      try {
        opened = await call('app_open_pdf', { path }, 300_000);
      } catch (error) {
        // The bridge gives up after 60 s, while the app goes on opening:
        // wait until it answers again (up to 10 minutes) and time that.
        if (!/timed out/.test(String(error.message))) throw error;
        r.openTimedOut = true;
        const until = Date.now() + 600_000;
        for (;;) {
          if (Date.now() > until) throw new Error('The app did not finish opening within 10 minutes.');
          try { await call('app_perf_snapshot', {}, 15_000); break; } catch { await sleep(5000); }
        }
        opened = await call('app_get_page_count', {}).catch(() => ({}));
      }
      r['open.firstPaint'] = Date.now() - t;
      r.pages = opened.page_count ?? opened.count ?? opened.pages;
      await sleep(3000); // background loading after first paint
      // Zoom in and out around the middle of the view, then page through.
      for (let k = 0; k < 10; k++) { await call('app_wheel_zoom', { x: 800, y: 500, deltaY: -120 }); await sleep(60); }
      for (let k = 0; k < 10; k++) { await call('app_wheel_zoom', { x: 800, y: 500, deltaY: 120 }); await sleep(60); }
      for (let p = 2; p <= Math.min(6, r.pages || 1); p++) { await call('app_go_to_page', { page: p }); await sleep(400); }
      await call('app_go_to_page', { page: 1 });
      await sleep(1000);
      const saved = join(temp, `saved-${file}`);
      t = Date.now();
      await call('app_save_pdf', { path: saved }, 600_000);
      r.save = Date.now() - t;
      const snap = await call('app_perf_snapshot', {});
      r.markups = snap.markups;
      for (const [name, s] of Object.entries(snap.ops || {})) { r[`${name}.p95`] = s.p95; r[`${name}.count`] = s.count; }
      r.visible = snap.visible;
      r.hiddenMs = snap.hiddenMs;
      if (snap.hiddenMs > 1000) console.warn(`${file}: the window was out of view for ${Math.round(snap.hiddenMs / 1000)} s; its timers were throttled, so these timings overstate waits.`);
      r['stall.longest'] = Math.round(snap.stalls?.longest || 0);
      r['stall.count'] = snap.stalls?.count || 0;
      r['rss.totalMB'] = rssMB(app.pid);
      } catch (error) {
        // A step that fails or times out is a result too: record it, keep
        // what was measured, and go on with the next workload.
        r.error = String(error.message || error).slice(0, 300);
        const snap = await call('app_perf_snapshot', {}).catch(() => null);
        for (const [name, s] of Object.entries(snap?.ops || {})) { r[`${name}.p95`] = s.p95; r[`${name}.count`] = s.count; }
        r['rss.totalMB'] = rssMB(app.pid);
      }
      // Each workload in its own tab, closed after it: memory is per workload.
      await call('app_close_tab', {}).catch(() => {});
      await sleep(1000);
      run.workloads[file] = r;
      console.log(`${file}: open ${r['open.firstPaint'] ?? '-'} ms, save ${r.save ?? '-'} ms, ${r.markups ?? '-'} markups, ${r['rss.totalMB']} MB${r.error ? ` (${r.error})` : ''}`);
    }
    await call('app_perf_snapshot', { flush: true }).catch(() => {});
    // Compare with the previous run and the budgets.
    const earlier = (await readdir(results)).filter((f) => f.endsWith('.json')).sort();
    const previous = earlier.length ? JSON.parse(await readFile(join(results, earlier[earlier.length - 1]), 'utf8')) : null;
    const rows = [];
    let failed = 0;
    for (const [file, r] of Object.entries(run.workloads)) {
      for (const [measure, budget] of Object.entries(BUDGETS)) {
        const value = r[measure];
        if (value === undefined) continue;
        const before = previous?.workloads?.[file]?.[measure];
        const over = value > budget;
        const worse = before !== undefined && before > 0 && value > before * REGRESSION;
        if (over || worse) failed++;
        rows.push({ workload: file, measure, value, budget, previous: before ?? '', result: over ? 'OVER BUDGET' : worse ? 'REGRESSED' : 'ok' });
      }
    }
    console.table(rows);
    const out = join(results, `${run.at.replace(/[:.]/g, '-')}-${label}.json`);
    await writeFile(out, `${JSON.stringify(run, null, 2)}\n`);
    console.log(`Results: ${out}${failed ? ` (${failed} measures over budget or regressed)` : ''}`);
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    if (app.exitCode !== null || app.signalCode) console.error(`The app ended (${app.exitCode ?? app.signalCode}).`);
    console.error('Last app output:\n' + tail.join('\n'));
    throw error;
  } finally {
    stop();
  }
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 2; });
