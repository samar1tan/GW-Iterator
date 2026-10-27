# GW-Iterator: integrated iteration pipelines

Current interaction revision: [Human workbench](human-workbench-prd.md). It supersedes the earlier default-canvas, exposed-configuration and separate manual-top-up interactions. Historical execution/configuration bases remain intact.

Status: replacement product baseline. Technical integration exists, but product acceptance remains open. This supersedes the first version's form-and-log-centered experience; it is not a completion claim.

## Purpose and ordinary use

GWI is a local, all-in-one platform for advancing and supervising project work through configurable teams, pipelines and feedback loops. GitWorld is the first project; GWI itself is the second independent project. Humans and authorized agents can start work, understand progress, intervene, inspect delivery and improve later iterations through the same interfaces.

The product must reduce repeated prompting, ad hoc coordination, wasted model work and corrections. Counts, green execution states and logs cannot establish that outcome.

1. Connect a project by selecting its local location. Infer repository identity and relevant context; reuse connected agents or prepare a useful team. Do not require role prompts, model settings or JSON before first use.
2. State an outcome or run a reusable pipeline. Inherit project/team defaults and prepare scope, baseline and verification. Ask only for consequential information that is actually missing.
3. Follow live stages, owners, parallel work, dependencies, feedback paths, delivered artifacts and the next useful action. Explanations describe material decisions without exposing private reasoning traces.
4. Review or correct concrete work. Rejection returns the relevant finding to its owner. Human/CI waits preserve progress without paid reasoning polls.
5. Accept the requested outcome from evidence; retain relevant artifacts and verified findings for subsequent work. Implementation, verification, publication and product acceptance stay distinct.

Natural-language intake is one trigger. Codex is an execution capability. Neither becomes the entire product or forces short work through a long product-development workflow.

## Product surfaces

| Surface | User outcome |
| --- | --- |
| Projects | Choose where to work; see active outcomes, waiting decisions and delivery health. Projects are not hardcoded demo content. |
| Workbench | Understand current work, responsibility, blockers and pending decisions; start an outcome or known pipeline. |
| Pipelines | Create, compose, edit and publish reusable workflows; supervise and compare executions. |
| Team | Configure working roles and their actual agents, assignments, skills, tools, context, permissions and availability. |
| Knowledge | Find requirements, decisions, outputs, selected memory and verified lessons, including where they were used. |
| Settings | Deliberately change project bindings, defaults, integrations and policy. |

Project, goal, reusable pipeline, execution, role, agent and artifact are distinct identities with visible relationships. Every destination preserves project context.

## Teams and capabilities

Roles are configurable working contracts: responsibility, inputs, expected outputs, acceptance checks, capabilities and handoffs. Initial roles are reusable templates, not a fixed seven-role product limit. Bind them to real Multica agents/runtimes and actual installed capabilities; show availability and assignments truthfully.

Support creating, duplicating, changing, retiring and importing teams/roles. Project overrides inherit explicit defaults. Model/effort, skills/tools, approved knowledge and effective permissions remain inspectable but are not mandatory ordinary start fields. Historical work retains its original references and basis.

A role must be able to reference what it consumed and hand a concrete result to the next role. Changing a name or prompt alone does not demonstrate an operational team.

## Pipeline authoring and operation

- Provide a visual stage editor and contextual inspector. Add, arrange, connect, duplicate and remove stages; choose responsibility/action and define inputs, outputs, checks and handoff behavior. Structured import/export and API access complement ordinary GUI editing; JSON is not the only editor.
- Reuse editable templates for product iteration, focused implementation, independent review, project operations, CI/release and knowledge/process maintenance. Short work remains short.
  The focused-change starter uses implementation, independent QA and one delivery gate. A known bounded request must not require a second discovery stage or the full product-development sequence.
- Support ordered/parallel work, explicit dependencies, human gates, conditions, child pipelines and bounded return/rework paths. A stage DAG is a local execution structure, not the complete project-iteration model.
- Publish definition revisions; executions preserve their basis. New evidence can select a bounded next action or append a plan revision. Never silently rewrite completed work, previous decisions or evidence.
- Use one execution authority per task. Multica owns its agents/tasks/runners; GitHub owns CI/deployment facts; GWI owns recorded dependencies, loop policy, review and product acceptance. Do not let two schedulers advance the same task independently.
- Events release downstream work. Deduplicate triggers and retain exact external references. An observation error is not a remote execution failure or permission to dispatch again.
- Users can inspect real changes, approve/reject, attach targeted feedback, retry the failed scope, pause/resume, stop owned work and select an allowed model fallback. Never silently widen permissions or reset consumption.

## Loop engineering

A loop is a configurable operating contract: trigger/discovery, objective, durable state, permitted action, observation, verifier, adjustment, exit conditions and memory writeback. It is not repeated prompting or automatic whole-pipeline replay.

Distinguish worker correction loops, cross-role review/delivery loops and project/process-improvement loops. Link their results while keeping separate scopes and stop conditions. Choose the next action from new evidence, reuse accepted outputs, and invalidate only affected downstream work.

Independent checks must substantiate the requested outcome. A completion message, successful process or passing unit suite cannot replace configured product review or live evidence. Detect repeated actions and unchanged failures; stop or escalate when further work has no supported benefit. Record the useful next human action.

