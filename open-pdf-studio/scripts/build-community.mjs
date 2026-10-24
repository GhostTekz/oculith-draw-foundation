import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Native output and bundle staging go to <target>/community (CARGO_TARGET_DIR or OCUDRAW_TARGET_BASE names the base).
const editionTargetDir = (edition, env = process.env) => path.join(path.resolve(project,
  env.OCUDRAW_TARGET_BASE || env.CARGO_TARGET_DIR || path.resolve(project, '..', 'target')), edition);

export function communityBuildCommand(args = []) {
  const frontendOnly = args.includes('--frontend-only');
  const forwarded = args.filter((arg) => arg !== '--frontend-only');
  if (frontendOnly && forwarded.length) throw new Error('Frontend-only build takes no Tauri arguments.');
  const switches = new Set(['--no-bundle', '--debug', '--ci', '--no-sign', '--skip-stapling', '--verbose']);
  const bundles = new Set(['deb', 'rpm', 'appimage', 'nsis', 'app', 'dmg']);
  for (let i = 0; i < forwarded.length; i++) {
    const arg = forwarded[i];
    if (switches.has(arg)) continue;
    if (arg === '--bundles') {
      const value = forwarded[++i] || '';
      if (!value.split(',').every((part) => bundles.has(part))) throw new Error('Invalid Community bundle type.');
      continue;
    }
    if (arg === '--target') {
      if (!/^[a-zA-Z0-9_-]+$/.test(forwarded[++i] || '')) throw new Error('Invalid Community build target.');
      continue;
    }
    throw new Error(`Unsupported Community build option: ${arg}`);
  }
  return frontendOnly
    ? { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'build'],
      env: { OCUDRAW_EDITION: 'community', CARGO_TARGET_DIR: editionTargetDir('community') } }
    : {
      command: process.execPath,
      args: [path.join(project, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
        'build', '--config', 'src-tauri/tauri.community.conf.json', ...forwarded,
        '--', '--no-default-features'],
      env: { OCUDRAW_EDITION: 'community', CARGO_TARGET_DIR: editionTargetDir('community') },
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const spec = communityBuildCommand(process.argv.slice(2));
  if (!process.argv.includes('--frontend-only')) {
    const { readFileSync } = await import('node:fs');
    const base = JSON.parse(readFileSync(path.join(project, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    if (base.productName !== 'Oculith Draw Foundation'
      || base.identifier !== 'com.ghosttekz.ocudraw.community'
      || base.bundle?.windows?.nsis?.installerHooks
      || base.bundle?.windows?.nsis?.template) {
      throw new Error('Build the native Community app from a Community source export.');
    }
  }
  const result = spawnSync(spec.command, spec.args, {
    cwd: project,
    env: { ...process.env, ...spec.env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
