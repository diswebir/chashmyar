# GitHub Actions and automatic releases

[README](../README.en.md) · [Development and testing](DEVELOPMENT.md) · [Persian quickstart](GITHUB_QUICKSTART_FA.md) · [Full Persian release guide](RELEASE_GUIDE_FA.md)

This repository is configured to build and publish Windows x64 releases from `main`. The previous workflow published 2.4.8 successfully; this new 2.4.9 source and its CI changes have not yet run in the owner's GitHub repository. A successful automated run is not evidence that installer behavior, WebView2 interaction, audio, keyboard hooks, gamma, capture or the tray were manually validated on Windows. The [Persian fix guide](../FIX_2.4.8_FA.md) explains the 2.4.7 portable defect and replacement.

> **Publication is automatic.** A successful push or merge to `main` can create a public Release without a human approval gate. Review changes and perform appropriate native Windows tests before merging when practical; otherwise change the workflow's policy before pushing.

## One-time repository setup

1. The updater is pinned to **`diswebir/chashmyar`**. Clone the existing repository and preserve its history and tags; do not force-push. To use a different repository you must deliberately change the fixed endpoint, download-URL policy, release link and related tests. Extract and copy all source files, including `.github/`, `.gitignore`, lockfiles, `assets/branding/` and the entire licensed `src-tauri/vendor/tao/`. Do not commit `release/`, build output or keys.
2. Enable GitHub Actions and the pinned actions. The publication job requests `contents: write`; repository policy and tag rulesets must allow `github-actions[bot]` to create tags and releases. Do not store a personal access token in source.
3. **Before pushing**, create or recover your Tauri updater signing key as explained in the [Persian step-by-step guide](UPDATER_SIGNING_FA.md). Generate a key only once, outside the repository on a trusted machine; back up the private key and password securely. The source bundle includes no production key. Store the following under **Settings → Secrets and variables → Actions**:

| Setting | Name | Value |
|---|---|---|
| Repository secret | `TAURI_SIGNING_PRIVATE_KEY` | Entire private-key file contents, not its path |
| Repository secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password, if one was set |
| Repository variable | `CHASHMYAR_UPDATER_PUBLIC_KEY` | Entire matching `.pub` file contents, not its path |

No private key is needed by the publication job. Missing or mismatched keys prevent release. Protect `main`, review trusted build scripts and restrict repository access: code executing with a secret can exfiltrate it. Never print, commit, upload or paste the private key in support requests. Keep the same key across releases; changing it breaks automatic updates for already installed versions and requires a trusted manual migration.

4. Review the copy using `git status --short`, commit, and push to `main` using normal credentials. See the [Persian quickstart](GITHUB_QUICKSTART_FA.md) for clone and push commands. Public downloads require a public repository. The Actions queue, permissions and runner availability can still prevent release.

## What runs

| Workflow | Trigger | Scope |
|---|---|---|
| `.github/workflows/ci.yml` | Push to `main`, pull request, manual dispatch | Ubuntu: frontend, Rust, release-tool and browser/mock suites in one job; mandatory license inventory in a separate read-only job. A PR with stale notices may receive a reviewable candidate artifact but still fails until corrected. Repository permission is read-only. |
| `.github/workflows/release.yml` | Push to `main`, manual dispatch on `main` | Serial prepare → Windows x64 build/tests → publish. The independent CI workflow is **not** a dependency of publication; release runs its own checks. |

The release planner checks the exact source commit and existing stable tags. The Windows job verifies the full version-file contents against the source, stamps the resulting tree, runs checks, creates the NSIS installer and portable executable, verifies the tree and stages the release files. Before upload, it extracts the staged NSIS application and independently executes its headless Tauri-context audit and the portable audit; both must match the built frontend's complete asset hashes, configured updater key, version, flavor and production protocol. This does not start WebView2 or test interactive GUI behavior. The separate publish job downloads that build artifact, creates the matching annotated tag and a temporary draft, uploads eight assets without overwriting existing ones, verifies both signed updater payloads and their versions, and checks GitHub-reported SHA-256 digests. It refreshes tags before publication, explicitly marks the verified release as Latest, and checks the GitHub Latest API with bounded retries. External/manual writers can still race that final check; restrict and coordinate them. If Latest confirmation fails, the release may already be public: inspect it rather than publishing again blindly. The workflow artifact is retained for 14 days. Only the publish job requests write access; action references are pinned to commit SHAs.

