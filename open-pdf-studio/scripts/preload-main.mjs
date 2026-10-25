// js/boot.js imports js/main.js only after the edition is known, so without a
// hint the web view would start fetching and parsing the editor's module tree
// (dozens of chunks, one request after the other) only at that point. This
// adds a <link rel="modulepreload"> to index.html for every chunk main.js
// imports statically: they are fetched and parsed while boot.js runs, and
// still evaluated only when boot.js imports main.js.
export function preloadMain({ entry = /\/js\/main\.js$/ } = {}) {
  let base = '/';
  return {
    name: 'preload-main',
    apply: 'build',
    configResolved(config) { base = config.base; },
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle, chunk: htmlEntry }) {
        if (!bundle) return [];
        const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
        const holds = (item) => [item.facadeModuleId, ...(item.moduleIds || [])]
          .some((id) => id && entry.test(id.replaceAll('\\', '/')));
        const main = chunks.find(holds);
        if (!main) return [];
        // The entry's own static imports already get their preload from Vite.
        const known = new Set([htmlEntry?.fileName, ...(htmlEntry?.imports || [])]);
        const files = [];
        const seen = new Set();
        const visit = (fileName) => {
          if (seen.has(fileName)) return;
          seen.add(fileName);
          if (!known.has(fileName)) files.push(fileName);
          for (const next of bundle[fileName]?.imports || []) visit(next);
        };
        visit(main.fileName);
        return files.map((fileName) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: `${base}${fileName}` },
          injectTo: 'head',
        }));
      },
    },
  };
}
