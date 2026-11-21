# Changelog

## Phase 0 — 2026-11-21

### Added

- npm workspaces and pinned `package-lock.json`.
- React/Vite Indonesian DEMO dashboard and Nginx same-origin proxy.
- Fastify health, create, status, and history endpoints.
- pg-boss worker with atomic/idempotent processing.
- Zod contracts and shared PostgreSQL repository/migration.
- Four-service Docker Compose stack with healthchecks and persistent volume.
- Unit/behavior tests and Docker smoke script.
- README, architecture, roadmap, testing, state, task, phase, changelog, and detailed worklog documents.

### Verification

- Lint/typecheck/build/test passed.
- npm audit reported zero vulnerabilities after dependency updates.
- Docker E2E after final local-only bind completed action `7c7778b6-ef42-46fd-9e41-fa6331645cc0`.
- Same action remained completed and in history after stack recreation without volume deletion.

### Commit

- Focused commit message: `Phase 0: fondasi dan alur simulasi end-to-end`.
