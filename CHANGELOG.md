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
- Base commit: `6150620`.

### Post-handoff correction

- Independent audit found the initial job payload had only an action ID and did not carry the required synthetic everyday-life content.
- Added validated `KEBIASAAN_DIGITAL` / `OBSERVASI_PENDEK` editorial payload from API through pg-boss to worker result.
- Updated dashboard wording and smoke assertions to verify the real editorial sample.
- Re-ran lint, typecheck, 4 tests, build, audit, Docker smoke, browser UI flow, and persistence verification.
- Verified runtime correction commit: `d7a1310`.
