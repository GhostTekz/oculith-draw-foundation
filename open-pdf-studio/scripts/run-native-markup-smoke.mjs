// Starts the Vite frontend and debug desktop app, then runs the live WebView
// markup smoke only after the native MCP bridge reports its listeners ready.
// Usage: node scripts/run-native-markup-smoke.mjs [debug-binary-path] [smoke-script]
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const appDir = process.cwd();
const binary = resolve(process.argv[2] || '../target/debug/open-pdf-studio');
const vite = resolve('node_modules/.bin/vite');
const packagedFrontend = process.env.OCUDRAW_REQUIRE_PACKAGED_FRONTEND === '1';
const smoke = resolve(process.argv[3] || 'scripts/oculith-native-markup-smoke.mjs');
const frontendUrl = 'http://127.0.0.1:3041/';
const startupTimeout = 90_000;
const smokeTimeout = 90_000;
const children = [];
const logTail = [];
let viteReady = false;

function capture(name, stream) {
  let pending = '';
  stream.on('data', chunk => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) {
      logTail.push(`${name}: ${line}`);
      if (logTail.length > 60) logTail.shift();
      if (name === 'vite' && line.includes('Local:') && line.includes(':3041/')) {
        viteReady = true;
      }
      if (name === 'app' && line.includes('[mcp-bridge] WebView ready, listening for:')) {
        bridgeReady?.();
      }
    }
  });
}

function launch(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('error', error => {
    child.spawnError = error;
    logTail.push(`${name}: ${error.message}`);
  });
  capture(name, child.stdout);
  capture(name, child.stderr);
  return child;
}

function stopChildren() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch { /* already exited */ }
  }
}

process.on('SIGINT', () => { stopChildren(); process.exit(130); });
process.on('SIGTERM', () => { stopChildren(); process.exit(143); });

let bridgeReady;
function waitForBridge(app) {
  return new Promise((resolveReady, reject) => {
    bridgeReady = resolveReady;
    app.once('error', reject);
    app.once('exit', (code, signal) => reject(new Error(`app exited before bridge ready (${code ?? signal})`)));
  });
}

async function waitForFrontend(viteChild) {
  const deadline = Date.now() + startupTimeout;
  while (Date.now() < deadline) {
    if (viteChild.spawnError) throw viteChild.spawnError;
    if (viteChild.exitCode !== null) throw new Error(`Vite exited (${viteChild.exitCode})`);
    try {
      const response = await fetch(frontendUrl, { signal: AbortSignal.timeout(1000) });
      if (viteReady && response.ok) return;
    } catch { /* Vite is still starting */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  throw new Error('Vite did not serve the frontend within 90 seconds');
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function main() {
  await stat(binary);
  if (!packagedFrontend) await stat(vite);
  await stat(smoke);
  const temp = await mkdtemp(join(tmpdir(), 'oculith-native-smoke-'));
  for (const subdir of ['config', 'data', 'cache']) await mkdir(join(temp, subdir));
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(temp, 'config'),
    XDG_DATA_HOME: join(temp, 'data'),
    XDG_CACHE_HOME: join(temp, 'cache'),
    WEBKIT_DISABLE_DMABUF_RENDERER: '1',
  };
  if (process.env.OCUDRAW_NATIVE_MOCK_ACCOUNT === '1') {
    const accountPort = await unusedPort();
    const accountDir = join(temp, 'data', 'com.ghosttekz.oculithdraw');
    await mkdir(accountDir, { recursive: true });
    await writeFile(join(accountDir, 'account-session.json'), JSON.stringify({
      origin: `http://127.0.0.1:${accountPort}`, clientId: 'native-smoke',
      accessToken: 'native-smoke-token', name: 'Native Smoke',
    }));
    env.OCUDRAW_MOCK_ACCOUNT_PORT = String(accountPort);
  }
  const port = await unusedPort();
  // A release check must prove that the binary carries its own frontend.
  // Starting Vite here would make a devUrl binary appear healthy even though
  // the installed launcher opens a blank "localhost refused" window.
  if (!packagedFrontend) {
    const viteChild = launch('vite', vite, []);
    await waitForFrontend(viteChild);
  }
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  if (headless) env.GDK_BACKEND = 'x11';
  const app = headless
    ? launch('app', 'xvfb-run', ['-a', binary, '--mcp-server', '--mcp-port', String(port)], env)
    : launch('app', binary, ['--mcp-server', '--mcp-port', String(port)], env);
  await withTimeout(waitForBridge(app), startupTimeout,
    'WebView MCP bridge did not become ready within 90 seconds');
  const test = launch('smoke', process.execPath, [smoke, String(port)], {
    ...env, OCUDRAW_NATIVE_APP_PID: String(app.pid),
  });
  await withTimeout(new Promise((resolveExit, reject) => {
    test.once('error', reject);
    test.once('exit', (code, signal) => code === 0
      ? resolveExit()
      : reject(new Error(`markup smoke exited (${code ?? signal})`)));
  }), smokeTimeout, 'markup smoke did not finish within 90 seconds');
  for (const line of logTail.filter(line => line.startsWith('smoke:'))) console.log(line);
  console.log(`Native smoke passed: ${smoke} (MCP port ${port}).`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  console.error(logTail.join('\n'));
  process.exitCode = 1;
} finally {
  stopChildren();
}
