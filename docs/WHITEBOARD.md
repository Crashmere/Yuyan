# Editable Whiteboards

The Excalidraw approach was confirmed and implemented on 2026-10-07. The first version includes in-document editing, immutable storage, reading previews, export and reimport, technical-diagram templates, and an Agent generation entry point. Redrawing existing MySQL images one by one is a later content task and does not run automatically with this platform release.

## Use and Scope

While editing a document body, open the whiteboard from the insertion menu or with `/画板`, add shapes, text, bound arrows, or images, and click `“应用”` to insert it. Open it again for editing from the preview; adjust width, alignment, and caption through document-body controls. Five starting points are available: `空白`, `数据页`, `B+ 树`, `索引扫描`, and `事务时间线`. Technical diagrams default to neat lines, solid fills, and normal fonts, while other engine drawing styles remain available.

The engine is pinned to `@excalidraw/excalidraw 0.18.1`; React connects to the Vue dialog through a separate mount point. Use public APIs and native elements without maintaining a core fork. The engine manages shapes, connector binding, grouping, alignment, layers, zooming, panning, and whiteboard-internal undo; Yuyan manages documents, assets, permissions, and history. Database templates are combinations of native elements, not custom business nodes. New templates and programmatic layouts do not require engine changes. Field ports, arbitrary new element rendering, and multiplayer collaboration are outside the first-version contract.

| Material | Representation |
| --- | --- |
| Explanations, SQL, and rule tables | Native paragraphs, code blocks, and tables |
| Processes and sequences that can be described with text and automatic layout | Mermaid |
| Pages, trees, index scans, and architecture diagrams that depend on spatial relationships | Editable `drawing` whiteboards |
| Software interfaces, photos, and real execution screenshots | Images; use the existing `imageBoard` when only stitching/cropping is needed |

A whiteboard does not automatically vectorize a screenshot. Images placed in a whiteboard still consume image storage. Before migration, extract explanatory text, tables, and code, then redraw the graphics that require spatial relationships.

## Document and Editing Transactions

`drawing` is an independent atomic block that may appear in the document body and in containers that allow block content. A node contains only an immutable-package reference and reading attributes; it does not copy the full scene into every document-body revision:

| Attribute | Contract |
| --- | --- |
| `src`, `version` | `/drawings/<32-character-content-ID>`, `1` |
| `width`, `blockAlign`, `caption` | 100–2400; initial creation uses the preview width, capped at 800; left/center/right, centered by default; caption text |
| `text` | Derived from scene text for search and character counting; it cannot be supplied manually as a separate body value |
| `previewWidth`, `previewHeight`, `previewMime` | Server-validated preview dimensions and type |

`“应用”` first freezes the scene, generates a preview, and publishes the complete package. It then verifies that the original node/insertion position is still valid and writes the result in one document transaction. Whiteboard input stops during asynchronous processing; a failure preserves the dialog and draft, while canceling preserves the original document body. The engine manages undo inside the whiteboard; after application, one document undo restores the original package. Changing display width or caption does not create a new package. Copies share the original package; editing one copy creates a new package and replaces only that occurrence.

Keep ordinary draft data in a shallowRef so Vue proxies do not enter the engine and prevent freezing/export. Store drafts in local IndexedDB, distinguished by instance, document, current revision, position, and original package; retain unapplied elements and images. Read the latest revision when persisting so document autosave does not make the draft key stale. Clear old keys created during the same open session when applying or canceling. When reopening a matching whiteboard, the draft can be restored; a network failure does not delete it. Changes not yet written before browser-data clearing or forced termination are not guaranteed to be recoverable.

Ordinary Tab / Shift+Tab does not move control focus, and focus decoration is removed; IME and key combinations continue to go to the editor. Esc in the dialog does not trigger the document body's double-Esc save-and-exit behavior. The reading page loads only a static preview and reuses image enlargement on click; React and the whiteboard engine load only when editing opens.

## Package Format, Preview, and Validation

