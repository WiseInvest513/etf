// Data-only manuscripts are shared by the reader and build-time SEO renderer.
export const p = (text, ...cites) => ({ type: "paragraph", text, ...(cites.length ? { cites } : {}) });
export const h = (text) => ({ type: "heading", text });
export const note = (title, text, ...cites) => ({ type: "callout", title, text, ...(cites.length ? { cites } : {}) });
export const list = (...items) => ({ type: "list", items });
export const table = (caption, headers, rows, ...cites) => ({ type: "table", caption, headers, rows, ...(cites.length ? { cites } : {}) });
export const flow = (caption, ...steps) => ({ type: "flow", caption, steps: steps.map(([title, text]) => ({ title, text })) });
export const section = (id, toc, title, ...blocks) => ({ id, toc, title, blocks });
export const diagram = (name, alt, caption) => ({ type: "figure", image: { src: `/learn/etf/${name}.svg`, width: 960, height: 480, alt }, caption });
