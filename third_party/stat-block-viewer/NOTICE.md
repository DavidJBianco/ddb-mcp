# Stat Block Viewer Notices

Mysterium's generated stat-block MCP App bundles code from
`@modelcontextprotocol/ext-apps`, its MCP SDK/Zod/Standard Schema dependencies,
and `html2canvas` with its line-breaking dependencies. The MCP Apps SDK, Zod,
and Standard Schema licenses are distributed in `../pdf-viewer/`; the
html2canvas license and the remaining bundled dependency licenses are
distributed beside this notice. `esbuild` is used only while building the
self-contained viewer and is not included in the production image.

Source information:

- https://github.com/modelcontextprotocol/ext-apps
- https://github.com/niklasvh/html2canvas
- https://github.com/evanw/esbuild
