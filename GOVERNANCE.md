# Project governance

This repository supports the Vancouver Curiosity Club website. The source-rights
holder is identified in [LICENSE](LICENSE). This document defines how changes
are proposed, accepted, and released.

## Roles

### Owner and release maintainer

The repository owner, `@reza477`, controls contributor access, product scope,
merges, production data, hosted secrets, domains, and ChatGPT Sites releases.
The owner may authorize another release maintainer explicitly in writing.

### Contributors

Contributors work on focused branches and submit pull requests to `main`.
They may propose code, design, documentation, tests, or reviewed assets. They do
not receive production data, form submissions, secrets, or publishing access,
and they do not merge or deploy their own work.

### Continuous integration

GitHub Actions verifies proposed and merged source. CI is evidence, not release
authority: a passing workflow does not publish the website.

## Decision and review process

1. Agree on the intended outcome and boundaries.
2. Create a focused branch from current `main`.
3. Open a pull request using the repository template.
4. Resolve CI failures and review comments.
5. The owner accepts or rejects the proposal.
6. The owner or authorized release maintainer performs final validation and
   publishes the exact accepted revision.

Substantial architecture, data-model, authentication, source-sync, legal-copy,
or production-operation changes require explicit owner approval before work
begins. Visual improvements should preserve confirmed content, accessibility,
privacy, and public-event facts.

## Access and ownership

Repository access is limited to people currently contributing. Removing access
ends future repository access but cannot erase copies a contributor already
downloaded. The proprietary license remains in force; access alone does not
transfer ownership or grant reuse rights.

Security concerns follow [SECURITY.md](SECURITY.md). Conduct concerns follow
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
