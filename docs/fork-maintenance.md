# How to maintain this fork

This repository is [derrickzhde/paseo](https://github.com/derrickzhde/paseo), a fork of [getpaseo/paseo](https://github.com/getpaseo/paseo). Follow upstream releases while preserving the behavior added by this fork. Read this guide before the upstream [release playbook](release.md).

## Maintenance policy

For each new upstream release:

1. Compare upstream changes with the fork's current customizations and report the overlap before integrating.
2. For a local bug fix that upstream now fixes equivalently, remove the local patch and use upstream's implementation.
3. Keep features and bug fixes upstream still lacks, adapting them to upstream's current architecture.
4. Verify the integrated candidate locally, then run full CI and Nix checks before the release push.
5. Push the approved release inputs, monitor GitHub Actions, and verify the published assets, updater manifests and Docker images.

An edit to the same file, a similar release-note entry, or a clean merge does not establish equivalence. Check the original failure, callers, data flow and regression tests. An upstream replacement of a subsystem can require adaptation even without a textual conflict.

Follow the active agent/session instructions and the task principal's authorization. This document records the process; it grants no standing permission to commit, push, merge, tag, publish, install an update or restart a daemon. If a required check fails or publication is unsafe, report the blocker before the release push.

## Starting point

As of 2026-10-27, fork **v0.13.3** incorporates upstream **v0.13.2**:

| Reference        | Commit                                        |
| ---------------- | --------------------------------------------- |
| Upstream v0.13.2 | `d2941157a8f91512daf54fc688241d416e8f5ebd`    |
| Fork v0.13.3     | Resolve the published `v0.13.3` tag with Git. |

The integrated fork lives on `main`; `origin` points to `derrickzhde/paseo`. Older history mentions an upstream-mirror `main` and a rebased `mine` branch. Derive the next integration from the actual current refs; do not restore that older arrangement or rewrite published history.

Start with `git status --short --branch`, `git remote -v`, `git worktree list --porcelain` and the active instructions. Preserve existing uncommitted work. Use a task-owned worktree when integration or dependency installation needs isolation. Follow [development](development.md) for workspace builds and [testing](testing.md) for test conventions. Never restart the main daemon on port 6767 without separate permission.

## Compare the next release

Confirm the requested upstream release and pin its commit. Keep upstream tags in a separate ref namespace: upstream and fork version tags have collided before. Do not fetch all upstream tags over local fork tags or force-update a published tag.

For example, this fetches the known baseline; substitute the requested release for the next integration:

```bash
UPSTREAM_TAG=v0.13.2
git fetch --no-tags https://github.com/getpaseo/paseo.git \
  "refs/tags/${UPSTREAM_TAG:?}:refs/remotes/upstream-release/${UPSTREAM_TAG:?}"
UPSTREAM_COMMIT=$(git rev-parse "refs/remotes/upstream-release/${UPSTREAM_TAG:?}^{commit}")
FORK_COMMIT=$(git rev-parse HEAD)
BASE_COMMIT=$(git merge-base "${FORK_COMMIT:?}" "${UPSTREAM_COMMIT:?}")

git diff --name-status "${BASE_COMMIT:?}" "${FORK_COMMIT:?}"
git diff --name-status "${BASE_COMMIT:?}" "${UPSTREAM_COMMIT:?}"
```

Compare both changesets from that common ancestor. Read the overlapping hunks and inspect upstream changes to dependencies, entry points and callers of retained code. Also inspect fork-only files whose old callers upstream removed. Use the inventory below as a starting list, then derive the complete current fork delta from Git.

Report each customization as **replace with upstream**, **retain unchanged**, or **retain and adapt**, with supporting source/test evidence and any verification gap. Keep the upstream tag, both heads, common ancestor and decision list in the task record. Report the comparison before editing; continue authorized integration without another routine confirmation.

The v0.13.2 comparison found 21 overlapping paths among 176 customized paths, including the uncommitted session metrics and GitHub updater. Most overlap was release metadata. The Enriched Markdown patch combines upstream's Android measurement fixes with the fork's math additions; no unique fork behavior was replaced. These counts describe that comparison, not a permanent inventory.

## Current customization inventory

Paths below are relative to the repository root. Recheck every row against each new release and update it after integration.

| Area                                       | Behavior to preserve and adaptation notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Source and verification entry points                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Math rendering and copying                 | Keep `\(...\)`, `\[...\]` and `$$...$$`; single-dollar prose remains literal. Upstream v0.12 replaced the old renderer with Enriched Markdown. Adapt the source and the new engine rather than restoring deleted Markdown-display or iOS text-view files. Native uses RaTeX and exports normalized TeX; web uses MathJax SVG and preserves original delimiters when copied. Protect code, currency, adjacent inline formulas and streaming boundaries. The detailed contract belongs in [Markdown rendering](markdown-renderer.md#engine-constraints). | `packages/app/src/utils/markdown-math.ts`, `math-svg.ts`, `markdown-parser.ts`; `packages/app/src/components/markdown/renderer.tsx`, `streaming.ts`, `math/`; `packages/app/src/assistant-selection-copy/`; their existing tests and `packages/app/e2e/browser/plan-card-markdown.spec.ts`.                                                                                              |
| Enriched Markdown patch and symbol fonts   | Retain the fork's math renderer hook/parser changes when refreshing the library patch. An upstream library fix does not automatically replace these additions. Native math/configuration changes require a native client rebuild. Web symbol font fallbacks cover combining mathematical marks in ordinary text.                                                                                                                                                                                                                                       | `patches/react-native-enriched-markdown+1.2.0-nightly-20261014-766fc0e67.patch`, `packages/app/package.json`, `packages/app/src/styles/theme.ts`; [engine constraints](markdown-renderer.md#engine-constraints).                                                                                                                                                                         |
| Phone 12/24-hour clock and timestamp dates | Follow the phone's explicit clock setting through `expo-localization`, independent of locale defaults. Refresh the formatter when that preference changes. Keep calendar-day boundaries for older timestamp labels, including DST. Web/desktop use the base clock implementation.                                                                                                                                                                                                                                                                      | `packages/app/src/utils/device-clock.native.ts`, `device-clock.ts`, `time.ts`, `time.test.ts`. Run time tests with the CI English locale, for example `LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8`.                                                                                                                                                                                             |
| Per-model thinking and feature controls    | Resolve draft options for the selected provider/model/mode, including an explicitly empty thinking list. Preserve probe serialization, restoration of a temporarily selected model and forwarding of configured provider options. Probe/diagnostic processes advertise `terminal: false`; live sessions retain their real capabilities. Adapt all layers when upstream moves configuration ownership. Keep wire additions optional under [protocol compatibility](protocol-compatibility.md).                                                          | `packages/server/src/server/agent/providers/acp-agent.ts`; `agent-manager.ts`, `agent-sdk-types.ts`, `provider-registry.ts`; `packages/server/src/server/session/provider/provider-catalog-session.ts`; `packages/protocol/src/messages.ts`; `packages/app/src/agent-profiles/internal/`. Existing Cursor ACP, generic ACP diagnostic, catalog and profile-form tests cover these paths. |
| Claude model/context controls              | Keep selectable 200K and `[1m]` variants for the patched Opus/Fable entries and preserve suffixes through runtime model resolution. A label or reported token count alone cannot request the larger context window. Check new upstream model entries individually; do not infer another model's limits from a name.                                                                                                                                                                                                                                    | `packages/server/src/server/agent/providers/claude/model-manifest.ts`, `models.ts`, `models.test.ts`, `agent.context-window.test.ts`.                                                                                                                                                                                                                                                    |
| Codex follow-ups during `/goal` turns      | A turn Codex starts itself needs an identity that Paseo can steer into. Child completion notifications and follow-up prompts must reach that active turn without interrupting it and starting a replacement. Keep event tagging, admission checks and cleanup on completion/process exit aligned. Reproduce an autonomous goal continuation when assessing a similar upstream steering fix.                                                                                                                                                            | `packages/server/src/server/agent/providers/codex-app-server-agent.ts`, `codex-app-server-agent.test.ts`, `codex-app-server-agent.process-exit.test.ts`.                                                                                                                                                                                                                                 |
| Expo push recovery                         | When Expo rejects a mixed-project batch, retry messages individually. Preserve the service-wide concurrency limit across overlapping sends, request timeout and redacted error logging. A per-batch limit does not bound all concurrent sends.                                                                                                                                                                                                                                                                                                         | `packages/server/src/server/push/push-service.ts`, `push-service.test.ts`, especially overlapping sends and permit handoff cases.                                                                                                                                                                                                                                                        |
| GLM ACP adapter/catalog                    | Use the GLM adapter through the existing generic ACP integration. The old fork pin `glm-acp-agent@1.8.0` was dropped in v0.13.2 in favor of upstream's `1.15.0`; the catalog file then matched upstream. Keep the shared ACP fixes above. Reassess adapter compatibility against the next upstream pin; do not restore an obsolete pin or update unrelated providers as part of the integration.                                                                                                                                                       | `packages/app/src/data/acp-provider-catalog.ts`; generic ACP source/tests above; [custom providers](custom-providers.md#acp-providers).                                                                                                                                                                                                                                                  |
| Claude imported-session cache              | Keep only one observed descriptor version per session path. Multiple historical metadata-keyed entries could resurrect a stale title after an append, same-length rewrite and restored mtime. Preserve bounded caching, metadata validation and the post-read stat check. This extra fix was added during v0.13.2 verification.                                                                                                                                                                                                                        | `packages/server/src/server/agent/providers/claude/agent.ts`, existing same-length rewrite case in `agent.test.ts`, and `agent.import-large-record.test.ts`.                                                                                                                                                                                                                             |
| Fork identity and release infrastructure   | Preserve fork desktop publishing/updater URLs, mobile application IDs and EAS ownership while adopting upstream build changes. Keep fork-safe CI conditions, manual Nix candidate checks and the two-worker Nix desktop export limit. Internal `@getpaseo/*` workspace package names remain unchanged.                                                                                                                                                                                                                                                 | `packages/desktop/electron-builder.yml`; `packages/app/src/desktop/updates/desktop-updates.ts` and its test; `packages/app/app.config.js`, `eas.json`, `native-release-version.js`; `.github/workflows/`, `nix/desktop-package.nix`, `nix/npm-deps.hash`.                                                                                                                                |

Keep the fork's [session metrics](agent-stream-performance.md#session-metrics-in-the-context-details) when adapting usage reporting or the context meter: active-request TPS from paired response counts and durations, and current-session cache-hit percentage with provider normalization and unknown data preserved.

Mobile identity is `com.halocloudnet.paseo` with `.debug` for development. Preserve the existing fork EAS project/owner and store connection; do not copy credentials into task records or docs. [Android version codes](android.md#version-codes) owns the native version formulas, including the historical iOS 0.11.3 exception. Keep Android/mobile testing instructions aligned with the fork IDs.

## Remote host self-update

The host owns the upgrade source. Changing the app does not change an older daemon's updater. The client requires `features.forkDaemonSelfUpdate` before sending an upgrade request, so an older host cannot silently invoke its upstream npm updater. Install a fork release containing this updater on the host once before using the overview's upgrade action for subsequent releases.

Preserve the fork CLI archive in the Desktop Release workflow: `paseo-cli-<version>.tgz`. It carries the compiled CLI and its fork workspace packages together; installing the GitHub source archive or the upstream npm CLI loses that guarantee. The Linux release job builds the browser UI and creates this platform-independent npm archive. Native third-party dependencies still install through npm on the target host.

Self-update selects the fork's latest stable GitHub release and verifies the asset's published size and SHA256 before passing the local archive to npm. A missing archive, an unverifiable download or a downgrade fails without falling back to upstream. Fork v0.13.2 predates this asset; v0.13.3 adds it. Older hosts still need the one-time fork installation described above.

The existing installation restrictions remain: the running daemon must belong to a normal npm global CLI install. Keep its verified npm prefix, reject linked/source installs and leave desktop-managed daemons to the desktop updater. DEB/RPM, extracted desktop bundles, Docker and Nix installations need their own installation method; this action does not migrate them or request elevated permissions.

## Prepare and verify a release

### Integrate and prepare the candidate

Integrate the pinned upstream release in the isolated checkout. Preserve the unique behavior above; remove only patches proven redundant. A merge is acceptable: v0.13.2 used an upstream merge and normal fast-forward publication to fork `main`. Inspect the final fork-versus-upstream diff, including added/deleted files and dependency patches.

Choose an unused fork version and check both local and remote tags. Previous releases used v0.12.1 for upstream v0.12.0 and v0.13.2 for upstream v0.13.1; v0.13.3 follows upstream v0.13.2. Check for collisions each time; neither an upstream tag nor an existing fork tag may be overwritten.

All workspaces and the bundled daemon must agree on the release version. Update the root package version, run `node scripts/sync-workspace-versions.mjs`, and regenerate/inspect workspace lockfile entries. Watch for nested registry copies shadowing the local workspaces after a version change. Reinstall and rebuild in the isolated checkout when needed. Do not repair stale generated declarations by adding duplicate source types.

Write fork release notes in `CHANGELOG.md` and the matching `CHANGELOG.zh-CN.md` entry. Follow [changelog translations](release.md#changelog-translations) for matching dates, headings and bullets. Run `npm run fdroid:changelogs` and its check. Keep English/Chinese download links pointed at this fork. Update `nix/npm-deps.hash` with `./scripts/update-nix.sh` when the lockfile changes; retain the pinned Nixpkgs source.

### Local gates

Use the installed Node/npm versions required by the current workflows and lockfile; v0.13.2 CI uses Node 22. Install with `npm ci` in the isolated checkout so all checked-in dependency patches apply. Build owning workspace declarations before interpreting cross-package type errors:

```bash
npm run build:server
npm run build:app-deps
npm run typecheck
npm run lint
npm run format
npm run format:check
npm run fdroid:changelogs:check
./scripts/update-nix.sh --check
git diff --exit-code -- package-lock.json nix/npm-deps.hash
```

The last command checks that the Nix check did not leave unexpected lock/hash edits; run it after committing the intended regenerated files. `--check` can normalize lockfile entries, so inspect its diff even when the command succeeds.

The hash script requires Nix. If this host lacks it, use an authorized isolated Nix environment to regenerate a changed hash and the remote Nix workflows below to verify it. Do not install global tooling or skip the hash/build gates to make progress.

Run targeted existing suites for changed and retained paths. For example, from `packages/app`:

```bash
LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 npx vitest run src/utils/time.test.ts --bail=1
npx vitest run src/utils/markdown-math.test.ts --bail=1
npx vitest run src/assistant-selection-copy/content.test.ts --bail=1
```

From `packages/server`, select the existing ACP, Claude, Codex and push files listed in the inventory using `npx vitest run <file> --bail=1`. Exercise the existing browser math/copy coverage when the renderer changes. Add regressions to existing suites for adaptations. Record commands, exit codes, candidate SHA and any platform/device checks not performed.

**Do not run the full test suite locally.** Full suites run in GitHub CI. Do not weaken tests, bypass a required check or treat a clean merge as verification.

### Full CI and Nix before the release push

Commit the verified candidate when authorized and push an **untagged temporary candidate branch**. This makes remote checks possible before the release-triggering `main`/tag push. Run the full workflows on that branch:

```bash
CANDIDATE_BRANCH=paseo/release-candidate
gh workflow run ci.yml -R derrickzhde/paseo --ref "${CANDIDATE_BRANCH:?}"
gh workflow run nix.yml -R derrickzhde/paseo --ref "${CANDIDATE_BRANCH:?}"
gh workflow run nix-update-hash.yml -R derrickzhde/paseo --ref "${CANDIDATE_BRANCH:?}"
gh run list -R derrickzhde/paseo --branch "${CANDIDATE_BRANCH:?}"
```

Set the branch name to the actual pushed candidate. Verify each run's `headSha` equals the candidate commit and wait for completion. Manual CI runs the full matrix; a filtered PR run is insufficient. Require Linux/Windows/macOS CI, browser shards, Linux Nix package/daemon/web/terminal smoke checks, Linux/macOS Nix desktop builds and the committed dependency-hash check. Use the current workflows as the required job list.

Any content change invalidates affected evidence; rerun the necessary checks on the new commit. Investigate failures and record an unchanged retry when justified by evidence. A failed required check remains a blocker until resolved. Independent review follows the active session's selection; report its absence accurately when no reviewer was selected.

### Push and monitor publication

Confirm operation-specific authorization for the release push, the clean candidate, its green checks, the intended remote and an unused `v<version>` tag pointing to that same commit. Publish `main` by normal fast-forward and the release tag, preferably in one atomic push. Do not force-push, recreate a published tag or silently pick a different source commit.

Use GitHub Actions for the fork release. **Do not run upstream `release:patch`, `release:minor`, `release:promote` or `release:publish` commands:** they publish `@getpaseo/*` npm packages. A documentation-only commit/push does not require a version bump or release tag.

| Workflow                    | Expected fork behavior                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Release             | Builds platform packages, uploads assets, assembles updater manifests and finalizes the GitHub release.                            |
| Release Notes Sync          | Synchronizes the version's fork changelog entry.                                                                                   |
| Docker                      | Builds this checkout's packages; a stable `v*` tag publishes version and `latest` images. A `main` push runs build/check behavior. |
| CI / Nix / Nix Update Hash  | Run applicable post-push verification; fork hash checking must not require the upstream GitHub App credentials.                    |
| Android APK Release         | GitHub APK release jobs are skipped on this fork. EAS distribution is separate.                                                    |
| Deploy App / Deploy Website | Build on the fork; Cloudflare deployment steps are restricted to upstream.                                                         |

Watch runs to completion rather than stopping at a successful push. A draft is not a published release. If tag lookup does not find an in-progress draft, use the existing helper, which understands GitHub's `untagged-*` draft URLs:

```bash
node scripts/github-release.mjs --repo derrickzhde/paseo --tag v0.13.3
```

Substitute the new tag. Let the desktop finalizer assemble and validate the platform manifests before publishing; do not manually expose an incomplete draft. Diagnose signing/notarization failures from the actual error and resume the failed jobs when resolved. Publishing does not authorize updating installed apps or restarting their daemons.

## Troubleshooting

- **Typecheck reports missing cross-workspace fields:** rebuild the owning stack and verify local workspace resolution before changing source types. See [development](development.md).
- **A dependency patch stops applying:** compare it with the newly installed library, retain still-unique behavior and regenerate the patch. Verify a clean install applies it; do not bypass the patch or count missing native/device checks as passing.
- **Required CI, Nix or publication fails:** inspect the failed job at the recorded SHA and use the recovery steps above. Fix and reverify affected inputs, or report the unresolved blocker. Keep a failed release in draft until its required assets and manifests are complete.

## Verify publication and hand off

1. Verify remote `main` and the peeled release tag point to the checked commit. Confirm the GitHub release is public, has the intended version/notes and stable/prerelease status, and is selected as latest when intended.
2. Check every expected platform asset against the desktop workflow's current artifact list: names, nonzero sizes and checksums where available. Include the [fork CLI archive](#remote-host-self-update), its GitHub SHA256 digest and an isolated-prefix installation smoke check. v0.13.2 published 23 assets; derive the next release's expectations from the workflow rather than assuming that count.
3. Download `latest.yml`, `latest-mac.yml` and `latest-linux.yml`. Verify version, referenced filenames, asset sizes, SHA512 values and rollout fields. Confirm the updater destination stays `derrickzhde/paseo`. These manifests are produced and uploaded by the release finalizer; if missing or wrong, repair/resume the pipeline and verify again.
4. Inspect `ghcr.io/derrickzhde/paseo:<version>` and, for a stable release, `:latest`. Verify the intended tags reference the same published image digest and include `linux/amd64` and `linux/arm64`. Use the existing Docker workflow for any authorized repair; do not substitute an upstream image.
5. Record the upstream/fork SHAs, dropped/retained/adapted patches, check/run IDs, release URL, asset/manifest verification, image digest and limitations. Refresh this guide's baseline and inventory. Preserve recovery evidence, then reclaim only task-owned agents, candidate branches and worktrees after their output is integrated and no process uses them.

Release completion includes the assets, updater manifests and Docker tags. Report incomplete publication explicitly; do not claim success from the tag push alone.
