# Multica backend reuse

Assessed on 2026-10-26 at `e8fdcfd226d238e6f1f22d5d95245936a795d9fd`. The latest release observed was `v0.7.0` (2026-10-23). Findings against this main-branch commit are not verified release capabilities. No upstream backend or daemon has been deployed in this assessment.

An independently written GWI frontend can use Multica without running its frontend. Prefer reusing project/agent/skill management and native task execution behind an adapter. GWI retains its iteration contract and knowledge layer. Do not run two native tasks for one stage or let two schedulers own the same transition.

For this local version, use Codex's native goal API for the reasoning/continuation loop and keep GWI's project context, action constraints and audit records around it. Multica remains a feasible execution-provider option; adopting its issue/daemon lifecycle now would add a second task authority and a PostgreSQL deployment before it replaces the required native-goal contract. This is a bounded first-version choice, not a claim that Multica cannot be used headlessly.

| Need | Reusable capability | GWI responsibility |
| --- | --- | --- |
| Project list and bindings | Projects and resource APIs | Private local mapping and project scope |
| Roles and tools | Agents, skills and MCP bindings | Role policy and truthful effective permissions |
| Codex execution | Daemon, task messages, status and cancellation | Stage linkage and outcome acceptance |
| Handoffs and triggers | Issue workflows, chat, Autopilots | Strict dependencies and finite loops |
| Knowledge | Repository/local directory resource references | Role indexing, provenance, revisions and frozen context |
| Audit | Issue snapshots and task/timeline records | Full project/role/pipeline/knowledge basis |

The inspected workflow is read at task-context creation and updates overwrite it. Next/back statuses are agent instructions; native task completion does not itself advance the issue. Upstream has real concurrency admission and retries, but a provider-network failure may expand its nominal retry ceiling. These are not substitutes for GWI's immutable basis, DAG or hard iteration limits.

The App API provides the needed resources. Stable Public API v1 currently covers a smaller issue/comment slice, so a headless client needs a pinned App API compatibility check. Tokens must stay server-side. Deployment needs the Go backend, PostgreSQL/pgvector and host CLI/daemon; the Next.js frontend can be omitted. Disable self-host telemetry explicitly for the private local deployment. The inspected macOS daemon chooses Codex `danger-full-access` as a network fallback: an adapter must address and report that effective boundary, rather than promise a read-only role it cannot enforce.

Multica's license adds conditions to Apache-2.0. Part I permits backend/daemon/CLI use without its UI branding requirement, while requiring documentation attribution and the upstream link. Internal use in one organization needs no commercial license; third-party hosting and commercial embedding have further restrictions. Keep separately installed Multica's complete license/notices distinct from original Apache-licensed GWI source.

Before selecting this provider, test an isolated deployment: create/read a project and agent, execute one bounded Codex task, inspect actual messages/outcome, cancel another task, and record the effective policy and exact version. The current direct Codex adapter remains available for the real website acceptance run; source research alone does not justify migrating live work.

Primary evidence:

- [License, Part I](https://github.com/multica-ai/multica/blob/e8fdcfd226d238e6f1f22d5d95245936a795d9fd/LICENSE).
- [Self-hosting](https://github.com/multica-ai/multica/blob/e8fdcfd226d238e6f1f22d5d95245936a795d9fd/SELF_HOSTING.md), [Compose](https://github.com/multica-ai/multica/blob/e8fdcfd226d238e6f1f22d5d95245936a795d9fd/docker-compose.selfhost.yml).
- [App routes](https://github.com/multica-ai/multica/blob/e8fdcfd226d238e6f1f22d5d95245936a795d9fd/server/cmd/server/router.go), [Public API ledger](https://github.com/multica-ai/multica/blob/e8fdcfd226d238e6f1f22d5d95245936a795d9fd/server/pkg/publicapi/v1/README.md).
- [Workflow behavior](https://multica.ai/docs/workflows), [claim-time workflow context](https://github.com/multica-ai/multica/blob/e8fdcfd226d238e6f1f22d5d95245936a795d9fd/server/internal/handler/issue_workflow_entry.go).
- [Task snapshots and retries](https://github.com/multica-ai/multica/blob/e8fdcfd226d238e6f1f22d5d95245936a795d9fd/server/internal/service/task.go).
- [Codex sandbox selection](https://github.com/multica-ai/multica/blob/e8fdcfd226d238e6f1f22d5d95245936a795d9fd/server/internal/daemon/execenv/codex_sandbox.go).
