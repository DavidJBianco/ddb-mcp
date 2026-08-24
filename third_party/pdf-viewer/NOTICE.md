# Official MCP PDF Viewer Notices

Mysterium includes the prebuilt `mcp-app.html` viewer from
`@modelcontextprotocol/server-pdf` version 1.7.5, published by the Model Context
Protocol project. The approved artifact has SHA-256
`df5cd587fb2da1b4d5f136caa7d199203764ecddf08c44c0ee07b085daf0b596`.

The viewer is copied unchanged during the build. It includes code from the MCP
Apps SDK, PDF.js, `@cantoo/pdf-lib`, `@standard-schema/spec`, and Zod. The
corresponding license texts are distributed in this directory. PDF.js may load
its Standard-14 font data from `https://unpkg.com` when a PDF does not embed the
required standard fonts; the MCP App resource policy permits only that origin.

Source and package information:

- https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/pdf-server
- https://www.npmjs.com/package/@modelcontextprotocol/server-pdf/v/1.7.5
- https://github.com/mozilla/pdf.js
- https://github.com/cantoo-scribe/pdf-lib
- https://github.com/standard-schema/standard-schema
- https://github.com/colinhacks/zod
