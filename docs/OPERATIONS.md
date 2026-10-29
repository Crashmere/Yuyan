# Installation and Operation

The public entry point uses HTTPS with a trusted IP certificate, while retaining the existing `/yuyan/` path. Public HTTP returns 308; API clients must use HTTPS directly. Nginx overrides `X-Forwarded-Proto`, and the public entry point uniformly validates device credentials. For certificates, renewal, rollback, and whole-machine acceptance, see [Shared HTTPS Operations](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/https.md) (server copy: `/opt/server-context/references/https.md`). This project's backend and deployment checks retain local HTTP, and the proxy-check entry point at `127.0.0.1:80` must not be publicly accessible. The public endpoint has been integrated with ServerPortal's unified device authentication: first enter the passphrase at `/portal/login` to authorize the device, then access the site with a same-origin Secure/HttpOnly cookie; unauthorized API requests return 401. Local deployment checks and service-to-service calls remain available.

Yuyan's application target is `nas`; `vps` exposes public HTTPS port 8443 and temporary `ali` access forwards to the same instance. NAS provides local-CA HTTPS for home devices. Read server-operations and the target's remote `/opt/AGENTS.md`; current-state records activation. Keep addresses in trusted SSH configuration, not this public repository.

Image/attachment uploads and large-document saves all pass through device authentication: the attachment endpoint has no upload-size limit and receives data as a stream; the image endpoint remains limited to 25 MiB per image, JSON is limited to 16 MiB, and the Nginx limit for other application requests is 26 MiB. Internal authentication subrequests do not impose another body-size limit; if a large request returns 500 before reaching the application, see [Unified Authentication Incorrectly Blocking Large Requests](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证误拦大请求).

## Version History Retention

In reading mode, “最近修改” calls the read-only `/api/docs/{id}/recent-changes` endpoint on demand and uses retained history to find the baseline before the most recent edit or restore. When no history exists, the UI shows that comparison is unavailable and does not write a snapshot; there are no database-migration, asset-lifecycle, or backup-contract changes. See DESIGN.md 13.2 for the API and display contract. The resource declaration is released with the application.

All document history, including history for documents in the trash, is retained for 30×24 hours. Snapshots that reach the limit are deleted every day at 03:00 Asia/Shanghai, with no minimum version count retained. Current content, trashed content, templates, and snippets are unchanged; history may become completely empty. The job runs in the application's existing once-per-minute maintenance loop, cleaning history before scanning attachments. The successful run time is stored in `meta` as `version_retention:last_run`; after downtime, startup catches up, restarts during the same period do not rerun it, and failures are retried on the next loop. No cron job, additional unit, or database migration is required.

`yuyan history-gc --dry-run --data <数据目录>` is read-only and returns `cutoff`, `nextRun`, `eligible`, `deleted`, and `ran` without deleting records or writing scheduling state. Without `--dry-run`, it immediately cleans according to the same 30-day rule and records the successful run time. Use the read-only form for production diagnostics. The `version retention` log records the deletion count and next run time. Only database rows are deleted; VACUUM is not run automatically, and later writes reuse the freed pages.

Candidate snapshots are parsed before cleanup. History deletion, media grace-period resets, and the successful scheduling marker are committed in the same transaction; any parse or SQL failure rolls everything back. Images/attachments whose last reference was in history begin a new one-hour timer when that reference disappears; an old upload date does not cause immediate deletion. Files still referenced by current content, trash, templates, or other history remain protected.

The editor's first save carries `sessionRevision` and records a new “编辑前” snapshot in the same transaction, protecting the content and media that existed before an editing session that is later canceled. If the latest snapshot already marks a session boundary with identical state and is more than one week from expiration, that snapshot is reused (DESIGN.md 13.2). Canceling removes the current session snapshot. Restoring a version records “恢复前” in the same transaction, checks the revision, updates the content, and records the result. Both kinds of protective snapshots use the same 30-day retention period. `version_sequence` in `meta` stores the ID high-water mark, so old version links are not reused after history cleanup, cancellation, or permanent deletion; a missing version returns 404 / `version_not_found`.

Both native and NAS full cold backups preserve the complete SQLite database, including retained history and scheduling state; the NAS format also includes all data files and derivatives. Existing archives are unaffected by history cleanup, and NAS does not automatically rotate backups. On restoration, service startup catches up expired-history cleanup according to current time. Inspect older recovery copies read-only in an isolated directory before starting the service. Program rollback cannot restore cleaned rows/files; it must retain history high-water-mark compatibility. The agent selects and confirms the recovery point separately.

## Attachment and Backup Compatibility

Attachment uploads have no file-size limit. Only the Nginx child location `/yuyan/api/attachments` sets `client_max_body_size 0` and `proxy_request_buffering off`, while inheriting existing device authentication, Host/origin forwarding, and idle timeouts; other requests retain the 26 MiB limit. The application streams data into `data/assets/.upload-*`, incrementally computes SHA-256, and publishes and registers the file only after the complete form and file succeed. It does not cache the entire file in `/tmp` or read the entire file into memory. Only attachment intake uses a two-minute read-idle timeout, so an upload that continues transferring is not constrained by the two-minute total limit for ordinary requests. It reuses the `assets` table and directory, with no database migration or permission changes. Attachment downloads use `/attachments/{id}`, are always forced to download as files, and support Range; `.bin` is not exposed through the image route. Original files are immutable. Unreferenced images and attachments are automatically collected according to the one-hour rule below, while native backups include every asset still registered when the snapshot is taken.