The package uses `format: yuyan-drawing`, `version: 1`, `engine: excalidraw`, and `engineVersion: 0.18.1`, and contains:

- `scene.elements`: non-deleted native engine elements; `scene.appState` stores only `viewBackgroundColor`.
- `files`: a mapping from engine fileId to `{src: /assets/<ID>.<ext>, mimeType}`. Assets must exist, have matching types, and be used; packages cannot contain nested whiteboard packages.
- `preview`: one SVG string or PNG Base64 value, with MIME and actual width/height. PNG Base64 is the preview itself; scene images always reference deduplicated assets.
- `text`, `sceneHash`: calculated by the server from text elements and the normalized scene/asset mapping; client-derived values are not trusted. The hash does not prove visual consistency between preview and scene. The application generates both from the same frozen scene, but acceptance still requires visual inspection.

Scenes using ordinary fonts and no bitmap use SVG. A scene containing a bitmap or special font is saved as a PNG with a longest edge no greater than 2400, avoiding font fallback or differences caused by external image loading in standalone SVG. SVG does not embed scenes, fonts, styles, or bitmaps. An XML allowlist restricts elements and attributes; only internal fragment references are allowed, and scripts, events, external links, DTD, foreignObject, and inconsistent root width/height/viewBox are rejected. The preview is served as an authenticated image response with `default-src 'none'; sandbox` and is not inserted into document-body HTML.

Both the request and normalized package are limited to 12 MiB and 1–10000 elements; absolute coordinate and geometry values are limited to 1e6, and point arrays are validated point by point. A preview edge is limited to 16384; PNG is limited to 16,000,000 pixels, and declared dimensions must match the actual header. The server validates structure and bounds; it is not a complete Excalidraw geometry solver. Web embeds, external-link actions, and custom application data are not persisted in the first version.

Preview export explicitly uses `exportScale: 1` rather than inheriting Excalidraw's default scale derived from `devicePixelRatio`, ensuring that SVG width/height matches viewBox on Retina and other high-density displays. SVG is serialized with XMLSerializer so outerHTML cannot turn a nonbreaking space into the XML-unsupported `&nbsp;`. Before serialization, restore any frame `clip-path` that the engine incorrectly places in the SVG namespace to an ordinary presentation attribute. Standalone SVG download reuses this serialization flow. When changing export, cover 1×/2×/3× pixel densities together; a narrow window alone does not represent a high-density display.

Engine and font resources ship with the Go program; there is no Node/browser runtime on the server and no default font CDN. SVG export font subsetting runs in an engine Worker. The engine starts it through a chunk that the page also imports dynamically; bundling it with the page would make the Worker load a shared chunk containing page code and fail. `web/vite.config.ts` redirects this import to a separately bundled Worker script for the same file, while the page retains the engine's main-thread fallback. The build fails directly if that file enters a page chunk or if the engine no longer imports it this way. Dependency overrides are pinned in `web/package.json`; the lockfile audit on 2026-10-07 reported 0 advisories. The engine's built-in `“Mermaid 转画板”` (`@excalidraw/mermaid-to-excalidraw` 2.2.2) is overridden to use the root `mermaid` dependency and shares the same chunks as the reading page. Its declared range is ^11; recheck conversion results when upgrading Mermaid or the whiteboard engine. Results before and after the 2026-10-13 merge are identical: sequence diagrams and flowcharts without subgraphs generate editable graphics, while flowcharts with subgraphs, class diagrams, ER diagrams, state diagrams, and pie charts fall back to a single image. Third-party licenses ship under `web/licenses/excalidraw/`. Font copyright follows each specific font/upstream declaration; do not apply the engine's MIT license to all fonts.

## API and Lifecycle

| Route | Behavior |
| --- | --- |
| `POST /api/drawings` | Validate and publish a package; return status 201 with a complete drawing node that can be inserted directly |
| `GET /api/drawings/{id}` | Read a currently supported scene package |
| `GET /drawings/{id}/preview` | Authenticated preview; validate the preview independently of the scene engine version |
| `GET /drawings/{id}/file` | Download the exact original package bytes, preserving the content-addressed hash |

