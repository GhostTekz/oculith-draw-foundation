// Resolve independent add-on group rows for one Markups List build. The full
// edition's existing groups take precedence, followed by installed packages.
const MAX_LABEL = 160;
const MAX_ID = 160;
const COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i;
const EMPTY_OWNERS = new Map();

export function collectAddonListGroups(contributions, doc, annotations, existingPaths = null, existingOwns = () => false) {
  if (!contributions?.length) return { paths: existingPaths, owners: EMPTY_OWNERS };
  const paths = new Map(existingPaths || []);
  const owners = new Map();
  const annotationSet = new Set(annotations);
  const nativeGroups = new Set();
  for (const ann of annotations) {
    if (ann?.groupId) nativeGroups.add(ann.groupId);
    for (const level of Array.isArray(ann?.groupPath) ? ann.groupPath : []) {
      if (level?.id) nativeGroups.add(level.id);
    }
  }
  const usedIds = new Set([...paths.values()].map((level) => level?.id).filter(Boolean));
  for (const contribution of contributions || []) {
    let proposed;
    try { proposed = contribution.paths(doc, annotations); } catch { continue; }
    if (proposed == null) continue;
    if (!(proposed instanceof Map) || proposed.size > annotations.length) continue;
    const prefix = `addon:${contribution.id}:`;
    const accepted = new Map();
    const levels = new Map();
    let valid = true;
    for (const [ann, level] of proposed) {
      if (paths.has(ann)) continue;
      if (!annotationSet.has(ann)
          || !level || typeof level !== 'object'
          || typeof level.id !== 'string' || !level.id.startsWith(prefix)
          || level.id.length <= prefix.length || level.id.length > MAX_ID
          || typeof level.name !== 'string' || !level.name.trim() || level.name.length > MAX_LABEL
          || (level.color != null && (typeof level.color !== 'string' || !COLOR.test(level.color)))
          || (level.dominant != null && (typeof level.dominant !== 'string' || level.dominant.length > MAX_ID))
          || (level.hideDominant != null && typeof level.hideDominant !== 'boolean')
          || nativeGroups.has(level.id) || usedIds.has(level.id)) {
        valid = false;
        break;
      }
      try { if (existingOwns(level.id)) { valid = false; break; } }
      catch { valid = false; break; }
      const safe = { id: level.id, name: level.name, dominant: level.dominant || null,
        hideDominant: level.hideDominant === true, color: level.color || '' };
      const prior = levels.get(level.id);
      if (prior && (prior.name !== safe.name || prior.dominant !== safe.dominant
          || prior.hideDominant !== safe.hideDominant || prior.color !== safe.color)) {
        valid = false;
        break;
      }
      if (!prior) levels.set(level.id, safe);
      accepted.set(ann, levels.get(level.id));
    }
    if (!valid) continue;
    for (const [ann, level] of accepted) {
      paths.set(ann, level);
      usedIds.add(level.id);
      owners.set(level.id, contribution.select);
    }
  }
  return { paths, owners };
}