At service startup and once per minute, the application scans all current content, including documents in the trash and documents under deleted knowledge bases, history versions, templates/snippets, and all image, attachment, and media links within them. The first scan after startup parses all content; subsequent scans parse only rows added or modified since the preceding scan. Parsing completes before the collection lock is acquired, so saves and other requests do not need to wait during scanning. An `assets` record and file are deleted only after they have remained unreferenced continuously for one hour following the first confirmation that no references exist. New uploads begin timing when registration succeeds; referencing the file again or uploading the same file again resets the timer. Existing unreferenced files begin timing on their first scan and are not deleted immediately based on an old upload date. Abandoning an edit after a successful upload or permanently deleting a document, knowledge base, or template starts collection only after every reference has disappeared; removing a card alone does not if history still references the asset. Nested containers and composite image boards also count as references.

Collection state is stored in the existing `meta` keys under `asset_gc:*`, so timing survives restarts and requires no database migration. The deletion decision rechecks all references inside the same write transaction; parse or transaction failures do not delete files. The registered deletion and retry marker are committed before `unlink`, so work resumes after an abnormal exit. Attempting to save a collected attachment returns an explicit re-upload prompt without overwriting document content. Complete orphan files left by registration failures are also observed for one hour first. Normal cancellation or failure cleans unfinished uploads; `.upload-*` files left by an abnormal exit are removed after one hour only when no upload process holds the lock, so long-running active uploads are not removed by mistake.

Native backup and upload publication hold a cross-process shared lock on the `assets` directory, while collection holds the exclusive lock, ensuring that snapshot registration and file hard links remain consistent. Files in existing backups are not lost when source files are collected; actual space reclamation still depends on when those backups rotate according to their own policies. For read-only diagnostics, run `yuyan gc --dry-run --data <数据目录>`; it returns `referenced`, `pending`, `eligible`, and reclaimable bytes without writing timers or deleting files. `gc` without that option applies the same one-hour rule; there is no option to bypass the grace period. Service logs record job startup, collected counts/bytes, and failure reasons.

Clicking an attachment card opens a preview; only the separate download button initiates a download. The read-only metadata/text/directory endpoint is `/api/attachments/{id}/preview`; bitmap, PDF, audio, and video content uses `/attachments/{id}/content`. Both remain protected by existing authentication. The content endpoint restricts types by file signature; HTML/SVG can only be previewed as text or downloaded. Archives expose directory listings only and are not extracted to disk or allowed to read other volumes; see DESIGN 23.8 for supported formats and read limits. PDF.js and its fonts, CMaps, and decoder resources are bundled locally with the frontend under versioned `static/assets/pdfjs-<版本>/` paths. They load only when a PDF is opened, and files are not sent to third parties. This adds no server runtime or persistent directory and does not change the backup format.

Attachment downloads and media-preview content output use a two-minute write-idle timeout, so they no longer terminate merely because total download time exceeds the ordinary response deadline. Range support is retained.

The native backup manifest is version 2. It covers all registered images and `.bin` attachments and verifies SHA-256; restore also accepts old version 1 image backups. Portal `media` backup continues to use the entire `assets` directory from the native snapshot, with no shared collector changes. After attachments are used, program rollback must select a version that supports the `attachment` node and `.bin` backups; older programs cannot safely save such documents or complete a backup. After saving an attachment larger than 25 MiB, rollback must also select a version that has removed the attachment content-size check. Once collection is enabled, backups must use the new program with the directory shared lock; an old backup process that does not recognize the lock must not run concurrently with collection. Rolling the entire application back to an old program stops automatic collection but does not restore files already collected; restoring a file requires selecting a native backup that still contains it and following the restore process. See DESIGN 23.8 for filename and asset-path import/export rules.

## Editable Whiteboards

See [WHITEBOARD.md](WHITEBOARD.md) for the whiteboard format, API, and editing contract. Packages and images both reside in `data/assets/`; package MIME is `application/vnd.yuyan.drawing+json` and the extension is `.bin`. There are no database-table, data-directory, permission, or server-runtime changes. Package uploads are limited to 12 MiB and use the ordinary proxy limit; they do not use the unlimited attachment location. The engine and fonts are bundled by the local frontend build, and licenses are stored in the versioned font directory's `licenses/` subdirectory.

Saving a document containing a whiteboard requires `drawing-v1` in the comma-separated `X-Yuyan-Features` header; old tabs prompt the user to refresh, while new web pages and yuyan-doc send it automatically. Rollback must select a program that supports `drawing`. Unknown engines/packages cannot be edited, but a separately validated preview remains readable and the original file remains downloadable. If GC encounters an unknown or corrupt package, it stops that collection pass rather than guessing image references.

The v2 backup format is unchanged; whiteboard packages and dependent images are preserved with all registered assets. A package continues to protect its images while the package is in its unreferenced grace period; each image's own one-hour timer begins only after the package has been collected. History/template references remain protective, and backup hard links are unaffected by source-file collection. Isolated lifecycle checks cover deduplication, the package grace period, protection from current content/history/templates, refusal to save when a package is missing, v2 backup restore, and collection of the package before collection of its images.

