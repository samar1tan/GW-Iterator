# GW-Iterator first local version

GW-Iterator (GWI) is an explainable, supervisable interface around Codex goals. A user submits an outcome; Codex advances it while GWI makes the evidence, actions, results, costs and next decision inspectable. GitWorld (GW) is its first project; GWI itself is its second project. Roles, workflows and knowledge are resources for advancing a goal, rather than a system users must configure before asking for work.

## Outcomes and scope

GitWorld v0.1 exposed five problems: expensive long cycles, cross-boundary regressions, fragmented product decisions, stale delivery artifacts and inadequate evidence of independent learning. GWI must help resolve these through bounded tasks and inspectable outcomes, rather than a larger checklist or a board with simulated agents.

The first version runs locally. It supports product iteration and shorter role workflows: team lead, project manager, product manager, interaction/visual design, development, QA and technical writing/project operations. A human or coordinating agent can start a workflow; an explicitly enabled loop can continue it within its configured limits. An observed website mismatch can start operations without restarting the product roadmap.

This iteration includes focused tests and lightweight replays of selected public GW incidents. It does not reopen GW v0.1, promise production hardening, automatically publish user material, or require full GW acceptance. Implemented capability and observed results are reported separately.

## Navigation

The root is a **project overview**, with GW and GWI as distinct project entries. Each project has **Pipelines**, **Knowledge** and **Configuration**, organized by the project's roles. Runs are inspected within Pipelines; their dependencies, attempts, output, review and audit events stay attached to the selected project. Returning to Projects changes the project scope deliberately.

## Configuration and interfaces

- Project configuration includes identity, workspace/repository bindings, knowledge sources and role profiles. Actual values are private runtime data.
- Role profiles include instructions, optional model/effort, selected installed skills, available GWI control tools and execution boundaries. The adapter must distinguish its own enforced tool scope from Codex's native tool/sandbox behavior.
- Pipeline definitions contain stages, roles, executors, dependencies, prompts, review requirements and bounded execution policy. They are editable through the UI and authenticated local API.
- Published configuration revisions are immutable; updates use an expected revision and produce audit events. Runs freeze their project, role and pipeline basis. Changes must not silently rewrite running or past work.
- Both UI and agent clients use the same API and state transitions. A local CLI/control skill documents Codex access. Secrets are read from a private token file, never embedded in source or command examples.

## Execution and dependencies

A run records its trigger, goal, baseline, parent/dependent runs, configuration snapshot and evidence. Stage dependencies form a DAG; missing dependencies and cycles are rejected. A stage can execute Codex work, a human/review task, a GitHub Actions observation/dispatch or a subordinate pipeline. Cross-pipeline work remains visible through linked runs.

States distinguish queued, running, waiting for review/dependency, completed, failed, cancelled and interrupted work. A review can accept output or request a bounded revision; earlier attempts and comments remain inspectable. Review is a meaningful decision, not a timer that turns a card green. The coordinator can steer or interrupt an actual running Codex turn.

Explicit limits cover attempts, iterations, elapsed time and concurrency. An automatic loop uses the same execution path as a manual run; it must have a finite limit and a visible stop condition. Identical idempotency keys cannot start duplicate runs. Interrupted external work is reported truthfully and is not blindly rerun after a server restart.

Execution token budgets count uncached input plus output when Codex reports cached input; absent that breakdown, use the reported gross total conservatively. Preserve gross input/output/total and cached input as separate evidence. Repeated cached context must not exhaust a small task budget at startup. This token meter does not estimate a currency cost. The native goal's own reported meter remains separately identifiable.

## Codex and GitHub integration

Keep execution behind an adapter. Evaluate Multica's headless backend/daemon before adding commodity infrastructure; project, agent, skill and task management are reuse candidates. GWI still owns its fixed run basis, strict dependencies, knowledge and acceptance evidence. Source review is not live integration evidence. See [the backend assessment](architecture/multica-reuse.md).

Use the installed Codex app-server over local stdio JSON-RPC. Discover available models and skills. Start threads/turns with the project workspace and selected role settings, stream actual progress, track thread/turn identifiers and reported token usage, and support steering/interruption. Existing authentication remains managed by Codex. GWI does not copy credentials or change global Codex preferences.

Project-scoped GWI tools allow a Codex task to read workflow/knowledge context, submit observations and propose or update authorized pipeline configuration. Human and top-level agents can also use the local API/CLI. This provides both directions: GWI supervises Codex; Codex can adjust GWI through documented interfaces.

