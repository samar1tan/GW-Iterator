# GW-Iterator: integrated iteration pipelines

Current allowance revision: [Account-aware execution allowance](account-allowance-prd.md). Ordinary allowance decisions use Codex account availability and observed task trends; raw token counters are technical diagnostics.

Current interaction revision: [Human workbench](human-workbench-prd.md), extended by the [global workbench](global-workbench-prd.md). It supersedes the earlier default-canvas, exposed-configuration and separate manual-top-up interactions. Historical execution/configuration bases remain intact.

Status: product baseline with implemented local browser workflows and connected runtime integration. Complete-product acceptance remains open. The experience refinement below aligns existing entry points and feedback; it does not declare the full requested product complete.

## Purpose and ordinary use

GWI is a local, all-in-one platform for advancing and supervising project work through configurable teams, pipelines and feedback loops. GitWorld is the first project; GWI itself is the second independent project. Humans and authorized agents can start work, understand progress, intervene, inspect delivery and improve later iterations through the same interfaces.

The product must reduce repeated prompting, ad hoc coordination, wasted model work and corrections. Counts, green execution states and logs cannot establish that outcome.

1. Connect a project by selecting its local location. Infer repository identity and relevant context; reuse connected agents or prepare a useful team. Do not require role prompts, model settings or JSON before first use.
2. State an outcome or run a reusable pipeline. Inherit project/team defaults and prepare scope, baseline and verification. Ask only for consequential information that is actually missing.
3. Follow live stages, owners, parallel work, dependencies, feedback paths, delivered artifacts and the next useful action. Explanations describe material decisions without exposing private reasoning traces.
4. Review or correct concrete work. Rejection returns the relevant finding to its owner. Human/CI waits preserve progress without paid reasoning polls.
5. Accept the requested outcome from evidence; retain relevant artifacts and verified findings for subsequent work. Implementation, verification, publication and product acceptance stay distinct.

Natural-language intake is one trigger. Codex is an execution capability. Neither becomes the entire product or forces short work through a long product-development workflow.

A focused task can remain in native Codex when it benefits from a direct conversation and rapid changes of approach. GWI is useful when the work needs durable coordination, reusable handoffs, independent checks or repeated human supervision. Within an approved objective and boundary, workers retain freedom to investigate and adjust their approach; a pipeline defines responsibilities and exit checks rather than every action they take. GWI adds coordination overhead, so improved speed, cost or quality requires evidence rather than a blanket claim.

## Product surfaces

| Surface | User outcome |
| --- | --- |
| Projects / global workbench | Observe projects together, submit project-scoped requests and handle work/results in place. Dedicated project workspaces remain optional focused destinations. |
| Workbench | Understand current work, responsibility, blockers and pending decisions; start an outcome or known pipeline. |
| Pipelines | Create, compose, edit and publish reusable workflows; supervise and compare executions. |
| Team | Configure working roles and their actual agents, assignments, skills, tools, context, permissions and availability. |
| Knowledge | Find requirements, decisions, outputs, selected memory and verified lessons, including where they were used. |
| Settings | Deliberately change project bindings, defaults, integrations and policy. |

Project, goal, reusable pipeline, execution, role, agent and artifact are distinct identities with visible relationships. Every destination preserves project context.

## Experience refinement and implementation boundary

