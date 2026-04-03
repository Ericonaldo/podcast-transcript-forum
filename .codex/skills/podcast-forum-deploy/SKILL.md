---
name: podcast-forum-deploy
description: Use when deploying this repo to the public server, building the frontend safely from the main repo, syncing dist files to newserver, restarting the Node server, or verifying the deployed PodScribe site after code changes.
---

# Podcast Forum Deploy

Use this skill for repo-specific deployment and release work.

## When to use

- The user asks to deploy to `newserver`.
- The task mentions public server verification.
- The task involves rebuilding the frontend after worktree changes.
- The task requires restarting the Node service on port `4010`.

## Non-negotiable rule

Do not build in a worktree. Build from the main repo at `/home/mhliu/podcast-transcript-forum`.

## Deploy sequence

1. Commit the work on the task branch.
2. Sync with `origin/main`.
3. Push the task branch into `main` if that is the chosen repo workflow.
4. In the main repo, pull latest code.
5. Build frontend locally from `client/` with Vite.
6. `rsync` `client/dist/` to `newserver:/home/prod/podcast-forum/client/dist/`.
7. If server code changed, pull on the server repo too.
8. Restart the server process serving port `4010`.
9. Verify with `curl` on the server and, when relevant, browser checks.

Read [references/deploy-sop.md](references/deploy-sop.md) for the exact commands and pitfalls.

## Pitfalls

- Server Node is v20, so `vite build` must happen locally where Node is new enough.
- `express.static` serves `index.html` with `no-cache`, so refresh should pick up new builds.
- Do not mix worktree build artifacts with the main repo build output.