`queue: max` allows up to 100 pending runs in the concurrency group. GitHub may cancel additional runs, and pending order is not a guarantee of commit order. A source superseded by a newer automatic release is skipped rather than published out of order. Force-pushes, tag conflicts, failed tests, missing digests, permissions and network failures may also prevent a Release. Therefore every push **requests** a release, but not every push is guaranteed to become one.

## Versions and assets

The source baseline is `2.4.9`. If the greatest stable tag is still `v2.4.8`, the next successful push publishes `v2.4.9`; a subsequent successful source commit normally produces `v2.4.10`. If a stable tag equals or exceeds the baseline, the planner allocates the next patch after the greatest stable tag and never overwrites it. Stable numeric versions are supported, with each Windows version component at most `65535`; after an occupied maximum patch, advance the major/minor baseline.

`main` is not version-bumped by the workflow. The release tag points to a version-only child of the triggering source commit; its npm and Rust manifests/lockfiles and Tauri config match the released binaries. Thus `package.json` on `main` is not a reliable way to identify the latest Release. A normal push needs no manually created tag or Publish click. `CHANGELOG.md` is maintained by humans.

A published Release should contain exactly these eight uploaded assets; GitHub also supplies source-code archives separately:

```text
ChashmYar_<version>_x64-setup.exe
ChashmYar-<version>-portable.exe
ChashmYar_<version>_x64-setup.exe.sig
ChashmYar-<version>-portable.exe.sig
latest.json
SHA256SUMS.txt
LICENSE
THIRD_PARTY_NOTICES.txt
```

Check Actions → **Automatic Windows release**, then Releases: the intended release must have the Latest badge and its `latest.json` must be reachable at `https://github.com/diswebir/chashmyar/releases/latest/download/latest.json`. Verify the downloaded files using `Get-FileHash` and the matching lines of `SHA256SUMS.txt`. A hash compares a file with its manifest, not the identity of its publisher. Tauri updater signatures are not an Authenticode publisher certificate; without a separate certificate Windows can still warn via SmartScreen. WebView2 is required. Previously supplied 2.4.3 executables predate the new logo; only a new build from this source can contain it.

Clients without this updater and embedded public key must first be upgraded manually from a trusted release. Later versions check and download automatically; installation and restart require explicit confirmation. Test both installed and portable updates across two releases on real Windows, including settings, write failures and rollback. The automated checks are not a substitute for that interactive test.

## Failure and recovery

- **No Release / permission denied:** inspect all three jobs, enable Actions and permitted actions, verify `contents: write`, organization policy, tag rulesets and runner availability. Private repositories do not provide public downloads.
- **Missing signing key, wrong password or mismatch:** verify repository secret/variable names and key pair; do not print secret values. A changed public key breaks existing clients unless they are migrated manually.
- **Failed publication:** before publishing a newer source, try **Re-run failed jobs** on the failed run so it can reuse that run's original build artifact while retained. A complete rebuild can yield different binary hashes; a conflicting draft is deliberately not overwritten.
- **Draft, tag or digest mismatch:** inspect the exact job log, remote tag, existing draft and its ownership. Do not blindly publish a draft, retarget a tag or overwrite an existing public asset. Missing or mismatched GitHub digests prevent automatic publication.
- **Failure after the publication request:** the remote Release may already be public even if the final verification failed. Check its actual status, tag and hashes before taking action.
- **Old run skipped / queue overflow:** the release may have been superseded or canceled. Inspect Actions and, if needed, push a new reviewed commit containing the intended changes.
- **Action, dependency or network error:** review logs; `npm ci`, Cargo lock checks, `npm audit`, NSIS downloads, notices and Playwright can require network access. Retry only when the underlying issue is understood.

Rerunning an already published source verifies the existing release rather than silently replacing it or creating a new version for the same commit. Manual dispatch on `main` is available for recovery. For major/minor baseline changes, maintainer-only version commands and the native Windows acceptance checklist, see the [full Persian release guide](RELEASE_GUIDE_FA.md) and [development guide](DEVELOPMENT.md).

Official references: [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository), [workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [GITHUB_TOKEN permissions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication), and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