Reuse the `assets` table and directory. A package uses `.bin` and MIME `application/vnd.yuyan.drawing+json`, with no database migration. A normal attachment upload cannot bypass package and dependency validation. Publication and retention of image dependencies occur in the same transaction under the directory's shared lock; document/template writes recheck the package, derived attributes, and images.

Document bodies (including trash), history, templates/snippets, and media links all protect packages. GC expands image references inside packages. An unreferenced package continues protecting images during its one-hour grace period; only after the package is collected do the images begin their own grace period. If a registered package cannot be parsed, the current GC run stops and reports the error; it must not guess dependencies and delete. v2 native backups include packages and all registered images; hard links in existing backups are not broken when source assets are collected.

`GET /api/meta` publishes `features: ["drawing-v1", "calendar-v1"]`. Saving or canceling edits to a current document containing a whiteboard requires the `drawing-v1` token in the comma-separated `X-Yuyan-Features` header, preventing an old tab from resaving and losing an unknown node; the new web application and yuyan-doc add it automatically. Revision conflict checking still runs independently. Template bodies cannot be replaced in place; copying and history restoration retain complete server-side nodes directly.

Editing or republishing an unknown package/engine version is forbidden. Its preview may still be read if it passes independent safety validation, and the original package remains downloadable. GC conservatively stops for an unknown package; upgrade to a program that understands that version. Do not roll back to an old program that does not recognize drawing at all and then edit documents containing whiteboards; the absence of a SQLite migration does not imply document-format backward compatibility.

## Export and Agents

Web knowledge-base export, project-CLI full export, and yuyan-doc single-document export retain the whiteboard package, one preview, and required images. Markdown falls back to an HTML figure containing the preview, caption, and source link. Package files named `<ID>.yuyan.json`, previews named `<ID>.svg|png`, and images are placed in the same attachments directory. The project import tool can import the complete folder into an empty instance: it first validates image hashes, reuploads dependencies and packages, and then preserves node width/alignment/caption. Copying only one Markdown file does not produce an independently editable whiteboard; when the package is missing, import fails instead of silently dropping the image.

The whiteboard dialog can import `.excalidraw` and download standalone `.excalidraw`/SVG/PNG. A standalone file temporarily embeds images/fonts as required by its format, unlike long-term server storage.

Agents use `yuyan-doc drawing --input spec.json --out NEW_DIRECTORY`: input contains either `template` or `elements` (exactly one), with optional background and image data. The local isolated instance and the same browser adapter produce the package and preview. This generates local materials only and does not connect to production. First use `preview-setup` to prepare a local program from committed source. After review, separately run `upload --kind drawing`, then use revision-protected `create/edit` to insert the returned node. The generation API/tool entry point is `web/src/drawing/tool.ts`; skill scripts live only in agent-config.

## Implementation Status and Follow-up

P0 engine validation, P1 document/storage integration, and P2 database templates and the Agent entry point are all implemented. Targeted verification materials use isolated synthetic data and remain in `.local`; no permanent regression suite is added. See [VERIFICATION.md](VERIFICATION.md) for verification results and release records.

P3 redrawing one image at a time remains a separate future task. First verify labels, numbers, connectors, and legends, then replace content selectively in real documents; preserve native text/SQL/tables. Storage assessment includes the actual package (which already contains a preview), deduplicated images, history, and backups; report the gzip-compressed transfer size separately. Since one-by-one redraw comparisons against the originals have not been completed, no savings ratio is promised.

Future work may add shape templates, layout assistance, element-selection tools, and importers through the public API. Before upgrading the engine, verify editing and export with representative old packages; add version adapters as needed instead of rewriting all stored packages directly.

Official references: [embedding and font hosting](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation), [scene API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api), [element generation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton), [export](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export), and [pinned-version source](https://github.com/excalidraw/excalidraw/tree/v0.18.1).