GitHub uses the installed `gh` session. Observe actual workflow runs/checks and their links; dispatch only an explicitly selected configured workflow. Queued/running checks are not successes. First-version live verification can use read-only observation; it does not require another GW deployment.

## General request entry

Within a project, submit a natural-language goal without first choosing a role or pipeline. A bounded, read-only Codex supervision turn observes results and chooses the next useful actions. It can invoke multiple complementary workflows, then observe their outcomes before another short decision cycle. A DAG describes a deterministic local workflow, not the complete goal or the limits of agent coordination. Decisions are model-driven, not keyword matching. Preserve the request, each decision, delegated runs and actual results across restarts. The supervisor cannot grant permissions or invent executable workflows. Record concise reasons and expected benefit, not private chains of thought.

Completion requires accepted delegated outcomes and a final decision grounded in evidence. Bound decision rounds, parallel actions, total reported tokens and elapsed time across the goal's descendants. Stop with an explicit reason when the boundary or expected useful gain is exhausted. Report unavailable usage separately; token updates can arrive after work has already consumed resources. Ambiguity produces a concrete clarification. Starts and decisions are idempotent; reject out-of-project choices. Dispatch means work started, not that the goal was achieved. Native goal state is reused where verified; its status is distinguished from GWI's workflow/acceptance status.

The first real acceptance case is GitWorld's public website English/Simplified Chinese content mismatch. Submit it through this entry, use the Chinese page's useful case-led organization as the reference, route to project operations, have Codex prepare the correction, independently check content parity and switching, and record the actual PR/deployment and live result. Do not reopen unrelated desktop scope or call an undeployed change a published fix.

## Project knowledge behavior

Knowledge is project-owned and role-organized. Sources include selected project documents, artifact descriptions, relevant agent memory and run findings. Each entry retains source kind/path/reference, source hash/revision, role tags, retrieval/sync time and content. Knowledge content stays local.

Users configure explicit source paths/roots; indexing does not vacuum a home directory or all agent history. Agent-memory imports can select a named section, so a shared memory registry does not import unrelated personal information. Reject credential/configuration files, unsupported binaries and oversized inputs. Follow real paths and declared source boundaries.

The UI supports source registration, synchronization, role/type filtering, search, reading and source provenance. Unchanged content retains its identity; changed sources create updated knowledge revisions. Missing files and stale/sync errors are visible. Selected knowledge snapshots become a run's context and are cited in its audit record; a later sync must not change the context used by a past run.

Run lessons and review findings can be stored as knowledge. A proposed process improvement retains its source run and rationale and can become a new pipeline revision through the same authorized configuration API. GWI's own project can use this flow without a special self-modifying backdoor.

## Privacy and persistence

Keep real project/pipeline/role configuration, indexed documents/memory, workspace paths, transcripts, audit exports and tokens outside publication candidates. The public repository contains implementation, schemas, sanitized documentation, original synthetic tests and dependency/build/CI manifests. No actual project configuration is uploaded.

Use a persistent local store with atomic transitions and append-only audit events. Bind HTTP to loopback, enforce expected Host/Origin and authentication for private API access. Scope dynamic agent tools to the originating project and selected permissions. Sanitize errors and do not report unavailable usage as zero or fabricate dollar costs.

## Focused acceptance

1. Start the local app and enter either project from the project list. Operate project Pipelines, Knowledge and Configuration without losing scope.
2. Edit role/pipeline configuration through UI and API, reject a stale revision and a cyclic pipeline, and show an existing run's unchanged snapshot.
3. Execute a real short Codex task, observe streamed events and completion; exercise bounded interruption/steering where feasible. Show reported usage or an explicit unavailable state.
4. Observe a real GitHub CI run. Exercise adapter failure/queued behavior with synthetic tests rather than changing an unrelated GW release.
5. Complete manual trigger, dependency, review/revision and bounded-loop paths, including linked pipeline runs and restart persistence.
6. Register/sync project documents and a scoped memory source; search by role, inspect provenance, and verify that a prior run retains its knowledge snapshot.
7. Use the same APIs for GW and GWI; demonstrate a GWI process/configuration improvement with a recorded before/after revision.
8. Replay selected GW operations/regression cases with their public sources and clearly distinguish replay results from historical execution or fresh GW acceptance.
9. Verify only the public implementation candidate is committed. Real configuration, private knowledge, paths, transcripts, captures and tokens remain local.
10. Submit the real website discrepancy without choosing a workflow. Inspect Codex's decision, follow the linked run and review, and distinguish implemented, published and live-verified states.