The export directory retains `<ID>.yuyan.json`, the corresponding SVG/PNG, and the original images. Re-exporting must preserve images in the same directory; it fails if a package is missing or a hash does not match. Project import targets an empty instance only and must be dry-run first; it must not be repeated against a real nonempty database to overwrite data. The whiteboard download button can temporarily generate standalone `.excalidraw`, SVG, and PNG files.

High-density SVG save fix: Excalidraw's default export scale comes from the screen's pixel density, so 2×/3× displays can make the SVG width and height disagree with its viewBox, causing even a single newly drawn rectangle on an empty whiteboard to be rejected. Preview generation now fixes `exportScale: 1`, uses XMLSerializer to handle nonbreaking spaces, and normalizes frame clipping attributes; server-side safety validation is unchanged. The previous check adjusted only the viewport and did not cover display scale, so future export changes must explicitly set `deviceScaleFactor`. In old tabs, first download the editable file to preserve unapplied content, then refresh and recover the draft or import the file. Update the local Agent cache with `preview-setup`.

## Image Display Variants

The reading page and editor load narrower display variants according to rendered width and screen pixel density. Screens at 2× or higher have a separate tier, and screenshots may use JPEG; see DESIGN 26.3 for rules and endpoints. Variants are stored in `data/derived/images/`—one `<id>.json` manifest and several `<id>-<宽>.<jpg|png>` files per original image, with high-density-only files named `<id>-<宽>.hidpi.jpg`, all written by the service. This derived cache may be deleted in its entirety: it is excluded from native backups and is automatically replenished by the service after restore, migration, or deletion. Newly uploaded and currently viewed images take priority; all others are processed one at a time from newest to oldest beginning 1 minute after startup, using at most half of one CPU. Original images, export, backup, and yuyan-doc are unaffected. There are no database-migration, permission, or Nginx changes, and variant files use the existing `/yuyan/assets/` route and device authentication.

The read-only diagnostic `yuyan images --data <数据目录>` summarizes the processed count, count with variants, count with a high-density tier (`dense`), per-reason counts, space used by variants, and estimated transfer volume for images with variants on a 3× phone and 2× desktop. Reasons are: `small` (under 128 KiB), `animated`, `palette`, `cmyk`, `hdr`, `orientation` (PNG/WebP carries orientation), `profile` (abnormal color profile), `large` (over the decode limit), `decode`, `none` (no variant worth retaining), and `error`. The `display versions: backfill done` log records processed and variant counts for a completed pass; an individual failure records `display versions` and the reason. For a full rebuild, stop the service, delete `data/derived/images`, and restart. Deleting it while the service runs is also safe: missing files fall back to the original and regenerate when the page is opened.

Images read/written during backfill enter page cache, so `MemoryCurrent` and `MemoryPeak` can reach the 384M limit. Evaluate pressure through `anon`, `memory.pressure`, and `oom_kill`. `derived/` remains a cache resource and is reported separately by Portal, but NAS full cold backups and temporary upgrade copies include it; only the native registered-asset format omits it.

## Layout

Document templates and content snippets are stored in the existing `meta` table under `template:<id>`, with independent revision, document JSON, and format version; there is no database migration. Backups remain a complete SQLite snapshot plus all registered images and attachments. Images referenced by templates remain protected after the source document is deleted, and templates remain reusable independently. Restoring the template library requires native backup restore; knowledge-base Markdown exports do not include the template library. Link selection, previews, and end-of-document backlinks are derived from live document content, with no new index files or data directories. See DESIGN section 24 for APIs and interactions; keep the portal API declaration synchronized.

Independent `calendar` document blocks store their own period arrays in document JSON and are included in document exports, history, templates, and native backup. They use normal document APIs and require no database migration, new assets, or server configuration. Exported HTML carries a complete model and a readable table. Component clipboard transfer uses the versioned `YYCAL1:` string and the existing document save path; direct import has no preview/confirmation and is undoable. Only clipboard or decoding errors open a correction prompt. The transport does not change stored node attributes, APIs, data roots, or the backup contract. Saving or canceling edits to a current document containing a calendar requires the `calendar-v1` client feature token; old tabs are prompted to refresh before they can resave a body that their schema would discard. Once these blocks are saved, rollback must use a program that recognizes the `calendar` node. The standalone page, redirect, global-period APIs, and storage have been removed. Layout 4 deletes the retired table; document calendar data and the clipboard format are unchanged.

`/opt/yuyan/bin/yuyan` is the Linux amd64 program with the frontend embedded. `config` contains this project's unit and Nginx location; `data` contains `yuyan.db`, `assets/` (content-addressed images and attachments, with non-image attachments using the `.bin` extension), and `derived/images/` (deletable, unbacked-up image display variants); `backups` contains snapshots; `docs` and `AGENTS.md` are controlled documentation copies; `releases` retains release history; and `current-commit` records the program source. Knowledge-base groups are stored in the existing database `meta` table as `book_groups` JSON and are preserved by consistent backups. Old databases require no migration; when no configuration exists, all knowledge bases are ungrouped. Group APIs and the portal declaration must remain synchronized; groups add no data directory.

