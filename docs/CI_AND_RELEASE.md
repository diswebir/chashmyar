# GitHub Actions and automatic releases

[README](../README.en.md) · [Development and testing](DEVELOPMENT.md) · [Persian quickstart](GITHUB_QUICKSTART_FA.md) · [Full Persian release guide](RELEASE_GUIDE_FA.md)

This repository is configured to build and publish Windows x64 releases from `main`. The workflow has been tested with offline simulations, **not yet in the owner's real GitHub repository**. A successful automated run is not evidence that installer behavior, audio, keyboard hooks, gamma, capture or the tray were manually validated on Windows.

> **Publication is automatic.** A successful push or merge to `main` can create a public Release without a human approval gate. Review changes and perform appropriate native Windows tests before merging when practical; otherwise change the workflow's policy before pushing.

## One-time repository setup

1. Extract the complete source bundle and create a new, empty GitHub repository. Choose **Public** if everyone should be able to download its Releases. A Private repository's Releases remain access-restricted. Do not initialize the empty repository with a second README or license.
2. Retain hidden files, especially `.github/workflows/`, `.gitignore` and `.gitattributes`. Commit the npm/Cargo lockfiles, tests, `assets/branding/`, and all of `src-tauri/vendor/tao/` including its license and patch notice. Do not commit `node_modules/`, `dist/`, Rust `target/`, local `release/`, secrets or signing certificates.
3. In repository settings, allow GitHub Actions and the pinned actions used by the workflows. The publication job requests `contents: write`; repository/organization policy and tag rulesets must permit `github-actions[bot]` to create tags and Releases. The workflow uses the short-lived `GITHUB_TOKEN`; do not add a personal token to source or workflow files. Account runner availability, usage limits or organizational restrictions can still stop the run.
4. In a shell at the project root, initialize the empty repository, review and push. Replace the placeholders with your own owner and repository:

```sh
git init -b main
git add .
git status --short
git ls-files -- .github/workflows/ci.yml .github/workflows/release.yml package-lock.json src-tauri/Cargo.lock src-tauri/vendor/tao/CHASHMYAR_PATCH.md src-tauri/icons/icon.ico
git commit -m "Prepare ChashmYar source"
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

Authenticate with your normal Git credential manager or GitHub Desktop; a personal access token used to push workflow files may require the relevant workflow permission. If a repository already has history, clone and integrate changes with that history instead of force-pushing a new root.

## What runs

| Workflow | Trigger | Scope |
|---|---|---|
| `.github/workflows/ci.yml` | Push to `main`, pull request, manual dispatch | Ubuntu: frontend build; version, branding and local-doc-link checks; Rust policy/compatibility; offline release simulation; notices; browser/mock suites. Repository permission is read-only. |
| `.github/workflows/release.yml` | Push to `main`, manual dispatch on `main` | Serial prepare → Windows x64 build/tests → publish. The independent CI workflow is **not** a dependency of publication; release runs its own checks. |

The release planner checks the exact source commit and existing stable tags. The Windows job stamps a versioned tree, runs checks, creates the NSIS installer and portable executable, verifies the tree and stages the release files. The separate publish job downloads that build artifact, creates the matching annotated tag and a temporary draft, uploads five assets without overwriting existing ones, and checks GitHub-reported SHA-256 digests before publishing. The workflow artifact is retained for 14 days. Only the publish job requests write access; action references are pinned to commit SHAs.

`queue: max` allows up to 100 pending runs in the concurrency group. GitHub may cancel additional runs, and pending order is not a guarantee of commit order. A source superseded by a newer automatic release is skipped rather than published out of order. Force-pushes, tag conflicts, failed tests, missing digests, permissions and network failures may also prevent a Release. Therefore every push **requests** a release, but not every push is guaranteed to become one.

## Versions and assets

The source baseline is `2.4.3`. In a new repository with no higher stable tags, a successful first push normally publishes `v2.4.4`; a subsequent successful source commit normally produces `v2.4.5`. The planner chooses the next patch after the greater of the source baseline and existing stable tags. Stable numeric versions are supported, with each Windows version component at most `65535`.

`main` is not version-bumped by the workflow. The release tag points to a version-only child of the triggering source commit; its npm and Rust manifests/lockfiles and Tauri config match the released binaries. Thus `package.json` on `main` is not a reliable way to identify the latest Release. A normal push needs no manually created tag or Publish click. `CHANGELOG.md` is maintained by humans.

A published Release should contain exactly these five uploaded assets; GitHub also supplies source-code archives separately:

```text
ChashmYar_<version>_x64-setup.exe
ChashmYar-<version>-portable.exe
SHA256SUMS.txt
LICENSE
THIRD_PARTY_NOTICES.txt
```

Check Actions → **Automatic Windows release**, then Releases. Verify the downloaded files using `Get-FileHash` and the matching lines of `SHA256SUMS.txt`. A hash compares a file with its manifest, not the identity of its publisher. Default builds are unsigned, can trigger SmartScreen, and require WebView2. Previously supplied 2.4.3 executables predate the new logo; only a new build from this source can contain it.

## Failure and recovery

- **No Release / permission denied:** inspect all three jobs, enable Actions and permitted actions, verify `contents: write`, organization policy, tag rulesets and runner availability. Private repositories do not provide public downloads.
- **Failed publication:** before publishing a newer source, try **Re-run failed jobs** on the failed run so it can reuse that run's original build artifact while retained. A complete rebuild can yield different binary hashes; a conflicting draft is deliberately not overwritten.
- **Draft, tag or digest mismatch:** inspect the exact job log, remote tag, existing draft and its ownership. Do not blindly publish a draft, retarget a tag or overwrite an existing public asset. Missing or mismatched GitHub digests prevent automatic publication.
- **Failure after the publication request:** the remote Release may already be public even if the final verification failed. Check its actual status, tag and hashes before taking action.
- **Old run skipped / queue overflow:** the release may have been superseded or canceled. Inspect Actions and, if needed, push a new reviewed commit containing the intended changes.
- **Action, dependency or network error:** review logs; `npm ci`, Cargo lock checks, `npm audit`, NSIS downloads, notices and Playwright can require network access. Retry only when the underlying issue is understood.

Rerunning an already published source verifies the existing release rather than silently replacing it or creating a new version for the same commit. Manual dispatch on `main` is available for recovery. For major/minor baseline changes, maintainer-only version commands and the native Windows acceptance checklist, see the [full Persian release guide](RELEASE_GUIDE_FA.md) and [development guide](DEVELOPMENT.md).

Official references: [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository), [workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [GITHUB_TOKEN permissions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication), and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
