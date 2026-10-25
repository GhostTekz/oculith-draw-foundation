#!/usr/bin/env python3
"""Retaining paths of an object in a WebKit heap snapshot.

The production bundle minifies class names, so the object is found by the
property names it has: a document by "filePath,_firstPaintDone". Prints up to
six distinct paths from the root; a module variable shows as an edge out of a
JSModuleEnvironment, and its minified name can be looked up in dist/assets.

Usage: python3 scripts/perf/heap-retainers.py heap-<time>.json filePath,_firstPaintDone
"""
import json, sys, collections
d = json.load(open(sys.argv[1]))
N, E = d['nodes'], d['edges']; cls = d['nodeClassNames']; en = d['edgeNames']; et = d['edgeTypes']
ids = N[0::4]; idx = {nid: i for i, nid in enumerate(ids)}
out = collections.defaultdict(list); inc = collections.defaultdict(list)
for k in range(0, len(E), 4):
    a, b, t, x = E[k], E[k+1], E[k+2], E[k+3]
    name = en[x] if et[t] in ('Property', 'Variable') else ('[%d]' % x if et[t] == 'Index' else 'internal')
    out[a].append((b, name)); inc[b].append((a, name))
want = set(sys.argv[2].split(','))
docs = [nid for nid in ids if want <= {n for _, n in out[nid]}]
print('candidates', len(docs))
def label(nid):
    i = idx[nid]; c = cls[N[i*4+2]]
    props = [n for _, n in out[nid]][:6]
    return f'{nid}:{c}{props}'
root = ids[0]
def shortest(doc, banned):
    prev = {doc: None}; q = collections.deque([doc])
    while q:
        cur = q.popleft()
        if cur == root:
            path = []; c = cur
            while prev[c] is not None:
                nxt, name = prev[c]; path.append((c, name, nxt)); c = nxt
            return path
        for a, name in inc[cur]:
            if (a, cur) in banned: continue
            if a not in prev: prev[a] = (cur, name); q.append(a)
    return None
for doc in docs[:1]:
    print('==', label(doc))
    banned = set()
    for n in range(6):
        path = shortest(doc, banned)
        if not path: print('  no more paths'); break
        print(' path', n + 1)
        for c, name, nxt in path[:14]: print('   ', (label(c) + ' --' + name + '-->')[:200])
        # ban the edge into the first non-root, non-function holder deep in the path (the module variable edge)
        for c, name, nxt in path:
            if name not in ('internal',):
                banned.add((c, nxt)); break
        else:
            banned.add((path[-1][0], path[-1][2]))