Use one working hierarchy: **project → outcome or direct execution → delegated execution → stage, result and evidence**. A reusable pipeline is the definition used by an execution, not another copy of that execution. Team, Knowledge and Settings support this hierarchy; they do not become additional mandatory setup steps. Keep the five project destinations and use their existing list/detail views instead of adding dashboards or navigation modules. The [module and entry contract](UED.md#module-and-entry-contract) defines their relationship and return behavior.

The current frontend provides project connection with a reviewable proposal, natural-language outcomes, explicit saved-pipeline launch, a searchable pipeline library and stage editor, step/graph execution views, review/manual results, scoped recovery, account allowance observations, role/agent/skill management, knowledge synchronization and revision-aware settings. These are implemented paths to inspect, not acceptance evidence for every requirement above. Generalized team portability, every possible external artifact handoff and the effectiveness of autonomous improvement still need specific evidence; keep unsupported operations out of the interface.

This refinement closes ordinary journey gaps: an actionable first-project empty state; reliable project/object identity and return navigation; visible loading, waiting, failed and stale states; state-driven stage feedback; keyboard and modal behavior; and compact, readable layouts in both locales. Do not expand the scheduler, invent new execution modes, add configuration fields or hide incomplete behavior behind animation. Keep raw IDs, provider transport, historical token configuration and permissions mechanics in progressive details.

For a new project, ordinary shortcuts prioritize the focused-change workflow over longer product/operations templates unless actual project use supplies a better signal. Keep all reusable templates available in the library. When work, decisions and delivery are empty, use one concise starting explanation and reduce empty-region weight rather than presenting several large blank panels. Their spatial roles remain stable when content arrives.

A connection badge, animated stage or successful process is not proof of ongoing model output, verified delivery or acceptance. Running-stage motion is driven only by recorded stage state, has a static reduced-motion equivalent, and never appears on a waiting decision, account hold or authoring preview. Preserve selections, drafts, scroll and past evidence while observations change.

## Teams and capabilities

Roles are configurable working contracts: responsibility, inputs, expected outputs, acceptance checks, capabilities and handoffs. Initial roles are reusable templates, not a fixed seven-role product limit. Bind them to real Multica agents/runtimes and actual installed capabilities; show availability and assignments truthfully.

Support creating, duplicating, changing, retiring and importing teams/roles. Reusable template revisions, project bindings/overrides and frozen execution are distinct layers; the governance revision below defines controlled inheritance. Model/effort, skills/tools, approved knowledge and effective permissions remain inspectable but are not mandatory ordinary start fields. Historical work retains its original references and basis.

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

Bound concurrency, attempts, rounds and active execution time. Ordinary admission uses current Codex account allowance and comparable task trends; token counts remain diagnostics and explicit expert safeguards. Human/CI waits do not spend model tokens. Capacity recovery is finite and uses an allowed model pool; permission and task blockers are distinct. Reconcile authoritative work after restart before resuming; never blindly relaunch uncertain external operations.

When an attempt, round or time limit prevents further work, identify the limiting pipeline or supervising outcome and offer a concrete bounded continuation. Account exhaustion blocks paid dispatch; unavailable or caution readings require a deliberate owner step, with shared-account uncertainty visible. Retain original definitions, prior limits, consumption and attempts. Stop invalidates pending continuation; stopped gaps, human review and manual waiting do not become model-execution time. See the account-aware allowance revision for admission and compatibility rules.

Retain verified findings as project/role knowledge. Loop/team/pipeline improvements are reviewable revisions linked to their evidence; self-improvement cannot grant broader permissions or waive checks.

References: [loop-engineering practice](https://github.com/cobusgreyling/loop-engineering) and [the empirical study](https://arxiv.org/abs/2608.21884). These inform the design and do not prove GWI's loops effective.

## Integrations

Actually deploy and connect the Multica backend and execution facilities. Reuse project/agent/skill/task capabilities behind GWI's frontend and server-side adapter. Record the tested version and observed API behavior. Preserve upstream licensing/attribution separately from original GWI source; no silent Apache-2.0 relicensing or copied upstream assets.

Codex authentication stays managed by Codex; work remains scoped to authorized locations and effective sandbox behavior is reported truthfully. Do not change global provider settings or choose a costly model/tier implicitly. Explain an unavailable implemented action and its recovery without presenting future capabilities as controls.

GWI/Multica tasks and their native execution references are separate from conversations visible in the Codex desktop app. Using an installed Codex executable or authentication does not make those tasks appear as desktop conversations. The current product has no desktop-session discovery, import, attachment or continuation bridge. Explain this boundary where a person inspects execution details or setup; do not promise an Open in Codex action without a verified supported destination. A desktop bridge is outside this refinement.

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
10. Operate the complete project-to-delivery journey in English/Simplified Chinese, including responsive layout, keyboard, loading/empty/error/waiting and recovery. Use a dedicated synthetic project and fresh isolated local state for the experience review; keep real projects/configurations untouched. Follow the [operational acceptance cases](UED.md#operational-acceptance) and record observed failures, interventions and untested branches privately. User product review is separate from engineering checks.

Track implementation and unpassed checks explicitly. Keep the full requested product scope intact while work proceeds.

## Reasoning settings (bounded issue #6)

Every newly created project role, including Team and server creation paths, defaults to native `max`; new connected agents do too. Explicit choices and copied role settings remain explicit. Existing private configurations and frozen run snapshots are never migrated. Model IDs, permissions, skills, tools and credentials remain unchanged.

The native values `low`, `medium`, `high`, `xhigh`, `max`, `ultra` round-trip through validation, serialization and Codex/Multica execution without downgrading. In every locale their exact display labels are Light, Medium, High, Extra High, Max, Ultra, respectively. Team role and connected-agent editors, plus the read-only Settings summary, show these labels and nearby guidance in the current UI locale only (English or Simplified Chinese), backed by the shared language resources, with a [CodexRadar reference](https://codexradar.com/?station=codex). This reference is advisory; the installed model catalog and runtime determine actual support and availability. Unsupported choices must never be silently replaced.

Acceptance requires focused tests for new defaults, max/ultra validation and adapter pass-through, supported choices and locale-independent labels, plus typecheck and build. Independent QA exercises the three editors in English and Simplified Chinese. The supervising owner applies Max to active roles through the UI after delivery; this implementation does not change them. No paid model probes or publication are required. See [official model and reasoning guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents#choosing-models-and-reasoning).

The current [ownership and first-use cleanup](human-workbench-prd.md#ownership-and-first-use-debt-cleanup) gives project bindings, roles and knowledge sources separate editors, joins adoption to initial indexing, and reports committed-source readiness before paid work. Keep configuration compatibility and historical execution evidence intact.


## Context and reusable-definition governance

The [knowledge-context PRD](knowledge-context-prd.md) replaces first-document/prefix injection across all execution adapters. The [template-governance PRD](template-governance-prd.md) defines source/applicability records and explicit revision upgrades with project-owned choices. Their [interaction contract](platform-governance-ued.md), [architecture decisions](architecture/context-and-template-governance.md) and [acceptance plan](acceptance/governance-validation-plan.md) govern this iteration. Design documents are requirements until the corresponding implementation and evidence are recorded; they do not establish completed capability.
