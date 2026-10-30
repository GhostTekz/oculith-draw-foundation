const repository = 'https://github.com/GhostTekz/oculith-foundation';
const hash = /^[a-f0-9]{40}$/;

export function parseFoundationSourceRoute(value) {
  if (!value || value.schemaVersion !== 1 || value.repository !== repository
    || typeof value.version !== 'string' || !value.version
    || !hash.test(value.commit || '') || !hash.test(value.tree || '')) return null;
  const sourceArchive = `${repository}/archive/${value.commit}.tar.gz`;
  const buildInstructions = `${repository}/blob/${value.commit}/docs/BUILDING.md`;
  if (value.sourceArchive !== sourceArchive || value.buildInstructions !== buildInstructions) return null;
  return { version: value.version, commit: value.commit, tree: value.tree, sourceArchive, buildInstructions };
}

export async function readBundledFoundationSource(fetcher = fetch) {
  try {
    const response = await fetcher('/foundation-source.json');
    if (!response.ok) return null;
    return parseFoundationSourceRoute(await response.json());
  } catch {
    return null;
  }
}