Bound concurrency, attempts, newly processed tokens and active execution time. Human/CI waits do not spend model tokens. Capacity recovery is finite and uses an allowed model pool; permission and task blockers are distinct. Reconcile authoritative work after restart before resuming; never blindly relaunch uncertain external operations.

When a finite run limit prevents further work, show the consumed allowance and the limiting scope: a pipeline run and its supervising outcome have separate ceilings. The owner can explicitly extend tokens, attempts or execution time for a stopped pipeline, with a note and revision check. Retain the original definition, prior limits, consumption and attempts; an extension neither starts work nor resets usage. Retry must reject exhausted limits before creating another attempt. Stopped gaps, human review and manual waiting must not become model-execution time when an old run is reopened.

Retain verified findings as project/role knowledge. Loop/team/pipeline improvements are reviewable revisions linked to their evidence; self-improvement cannot grant broader permissions or waive checks.

References: [loop-engineering practice](https://github.com/cobusgreyling/loop-engineering) and [the empirical study](https://arxiv.org/abs/2608.21884). These inform the design and do not prove GWI's loops effective.

## Integrations

Actually deploy and connect the Multica backend and execution facilities. Reuse project/agent/skill/task capabilities behind GWI's frontend and server-side adapter. Record the tested version and observed API behavior. Preserve upstream licensing/attribution separately from original GWI source; no silent Apache-2.0 relicensing or copied upstream assets.

Codex authentication stays managed by Codex; work remains scoped to authorized locations and effective sandbox behavior is reported truthfully. Do not change global provider settings or choose a costly model/tier implicitly. Explain an unavailable implemented action and its recovery without presenting future capabilities as controls.

Link GitHub Issues, PRs, checks, deployments and release evidence to the corresponding work/stage. Observe exact revisions/runs. Cancelling observation does not claim to cancel remote execution. Publication follows configured review and privacy boundaries.

## Knowledge, persistence and privacy

Explicit project documents, selected agent memory, artifacts and verified lessons form project/role knowledge. Preserve source identity, revision/hash, relevance and actual usage. Synchronization exposes changes and stale/failed inputs without replacing past execution context.

Audit connects objectives, team/capability basis, pipeline/plan revisions, actions, checks, feedback, costs and outcomes. Raw logs and native identifiers are progressive detail beneath readable summaries.

Use persistent local state and loopback-only services. Actual settings, bindings, memory, credentials, transcripts, captures and databases remain private. Public source contains reviewed implementation, English documentation, notices and synthetic tests. Human/agent APIs enforce project scope and revision checks.

## Complete-product acceptance

Each requirement needs current evidence; the old technical test count does not establish product acceptance.

1. Real Multica backend/auth/runtime integration: project, agent and capability management plus a bounded Codex execution, with effective permissions and references recorded.
2. Independent GW/GWI projects and new-project adoption without authoring prompts or execution settings first.
3. GUI team/capability management and useful visual pipeline authoring; equivalent authenticated agent operations, with invalid/stale changes rejected.
4. Real ordered and parallel/dependent execution, handoff, independent review rejection, focused rework, human intervention and final acceptance.
5. A general request coordinates useful work and adjusts the next action from evidence, rather than only starting a whole-project template.
6. Event-driven loops wait without paid polling, detect stagnation, stop appropriately, enforce limits and preserve state through interruption/restart/capacity recovery.
7. Actual GitHub checks/delivery links, truthful observation failures, and artifacts/knowledge reused by a subsequent operation.
8. The historical GW website-parity case as an explicitly labeled interaction replay, followed by a fresh bounded task through shipped interfaces. Do not republish the fixed website to manufacture activity.
9. GWI improves its own workflow/capability configuration through the normal revision and evidence path, without a privileged hardcoded project.
10. Operate the complete project-to-delivery journey in English/Simplified Chinese, including responsive layout, keyboard, loading/empty/error/waiting and recovery. User product review is separate from engineering checks.

Track implementation and unpassed checks explicitly. Keep the full requested product scope intact while work proceeds.

## Reasoning settings (bounded issue #6)

Every newly created project role, including Team, Settings and server creation paths, defaults to native `max`; new connected agents do too. Explicit choices and copied role settings remain explicit. Existing private configurations and frozen run snapshots are never migrated. Model IDs, permissions, skills, tools and credentials remain unchanged.

The native values `low`, `medium`, `high`, `xhigh`, `max`, `ultra` round-trip through validation, serialization and Codex/Multica execution without downgrading. In every locale their exact display labels are Light, Medium, High, Extra High, Max, Ultra, respectively. Team role, Settings role and connected-agent editors show these labels and nearby guidance in the current UI locale only (English or Simplified Chinese), backed by the shared language resources, with a [CodexRadar reference](https://codexradar.com/?station=codex). This reference is advisory; the installed model catalog and runtime determine actual support and availability. Unsupported choices must never be silently replaced.

Acceptance requires focused tests for new defaults, max/ultra validation and adapter pass-through, supported choices and locale-independent labels, plus typecheck and build. Independent QA exercises the three editors in English and Simplified Chinese. The supervising owner applies Max to active roles through the UI after delivery; this implementation does not change them. No paid model probes or publication are required. See [official model and reasoning guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents#choosing-models-and-reasoning).
