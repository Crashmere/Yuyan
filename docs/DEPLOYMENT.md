# Local Release and Rollback

This project is for personal use: the current change may be released after it has been verified locally; there is no full-regression gate, and permanent tests are not added or retained by default. For UI changes, check the computer and mobile scenarios actually used. For data migrations, bulk writes or deletions, and backup restoration, first perform targeted verification on an isolated copy.

GitHub is only a backup for source code and configuration, and Actions is disabled. Committing and pushing do not update production. See [server-operations local release](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/release.md) for shared implementation and environment preparation; this project's parameters come from `deploy/release.json`.

## Routine Use

`make deploy` targets `nas` and its dedicated deployment key. `vps` provides public HTTPS on port 8443; temporary `ali` access forwards to the same NAS application. Public-check overrides and host-specific keys are maintained in the shared release guide. Explicit legacy ALI deployment must not create a second writer after migration.

When a platform capability changes, include [yuyan-doc synchronization maintenance](README.md#yuyan-doc-synchronization-maintenance) in the task. Complete the affected skill instructions, scripts, and targeted verification together with the project change, then commit and push the two repositories separately.

```sh
# Validate this feature locally, then commit and push the source.
git add <files-changed-in-this-task>
git commit -m "Describe the change"
git push origin main
make release   # Build from the committed snapshot; do not run the full test suite
make deploy    # Reuse the artifact from the same commit and release it over SSH
```

Local materials are stored in `.local/releases/<full-commit>/` and include the program, manifest.json, and portal.json from the same commit. Deployment verifies hashes and confirms that the commit has been backed up to origin/main; it reuses the artifact if the source has not changed. Untracked files are not included in the build. `make releases` lists local versions; these materials are not committed to Git.

To update only portal information, run `make portal`; it preflights and synchronizes the declaration from the same commit without building or restarting the business program. A declaration synchronization failure does not automatically roll back a program that was updated successfully; fix the problem and retry it separately.

## Release Boundaries

Use the restricted yuyan-deploy identity; the private key exists only on the maintenance computer. To create the account for the first time, run `deploy/setup-deploy.sh <local-release-public-key>`; do not initialize an existing account again. The forced command accepts only deploy, portal-check, and portal; sudo allows only this application's fixed release script.

Switching begins only after upload and validation pass. On `nas`, the shared helper cold-copies complete data/config/program state, including all assets, retained history, and derivatives, to root-private `/var/lib/server-upgrades/yuyan/<release>/`. The candidate first checks an independent copy; its live `check` may apply layout migration after the recovery snapshot is secured. Successful runtime and complete previous SQLite-row/file preservation checks immediately delete only this upgrade's local copy. Failure or uncertainty retains it. The failure handler restores only `previous`; after a migration raises `min_layout`, recovery may require a compatible fixed program. Layout 4 requires layout-4-capable binaries including document calendars. Normal releases do not transfer production data. Administrators install units, Nginx, env, authorization, and scripts from source; documentation uses `SYNC_HOST=nas` with shared sync-docs.sh.

The release tool uploads with gzip under the existing protocol and verifies the SHA-256 of the uncompressed program. When editor formats change, use the retained roundtrip tool as needed; an ordinary release does not run historical browser regression.

## Rollback and Troubleshooting

```sh
make releases
make rollback COMMIT=<explicitly-selected-full-old-commit>
```

Rollback reuses a retained, locally verified artifact and still performs backup and health checks. First confirm that the old program is compatible with current data; see the [Database Layout Migration](OPERATIONS.md#database-layout-migration) section of OPERATIONS for database-layout compatibility rules. Program rollback does not restore the database, photos, or device state. When data restoration is required, first choose the restoration point and preserve the current state, then follow OPERATIONS/RESTORE.

NAS retains programs, `previous`, metadata, result/recovery, and upgrade-acceptance evidence in `/opt/yuyan/releases/`; `current-commit` records the source actually running. `.local/releases/<commit>/last-deployment.json` records the local result. After a failed switch, inspect the result, journal, and retained private snapshot before startup or restoration. NAS does not automatically prune uncertain upgrade copies. [Legacy automatic retention](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/retention.md) applies to `ali`, not the NAS recovery namespace.
