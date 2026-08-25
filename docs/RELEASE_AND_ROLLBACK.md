# Release and recovery

This project separates source acceptance from production publishing. A merged
commit is not automatically deployed.

## Standard release

1. A contributor opens a focused pull request to `main`.
2. CI validates dependencies, types, lint, the production build, the full test
   suite, the rendered Worker, and diff cleanliness.
3. The owner reviews the change, its screenshots, risk, data effects, and
   recovery plan.
4. The accepted revision is merged and identified by its exact commit.
5. The release maintainer repeats the required clean-source build and rendered
   checks when needed.
6. That exact revision is saved as an immutable ChatGPT Sites version and
   published.
7. The maintainer verifies the canonical domain, changed routes, responsive
   behavior, and the affected visitor or organizer journey.

Source releases use semantic tags such as `v1.0.0`. Tags identify known-good
source; Sites versions identify known-good deployable artifacts.

## Recovering from a bad source change

Do not force-push or rewrite shared history. Create a new branch from current
`main`, use `git revert` for the faulty commit or merge, run the normal checks,
and submit the correction through a pull request. This preserves an auditable
record of both the failure and recovery.

## Recovering production

For a presentation-only or runtime regression, the owner may redeploy the most
recent verified Sites version while a source correction is reviewed. Confirm
the canonical domain after the rollback and record which source commit and
Sites version are active.

Database migrations are additive and may contain later valid data. Do not
reverse a released migration casually. Prefer a forward repair reviewed with
schema, invariant, query-budget, and integration coverage.

## What Git does and does not protect

Git history, the `v1.0.0` tag, the GitHub Release, and the owner's offline Git
bundle preserve source code and its history. They do not back up hosted D1 or
R2 data, form submissions, environment values, domains, or third-party
accounts. Those remain under separate owner-controlled operational procedures.
