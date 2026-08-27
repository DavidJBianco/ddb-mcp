# Mysterium PDF Viewer Notices

Mysterium's read-only PDF renderer is adapted from the PDF MCP App published in
`@modelcontextprotocol/server-pdf` version 1.7.5 by the Model Context Protocol
project. Mysterium owns and builds its viewer shell and retains the upstream
chunk-loading, PDF.js rendering, text-selection, search, navigation, and MCP
Apps lifecycle patterns under the upstream MIT license.

The generated viewer bundles the MCP Apps SDK and Mozilla PDF.js. It does not
include the upstream annotation editor, PDF mutation, or `@cantoo/pdf-lib`.
Corresponding license texts are distributed in this directory. PDF.js may load
its version-matched Standard-14 font data from `https://unpkg.com` when a PDF
does not embed the required fonts; the MCP App resource policy permits only
that origin.

Source and package information:

- https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/pdf-server
- https://www.npmjs.com/package/@modelcontextprotocol/server-pdf/v/1.7.5
- https://github.com/mozilla/pdf.js
- https://github.com/standard-schema/standard-schema
- https://github.com/colinhacks/zod