The runtime identity is `yuyan`, and the deployment identity is `yuyan-deploy`; `data` and `backups` are mode 0700, while the program and configuration are managed by root. The service listens on `127.0.0.1:18084` and is exposed through shared Nginx at `/yuyan/`, with no new public port. systemd permits writes only to `data`, limits memory to 384 MiB (`GOMEMLIMIT=320MiB`), and limits CPU to 100%. Images are served by the application with one-year `immutable` caching. Nginx does not read `data` directly, so `data` remains mode 0700.

The Nginx location enables gzip for HTML, JSON, JS, and CSS: server downstream bandwidth is only about 0.5 MB/s, and the longest document page is about 970 KB, or about 300 KB after compression. Go serves `.js` as `text/javascript`, which must be included in `gzip_types`; see the shared [JavaScript Returned by Go Is Not Compressed by Nginx](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#go-程序返回的-javascript-没有被-nginx-压缩). The attachment-upload route separately removes the size limit and disables request-body buffering; other requests remain limited to 26 MiB (the application limit is 25 MiB per image). After changing this file, synchronize `deploy/nginx-location.conf` from the same commit to `/opt/yuyan/config/nginx-location.conf`, then perform a graceful reload after `nginx -t` passes. `make deploy` does not synchronize Nginx configuration automatically.

The current public endpoint uses HTTPS and unified device authentication. Authorized devices can view and modify content; version history, the trash, and daily backups provide recovery.

For diagnosing dynamic-module 404s in old tabs after a release, see the shared [Dynamic Module Loading Fails in Old Tabs After a Release](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#发布后旧标签页的动态模块加载失败). This application's build manifest is at `/static/manifest.json`; page shells use `no-cache`, while hashed scripts are cached long-term. The UI provides a global refresh entry point; while editing, it saves first and does not refresh if saving conflicts or fails. Browser regression checks must actually intercept 404s for the Mermaid core chunk, chart-type chunk, and editing-page chunk, then verify the desktop and 375 px prompts, preservation of source and preview, continued input while saving, and the conflict draft.

## Initial Installation

First verify the port, identities, directories, and health of all existing services. The server requires no new system software.

```sh
# After running make release locally, take .local/releases/<commit>/program, verify the manifest, then upload the installation materials.
bash deploy/install.sh /path/to/yuyan-linux-amd64
ln -s /opt/yuyan/config/nginx-location.conf /etc/nginx/app-locations/yuyan.conf
nginx -t
systemctl reload nginx
bash deploy/setup-deploy.sh /path/to/yuyan-deploy.pub
```

`install` refuses existing directories/identities, explicitly initializes an empty database, starts the service, and leaves native backup scheduling disabled by default. It is not an existing-data migration importer. `setup-deploy` creates `yuyan-deploy` with only the fixed `deploy`, `portal-check`, and `portal` commands; sudo permits only its root-managed script. After installation, check direct/proxied health, resources, and deep links across the shared inventory.

## Database Layout Migration

Table column order has an independent layout version (`meta.layout`, default 1); see DESIGN 26.1. A new program automatically migrates an old layout when opening it; `serve`, `check`, and `restore` trigger migration, while `backup` and `daily` only copy the layout as-is. During deployment, the script stops the service, backs up with the old program first, then uses the new program's `check` to complete migration. On failure the script restores only the old program. For a migration that raises `min_layout`, a previously installed program may no longer open the database after a successful migration; use a compatible fixed program. Restoring a pre-upgrade backup is a separate data-recovery action, never an automatic program rollback.

```sh
yuyan migrate --dry-run --data /path/to/data   # Report the current layout and pending steps
yuyan migrate --data /path/to/data             # Execute and report elapsed time
```

Step 2, moving large fields to the end of `docs` and `doc_versions`, ran with the 2026-10-14 release. Earlier programs remain compatible. Rebuilt tables enlarge the file temporarily; later writes reuse free pages, native SQLite snapshots compact them, while complete NAS cold copies preserve the whole file. No manual VACUUM is needed. Rehearse future steps as `yuyan` against the independent candidate copy within the check's 60-second limit. Successful acceptance removes that work copy; failure retains the root-private recovery state. Confirm `min_layout` compatibility before rollback.

Step 4 removes retired `calendar_periods` and raises `min_layout` to 4. Layouts 1/2 skip obsolete table creation; layout 3 drops it; new databases initialize at layout 4. Document bodies, history, templates, and assets remain. Rollback requires a layout-4-capable program recognizing document calendars. NAS upgrade copies follow immediate successful acceptance or failure retention, not the legacy five-copy rule.

## Deployment and Rollback

Use the [Local Deployment Guide](DEPLOYMENT.md) for routine updates, declaration synchronization, and program rollback.

## Local Development

First run `npm --prefix web ci` to install locked dependencies.

```sh
make build
# Initialize only when using a new isolated directory for the first time; do not overwrite an existing directory.
bin/yuyan init --data .local/dev-data
bin/yuyan serve --data .local/dev-data --with-prefix
```

Verify the current feature in an isolated instance; use the roundtrip check as appropriate for editor/document-format changes. There is no requirement for a full regression run or permanent tests. The import, export, and roundtrip tools are described in later sections. The server runs only the Go program with its embedded frontend.

### Browser Verification Notes

Reusable lessons from local browser checks; when a check fails in one of these ways, suspect the test harness before the application:

- **Keep the test server alive for the whole session.** Start `serve` as a long-lived task (a terminal or background task that outlives the launching command), not as `bin/yuyan serve … &` inside a short-lived shell: the child process dies with that shell, and the resulting connection refusal looks like an application failure. Before browser work, confirm the instance answers (for example `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/yuyan/`) and glance at its log; stop the server when finished.
- **Always take a fresh editor handle.** After every navigation or reload, fetch the editor again with `document.querySelector('.ProseMirror').editor`; never reuse a handle captured on a previous page — a stale or destroyed editor silently accepts commands that do nothing. For asynchronous CDP evaluation, await the promise (or poll the document/selection) instead of reading state synchronously in the same step. Floating toolbars (BubbleMenu) keep their element detached until shown and render their buttons only after the plugin positions them, so inspect toolbar presence and buttons in a separate step after the selection transaction settles.
- **Validate synthetic fixtures before interacting.** Build test content as editor JSON, then immediately read back `editor.getJSON()` and confirm it matches the intended document before clicking anything. Test unfamiliar node types one at a time first; nodes need their complete attribute sets (for images, reuse a real asset `src` returned by the seeded instance's API rather than inventing one). An invalid fixture can be normalized away (for example to an empty paragraph), which is a test-data problem, not an editor bug.
- **Use real clicks for menus and popovers.** Open menus, popovers, and toolbar panels with the browser tool's real click on a snapshot reference, and confirm via `aria-expanded` plus the menu items in the next snapshot. Synthetic events dispatched through CDP evaluation (`dispatchEvent(new MouseEvent('mousedown' …))`, `element.click()`) do not reproduce real pointer ordering, mousedown handling, and focus capture, and can make a working menu appear broken. Reserve CDP evaluation for setting selections and reading document/editor state.

Fold and highlight blocks add the document nodes `foldBlock`, `foldTitle`, `foldContent`, and `highlightBlock` (DESIGN.md 23.6), using the existing JSON, revision, and consistent backups with no database migration, API, or storage-directory additions. Export preserves the containers, folded state, and background color as HTML, and import reads them back. After these blocks are used, rollback must select a program that recognizes the nodes. Verification uses synthetic nested content to cover folding, recoloring, dialogs, undo, save/reopen, and format roundtrips, plus a read-only roundtrip against production.

Columns add the `columns(widths)` and `column` document nodes (DESIGN.md 23.7), with no database migration or new API, media directory, or backup-format change. HTML export preserves column widths and content order. After columns are written, rollback must support these nodes; an old editor must not silently flatten or discard the layout. Verification uses isolated synthetic documents to cover reducing the column count, removing columns, cross-column dragging, undo, narrow screens, and import/export. Production receives only a read-only roundtrip.

Code-block title visibility uses `codeBlock.titleHidden`; `title` retains the original text. After the title is hidden, save/reopen, HTML copy/paste, and Markdown import/export all restore it (DESIGN.md section 16). The property defaults to false, so old documents remain unchanged. There are no database-migration, API, media, or backup-format changes. Old programs do not recognize the property and may redisplay hidden titles after rollback. Titles previously cleared by the old “隐藏标题栏” operation do not reappear automatically; the original text can be viewed in existing history versions, and this change does not rewrite real documents.

Directory batch operations use `POST /api/docs/batch` for copy, move, and move-to-trash; see DESIGN.md 12.5 for parameters and interactions, and include the endpoint in the portal declaration. They use existing tables, document formats, history snapshots, and image storage, with no database migration. Real documents are operated on only after the user selects them in the UI. During maintenance, use an isolated synthetic instance to check parent/child selection, directory-change conflicts, cross-knowledge-base moves, copied hierarchy/internal links/history, and transactional rollback on mid-operation failures; do not test deletion or copying against production documents.

The image-tool extensions use crop parameters in document content and the `imageBoard` node. They do not change database tables or image storage, do not generate destructive cropped files, and continue using original images for copy, resource counting, and backup. New nodes are enabled in both Go and the editor. Markdown export uses HTML to preserve cropping and board layout. Documents containing composites are incompatible with old programs that do not recognize `imageBoard`; check content-format compatibility before program rollback, and do not automatically delete or downgrade content.

The first set of formats beyond Markdown (DESIGN section 23) adds `textColor`, `image.caption`, and the cell property `backgroundColor`; headers and merged cells use existing nodes and span properties. There is no database migration or new API, media directory, or backup-format change, and the portal resource declaration remains unchanged. Existing documents are not rewritten. Formats that Markdown cannot represent are exported as HTML together with their enclosing list, quote, or other container and read back. After text colors are used, old programs may reject the new mark; old editors may also discard image captions and background colors. Before rollback, confirm content compatibility; do not downgrade content automatically. See [VERIFICATION.md](VERIFICATION.md) section 23 for the verification record.

Color-tool improvements (DESIGN 23.4) store text background color in `highlight.color` and a fixed gradient name in `textColor.gradient`, retaining a solid-color fallback value; the default highlight format is unchanged. Colored highlights and gradients roundtrip through HTML export, while old editors may discard the new properties. Recent custom colors and the last-used color are stored only in the browser under `yuyan:colors`; clearing browser data resets those preferences without affecting saved documents. This change requires no data migration or portal-declaration update.

Format Painter (DESIGN 23.5) reuses existing text marks, headings, and paragraph alignment. Sampling and continuous mode are temporary editor state only and are not written to document content or browser storage. Each application uses existing document revision checks and autosave and creates an independent undo step. There are no schema, database, API, media, or portal-declaration changes.

The enlarged crop preview and draggable split lines use existing geometry parameters and require no format or database migration.

Dialogs once caused code blocks to be emptied: Vue node views gave ProseMirror a detached `contentDOM`; when a dialog hid background accessibility content, ancestor DOM reparsing read it as empty document content, after which cropping aborted because the document had already changed. Code blocks and image boards now use the shared managed view, and content is updated only through document transactions. Locate and restore already-saved damaged content from version history; obtain separate confirmation before restoring real documents, and use revision checks to avoid overwriting newer edits.

## Production Import

Import is a one-time operation, and the target must be an empty instance. The tool runs on the development computer. The public endpoint now requires a device cookie, so existing command-line tools use a trusted SSH tunnel: first run `ssh -N -L 127.0.0.1:18199:127.0.0.1:18084 ali` in another terminal, after confirming that the local port is free. The direct backend has no `/yuyan/` prefix. Import through the tunnel still requires separate confirmation before writing real data.

```sh
npm --prefix web run import -- --source <笔记仓库副本> --server http://127.0.0.1:18199/ \
  --overrides .local/import-overrides.json --report .local/import-prod.md --dry
# Remove --dry for the production import; afterward, check that the editor accepts every document unchanged:
npm --prefix web run roundtrip -- --server http://127.0.0.1:18199/
```

`roundtrip` only reads from the server. It checks that every document is accepted unchanged by the editor schema and that editing tables does not adjust existing column widths or default column alignment; header and merged-cell structures remain unchanged (see DESIGN.md section 23). Run it against the production instance before deployment after modifying editor configuration.

The overrides file records choices that require human judgment, such as different images with the same name, and is not stored in the database. The 2026-09-26 production import had only one entry: `{"images": {"AI记录/Gradle 入门.md|img-001.png": "AI记录/attachments/img-001.png"}}`; the local file has been deleted, so use this entry to reconstruct it when importing into an empty instance again.

## Code Callout Migration

`migrate-code` converts `[!code]` Callouts into titled code blocks (DESIGN 16). It runs locally through an SSH tunnel to NAS; first deploy a compatible program. Direct upstream paths have no `/yuyan/` prefix. This rewrites real documents: obtain the user's write authorization and a complete manual external backup through the Portal/agent workflow before the write command.

```sh
ssh -N -L 18199:127.0.0.1:18084 nas &                                    # Tunnel; terminate it when finished
npm --prefix web run migrate-code -- --server http://127.0.0.1:18199/ --dry   # Report only
npm --prefix web run migrate-code -- --server http://127.0.0.1:18199/
npm --prefix web run roundtrip -- --server http://127.0.0.1:18199/
```

Each changed document receives a version snapshot before it is written, and the write checks the revision; rerunning the migration makes no further changes. To revert one document, restore its pre-migration version from history. The migration was run against production on 2026-09-27 and converted all 313 occurrences across 62 documents (see VERIFICATION.md section 16); it does not need to run again. Markdown import now converts `[!code]` directly into code blocks.

## Existing Bold-Mark Repair

First distinguish the source: bold adjacent to Chinese punctuation is already supported by the shared converter, but whitespace inside markers, missing closing markers, and unescaped multiplication signs in formulas can still become plain text. A successful save or lossless native-JSON readback proves storage integrity, not that Markdown formatting intent was recognized.

New imports receive source-file line and column locations for unparsed `**` through the `issue` callback from `markdownToDoc`; yuyan-doc's `validate/create --format markdown` reports `conversion_error` before writing. Check the original text first and correct delimiters in a working copy; use escaping or code for literal asterisks. Do not globally delete asterisks, automatically close ambiguous ranges, or convert unchanged content to JSON to bypass diagnostics. Preserve the meaning of code, formulas, HTML, and already escaped literals.

For documents already imported through yuyan-doc, save the latest snapshot with the skill's `read --out`, locate each paragraph from the original import material, and create `replace` patches while preserving all other marks, links, media, and block attributes. Run `edit --dry-run` first, then save and check `verified:true`. For paragraphs with missing closing markers or ambiguity with multiplication signs, determine the intended bold range from the original source. The repaired Markdown export already contains escaping and therefore cannot serve as evidence of the original formatting intent. Before batch repair, use an isolated instance to verify preservation of local content, history, and revision-conflict protection.

`migrate-strong` repairs bold that the original Markdown failed to recognize or paired incorrectly because of punctuation boundaries. It does not reimport entire documents and does not scan for asterisks while reading or editing. You must obtain the Markdown from the original import commit, map it to document IDs using the read-only database value `docs.source_path`, and place it in a private directory with filenames `<id>.md`. Do not use Markdown exported from Yuyan after the fix as the original source. Content, preview reports, and original notes must remain in `.local` or another untracked location.

This migration tool only compares strict CommonMark with the Chinese-punctuation compatibility rule. It does not repair whitespace, unclosed markers, or formula ambiguity in the source. When both parsers fail, use the local patch process above; rerunning the old migration cannot resolve it.

```sh
# Access the instance through a trusted SSH tunnel. Preview generation uses GET requests only, and the report must be written to a new file.
npm --prefix web run migrate-strong -- --server http://127.0.0.1:18199/ \
  --source-dir "$PWD/.local/strong-source" --preview "$PWD/.local/strong-preview.json"
# After reviewing the report and obtaining authorization to modify real data, create an application-consistent backup before applying the same report.
npm --prefix web run migrate-strong -- --server http://127.0.0.1:18199/ \
  --apply "$PWD/.local/strong-preview.json"
```

The preview records each paragraph's JSON before and after modification, the document revision, and the content hash. Check every document before writing. If any document changes after preview generation, stop and regenerate the preview. Each document receives a history snapshot before it is written through the normal save API with `baseRevision`. A conflict during writing stops the operation immediately; successfully written documents can be restored from history. Regenerating the preview does not alter already repaired paragraphs again. The tool changes only paired asterisks and bold; it skips paragraphs that cannot be modified in only those ways, do not match current content, or contain escaping whose meaning cannot be distinguished within the document.

## Semantic Formatting Repair After Material Import

Typora material may use pink inline-code styling to emphasize ordinary text. The shared parser preserves `code` according to syntax; successful storage does not mean this visual intent was migrated. When using yuyan-doc, first classify instances from the original text and context, convert confirmed natural language to native `textColor` (for example, `#d63384`), and preserve real SQL, commands, identifiers, strings, and syntax templates. If one code mark covers both explanatory text and an identifier, split it. Do not use “contains Chinese” as a global replacement rule, and do not modify the site's shared code color scheme.

For mixed screenshots containing independent paragraphs or SQL editing areas, first verify and transcribe them into document text, tables, or code blocks. Then crop a working copy and replace it with a new asset through `upload`, preserving the illustration's own labels, arrows, and legend. The reading mask `crop` does not reduce uploaded file content; when the user asks to remove a text area physically, do not substitute a mask for an actual crop. New nodes must use the new file's `sourceWidth/sourceHeight`, an appropriate display width, and `height:null`.

Content changes still use the skill's complete `read/edit` snapshot, revision protection, and save readback; for batch content, first verify in isolation and then run `edit --dry-run`. Keep private classification and crop manifests out of the project repository, along with user text, OCR, and screenshots. Targeted verification must confirm that existing content order, real code, tables, and links remain unchanged, and check native color on the relevant paragraphs plus image proportions. Detailed processing rules are maintained in yuyan-doc's editing/format reference; this project does not duplicate the converter scripts.

## Export

The export tool runs on the development computer and exports all knowledge bases into a directory that Obsidian can open directly. Content that Markdown cannot express is written as HTML, such as tables with specified column widths and row heights; see DESIGN.md section 18. Each knowledge base is a directory, each group is a directory, and each document is a Markdown file. A document with child documents is represented by a same-named Markdown file plus a same-named directory. Images and attachments are stored under the root `attachments/` directory and referenced with relative paths. Export only reads the server and makes no changes. Establish the trusted SSH tunnel described above, then use the loopback address.

```sh
npm --prefix web run export -- --server http://127.0.0.1:18199/ --dry          # Convert and check only; do not write files
npm --prefix web run export -- --server http://127.0.0.1:18199/ --out ~/YuyanExport
```

The target directory must be new and empty or a previous export result. Exporting again to the same directory refreshes Markdown, downloads only missing images/attachments or those whose checksums do not match, and removes files present in the previous export but absent from the current one. Files outside the export are unchanged, so rerun the command to resume after interruption. `.yuyan-export/` contains the manifest and report. The report lists failed image and attachment downloads, links to documents in the trash, and files renamed because of illegal characters or same-level name collisions. All images total about 340 MB and take about 12 minutes over the server's approximately 0.5 MB/s downstream connection. In the 2026-09-26 production dry run, all 315 documents converted successfully and all 1,511 images were present.

`npm --prefix web run seed -- --server <本地实例>/yuyan/` writes synthetic sample data into an empty local instance for UI and export evaluation; it refuses to write to an instance that already contains a knowledge base.

## Backup and Restore

NAS routine backups are manual complete compressed archives on an explicitly identified external volume through Portal or the agent. Pause business/background services, cold-copy every database table and all data/config/program files to external staging, resume previously running services, then compress and verify the immutable copy. Coverage includes retained history, templates, document calendars, original assets/attachments/drawings, and `data/derived`. No routine stage/archive, native daily timer, or automatic backup deletion runs on NAS. Existing verified 2026-09-27 maintenance-computer and independent ALI Cloud Backup materials remain preserved in shared current-state. Use export when an Obsidian-usable content copy is required.

```sh
systemctl status yuyan-backup.timer
journalctl -u yuyan-backup.service -n 50 --no-pager
runuser -u yuyan -- /opt/yuyan/bin/yuyan backup --data /opt/yuyan/data --out /opt/yuyan/backups/manual-UNIQUE
```

The native tools below remain for old packages and isolated checks. Their format uses `VACUUM INTO`, hard-linked registered assets/attachments, and a SHA-256 manifest; it omits derived files and is not the NAS full-state job. Destinations must not exist. Never edit hard-linked originals inside a native snapshot; restore requires its completed manifest.

```sh
yuyan restore --from /path/to/backup --data /path/to/new-restore-directory
yuyan check --data /path/to/new-restore-directory
# First check that 19084 is free, then start the isolated restored instance
yuyan serve --data /path/to/new-restore-directory --listen 127.0.0.1:19084 --with-prefix
```

The native `restore` verifies its manifest and copies assets independently into a new target. Full NAS cold archives are instead extracted and verified in an isolated directory before the agent restores the complete application subtree. Confirm the recovery point and later data loss; stop writes, preserve current state, set ownership, and restart for read-only validation. Inspect old history before startup maintenance and keep NAS native scheduling disabled. Program rollback is not data restoration.

## Diagnostics

```sh
systemctl status yuyan yuyan-backup.timer
journalctl -u yuyan -n 100 --no-pager
curl --fail http://127.0.0.1:18084/healthz
curl --fail http://127.0.0.1/yuyan/healthz
systemctl show yuyan -p MemoryCurrent -p MemoryPeak -p NRestarts
du -sh /opt/yuyan/data /opt/yuyan/backups
runuser -u yuyan -- /opt/yuyan/bin/yuyan images --data /opt/yuyan/data
```

`MemoryCurrent` includes page cache. The program itself (`anon`) uses about 80 MiB after startup, including about 18 MiB for the full-text search index; the `search index ready` startup log reports the document count, byte count, and elapsed time. Most of the remainder is reclaimable file cache. When diagnosing memory, inspect `anon` in `/sys/fs/cgroup/system.slice/yuyan.service/memory.stat` and `oom_kill` in `memory.events`; do not infer a problem merely from usage near the limit.

If the database is missing or corrupt, inspect backups and permissions; never hide it with an empty `init`. After managed documentation is pushed, run `SYNC_HOST=nas ~/agent-config/skills/server-operations/scripts/sync-docs.sh Yuyan`.

## ServerPortal Integration Materials

`deploy/portal.json` is the maintenance source for this application's resource declaration. Local deployment uses the server-operations validator and stores the same declaration and binary in the same local version directory. It runs `portal-check` before deployment and `portal` afterward, installs the declaration at `/opt/yuyan/config/portal.json` through the existing restricted SSH path, and verifies the SHA-256 actually loaded by the collector. `config/portal-source.json` records the declaration's source commit; it and the program's `current-commit` independently identify the versions of different materials.

The portal discovers this application through the controlled link `/opt/serverportal/registry.d/yuyan.json`; it loads a successfully updated declaration automatically, without a restart. The first normal local deployment also creates the link, so the portal's central application list does not need to be edited. Ordinary deployments may update this application's declaration; other units, environment files, Nginx configuration, and deployment scripts still require administrator installation.

Source-code or database-behavior changes must not use this option as a substitute for a program deployment.

When the data root, media, backup format, unit, port, or access path changes, update the declaration and corresponding documentation in the same commit, update the shared inventory, and verify resource coverage. The portal automatically reads files, media, database tables, and systemd state; the maintaining agent must explicitly update directory purposes, API descriptions, and permission boundaries. See [Portal Maintenance](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/portal.md) for shared protocols, failure handling, and new-application integration.

Portal protects both HTTPS entrances; loopback release checks remain private and public unauthorized APIs return 401. Device grants persist until revocation; preserve shared cookie-renewal headers. NAS Portal backups cold-copy complete state, including derivatives, to external staging rather than relying on native registered-asset snapshots. Recovery remains agent-operated after confirming the recovery point.

## Mobile Home-Screen Icon

The application name in the portal is `Yuyan`, maintained in `deploy/portal.json`; do not append the Chinese product description to the portal display name.

The source now includes the 180×180 PNG `/yuyan/static/apple-touch-icon.png` and a shared page-head declaration. The Nginx rules allow anonymous GET/HEAD only for it and `favicon.svg`. The graphic source is `web/public/favicon.svg`; when the maintenance computer has libvips, regenerate the icon with `node web/scripts/generate-icons.mjs`. Pages, APIs, and user media continue to use device authentication. For the shared cause, deployment state, and mobile acceptance checks, see [Missing iPhone Home-Screen Icon After Unified Authentication](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证后-iphone-桌面图标缺失).

## Current Deployment Entry Point

This project is for personal use: local verification of the current change is sufficient for deployment. There is no full-regression gate, and permanent tests are neither added nor retained by default. For UI changes, check the actual desktop/mobile scenarios in use; data migrations, batch writes/deletes, and backup restore must first receive targeted verification against an isolated copy.

See [Local Deployment and Rollback](DEPLOYMENT.md) for the complete process. GitHub stores source code only; local `make release` builds the artifact, `make deploy` updates production, and documentation is synchronized separately.

The table-header control is now a direct button in both top and floating table tool sets and uses the exact user-supplied PNG without redrawing it; the empty `表格设置` entry remains visible but disabled. This is a frontend-only interaction change with no data migration, document-format, API, portal-declaration, or server-configuration change. Existing tabs require a page refresh. See VERIFICATION 26.5.2–26.5.3 for the focused desktop/mobile checks and release receipts.

## Release-Material Cleanup

NAS has no daily backup/release pruning. Successful upgrade acceptance removes only its private `/var/lib/server-upgrades/yuyan/<release>/` and candidate work copy; failed or uncertain copies remain for the agent. Existing ALI and maintenance-computer backups are untouched. [Legacy retention](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/retention.md) is not enabled for NAS upgrades.
