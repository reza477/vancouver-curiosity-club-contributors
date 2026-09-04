# Contributor preview workflow

Contributors can edit a focused branch and see the result without receiving
production access. The recommended online workspace is a GitHub Codespace. A
normal local checkout remains available for developers who prefer
their own editor.

Neither preview path can deploy the website. Preview data, media, identity, and
email delivery are isolated from production.

## Browser preview with GitHub Codespaces

If you are not a repository collaborator, select **Fork** first so you have a
place to push your branch. Then:

1. Open your contributor repository or fork and select **Code**, then
   **Codespaces**.
2. Create a codespace from the current `main` branch and wait for setup to
   finish. The setup installs the locked dependencies and prepares a disposable
   local D1 database.
3. In the terminal, create a focused branch:

   ```bash
   git switch -c design/your-name-short-task
   ```

4. Start the preview on its fixed port:

   ```bash
   npm run dev -- --port 5173 --strictPort
   ```

5. GitHub should open **VCC private preview** in a browser tab. If it does not,
   open the **Ports** panel and select **Open in Browser** for port `5173`.
6. Keep the port private. Do not change it to public visibility.
7. Commit and push only the focused branch, then open a pull request against
   `reza477/vancouver-curiosity-club-contributors:main`. Include phone and
   desktop screenshots and leave the pull request unmerged.

Codespaces usage belongs to the contributor's GitHub account and uses that
account's included allowance or billing. Stop the codespace when work pauses
and delete it after the branch is safely pushed.

## Local computer preview

Use Node.js 22.16 or newer:

```bash
npm ci
npm run db:apply:preview
git switch -c design/your-name-short-task
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`.

## What the preview contains

- The complete public source, approved bundled artwork, and responsive styles.
- A fresh local D1 database containing schema but no production records.
- An empty local R2 binding rather than production media.
- No production credentials, submissions, email delivery, or organizer
  identity.

Empty event states are therefore expected. Use the public website only as a
side-by-side content reference; never copy production databases, private form
submissions, hosted secrets, or attendee information into a preview.

## Owner approval boundary

Contributors may edit branches, run previews, push branches, and open pull
requests. They must not merge their own pull requests or attempt a deployment.

The owner may ask Codex to inspect and test a pull request without authorizing
any change. Review is not approval. Nothing is promoted to the owner-only
production repository or deployed until the owner explicitly approves the
exact pull request or commit and explicitly authorizes deployment.

Before requesting review, follow [CONTRIBUTING.md](../CONTRIBUTING.md) and the
[UI/UX handoff](UI_UX_HANDOFF.md).
