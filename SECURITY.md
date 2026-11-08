# Security policy

## Supported releases

The maintainer intends to review security issues against the latest published stable release and the current default branch. This is not a guarantee of a particular response time or a backport commitment.

## Reporting a vulnerability

Please **do not** post exploit details, credentials or personal data in a public issue. If the repository owner has enabled GitHub private vulnerability reporting, open the repository's **Security → Advisories → Report a vulnerability** form. If that option is not available, ask the maintainer for a private reporting channel without including vulnerability details in a public issue.

Include the affected version, a concise reproduction, impact, platform and a safe proof of concept. Remove usernames, tokens and private paths from logs. The maintainer should acknowledge and coordinate a fix before public disclosure when possible.

## Maintainer setup and boundaries

- Enable private vulnerability reporting in repository security settings if available.
- Pull-request CI has read-only repository permissions. Only the release-draft job requests `contents: write`; it uses GitHub's short-lived token and refuses to overwrite published releases.
- GitHub Actions references are pinned to commit SHAs; Dependabot proposes updates. Review changes before merging.
- Never commit signing keys, personal access tokens or real user data. Default release executables are unsigned and must be tested and reviewed by a human before publication.
- Strict break mode, keyboard hooks and display/gamma manipulation require particular care. This software cannot block Windows secure attention sequences.
