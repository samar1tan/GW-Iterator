# Integrated pipeline workspace

Current execution interaction: [Stage execution supervision](stage-execution-ued.md). It removes numeric execution quota inputs and extension gates while retaining actual boundaries and historical diagnostics.

Current allowance interaction: [Account allowance](account-allowance-ued.md), layered on the human workbench without a new quota form.

Current design revision: [Human workbench UED](human-workbench-ued.md). Apply its GitHub-inspired visual system, step-first execution and progressive configuration in preference to the earlier presentation below.

Status: interaction contract for the implemented workbench and its current experience refinement. Source coverage, operational verification and user acceptance are separate. Read with [the PRD](PRD.md).

## Structure and visual system

Projects is the top-level entry. Inside a project, use a compact global header, stable left navigation, the current work/pipeline in the main canvas, and selected-item details in a contextual inspector. Preserve project and role context; show runner/connection health where it affects work.

Primary destinations: Workbench, Pipelines, Team, Knowledge, Settings. They represent current work, reusable work definitions, working capabilities, accumulated context and deliberate configuration. Raw logs are never the initial project view.

Use the same object hierarchy everywhere: project → outcome or direct execution → delegated execution → stage/result/evidence. A short saved-pipeline run may have no supervising outcome. Preserve that distinction instead of inventing a blank parent goal. A role belongs to the team; its captured version in a run describes that execution, not today's default.

Use near-black canvas, distinct charcoal surfaces, blue selection and restrained status colors. Maintain readable type, aligned controls, clear density and adequate hit targets. Large empty cards do not replace hierarchy. Every visible item has a useful role and a working interaction.

The [global workbench interaction](global-workbench-ued.md) extends Projects with cross-project observation and project-scoped interaction in place.

## Module and entry contract

This is one navigation system, not a sequence of mandatory forms. The paths below already have corresponding frontend surfaces; the return, empty-state and feedback requirements are acceptance obligations rather than claims that every path has passed.

| Entry / object | Primary content and action | Context, onward path and return | Empty or failed state |
| --- | --- | --- | --- |
| Projects / global workbench | Connected projects, scoped request entry, cross-project attention/current work and recent results; Connect project and quieter manual setup. | Filter by project or open work in the global shell. Reply, follow up, review and control work here; entering a dedicated project workspace is optional. | With no projects, retain the connect entry. Failed summaries preserve known work and locally confirmed receipts without inventing an empty workspace. |
| Workbench | Outcome entry, current work, needed decisions and delivered evidence; saved-pipeline shortcuts. | A new outcome opens its goal; a direct run opens its execution. A decision opens the actual stage. | No work is an invitation to describe an outcome or use a saved pipeline, not a failure. Manual/review/account holds are counted truthfully. |
| Goal / supervising outcome | Request, current interpretation, delegated runs, clarification and next useful action. | Open a child execution with a return to this goal. Return from the goal to Workbench. | Distinguish clarification, human/account wait, recoverable failure and stopped/completed history; act on the limiting scope. |
| Pipelines: Library / Executions | Library is reusable definitions with Edit/Run; Executions is actual run history. | Preserve the active tab/filter when returning from an editor or execution. Run opens the concrete-outcome dialog before dispatch. | No definition, no matching filter and no executions are separate states with relevant existing actions. |
| Pipeline editor | Definition, stage list, contextual fields; optional editable graph; Save a revision. | Return to its library origin. Selection is shared across Steps/Graph; authoring never looks like a running execution. | Show invalid references, stale revision and save failure beside the draft. Preserve changed work until Save or deliberate discard. |
| Execution / selected stage | Outcome/state, readable steps, selected result/evidence/action and human activity. | Preserve the originating goal, executions tab, team assignment or knowledge entry. Parent/child run links retain their chain. Direct links have a deterministic project fallback. | Unknown IDs are an explicit missing object with a useful return, not a different silently selected run/stage. Failed observation preserves the last known result without claiming a failed remote task. |
| Team / selected role or agent | Responsibilities, current defaults, effective capabilities, assignments; deliberate role/agent/skill edits, including clearly separated native local skill paths. | An assignment opens the same execution/stage and returns to the selected role. Permission mechanics remain advanced. | Separate no roles/agents, missing binding and runtime unavailable; offer only the existing appropriate management action. |
| Knowledge / selected entry | Source registration/edit/removal/sync, entries, search/filter, content, provenance, current/stale/missing state. | An origin-run link opens that execution; return preserves the selected entry and filter. | No sources, no synchronized entries, no matches and failed synchronization are distinct. Do not erase the last readable content on a failed refresh. |
| Settings | Project bindings, read-only defaults/integration information, and links to Team/Knowledge as the single editors. | Preserve project/role context. Team edits responsibility; Settings exposes deliberate project configuration without becoming another start gate. | Failed discovery differs from no capabilities. Stale saves keep the draft and identify the conflict; reload/discard is deliberate. |

The page back action names its destination. Browser Back/Forward and refresh resolve the same identities without starting work. Local status refreshes do not append navigation history. A valid direct link keeps its project and selected object; an unavailable object never leaves an indefinite loading placeholder. Keep changed editor/settings drafts when observations refresh; warn about actual unsaved changes before discarding them on navigation, without confirmations for ordinary browsing.

## First use

Connect project asks for the local location. Infer name/repository/context and show a concise team/capability proposal, including reusable existing Multica agents. Ordinary work must not require prompt/model/tool/budget setup first. These remain editable afterward.

Setup failures identify a missing prerequisite and useful action. A configured URL is not a successful connection. Credentials remain server-side/private; tasks do not ask users to paste provider tokens.

The first-project empty state gives one useful next action and a brief account of how the local workspace is used. Do not add an onboarding wizard, sample projects that appear real, a feature tour or more setup fields. Connection proposal review and its apply action remain distinct; explain any model-backed preparation before submission. Submission and background scanning have explicit busy/progress states, prevent duplicate starts and leave the resulting proposal discoverable. Applying the proposal enters Workbench with the chosen defaults.

After connection enter a usable workbench. GW/GWI are actual independent configurations, not fixed cards.

## Workbench and intake

Answer what is being advanced, who is doing what, what needs attention and what was delivered. Active outcomes, pending decisions, useful pipeline shortcuts and recent artifacts take priority over counts.

A short natural-language entry starts an outcome. Known pipelines have a direct Run action with inherited defaults. Ask only for a genuinely missing required input. Keep configuration outside both ordinary paths.

For a fresh project, prioritize Focused change as the ordinary reusable shortcut; retain longer product/operations templates in the library. Recent real use may refine ordering. Combine or visually reduce wholly empty current-work/decision/delivery regions into one brief starting state, while preserving their stable roles when populated. Do not turn zero counts into five competing empty panels.

Submission opens actual work with interpreted scope and next action. Clarification appears here as a specific question. Do not leave a blank start form beside a long previous transcript.

## Pipeline catalog and visual editor

Separate reusable definitions and executions. Templates explain purpose, handoffs and deliverables. Creation starts from a useful template or blank definition and can be inspected before running.

Use an editable stage canvas, compact action palette and selected-stage inspector. Add, arrange, connect, duplicate and delete stages. Edit role/action/input/output/checks, human gates, conditions, child pipelines and bounded feedback paths. Validate broken references and unbounded cycles.

Inspector fields depend on the action: human review has no model field; CI observation has no role-prompt field. Select skills/tools/permissions from real capabilities. Publishing shows meaningful changes and preserves existing execution bases. JSON/import/export remain expert actions rather than the main editor.

## Live execution

The header identifies the outcome, state, execution boundary and useful controls. The canvas shows active path, owners, parallel work, dependencies, child runs and rework relationships. Each stage exposes a meaningful latest result and artifact link without repeating the original request.

Selecting a stage opens responsibility, inputs, actual output, check results, handoff and permitted actions. Attempts, native IDs, raw token counters, logs and frozen configuration are progressive detail. People inspect real work before accepting.

Feedback attaches to its work. Rejection sends the finding and evidence to the responsible owner; affected downstream work becomes visibly stale. Accepted unaffected work stays accepted. Show a new plan revision instead of silently replacing the graph.

Waiting identifies the person/service and useful action; it is stable and does not start repeated model turns. Native blocked does not discard pending human work. Retry is scoped and explains whether prior execution is known. Fallback obeys the allowed policy. Stop/cancel reflects authoritative owned and remote state.

For a stopped pipeline, the stage inspector shows actual account windows and applicable task observations beside a context-sensitive Continue action. There are no numeric execution-quota inputs or extension recommendations. Account exhaustion offers refresh/wait; unknown availability names the uncertainty before owner approval. Token counters and inert historical policy values stay in technical details. Unknown external execution is reconciled first; accepted work and original configuration remain intact.

State labels, border feedback and motion use the [shared state contract](human-workbench-ued.md#state-feedback-and-motion). Connection health, action submission and execution state remain separate signals. Native execution references are inspectable in technical detail; they do not imply that the session exists in the Codex desktop app or can be opened there. Do not add a desktop-session action without a working bridge.

## Team

Show working roles, real agents, availability and assignments. A selected role exposes responsibilities, deliverables, skills/tools, knowledge and handoffs. Add, duplicate, retire and import roles; the initial role set does not define a limit.

Distinguish defaults and project overrides. Capability/permission changes show their effect on future work and retain past bases. Do not equate an instruction with an enforced native permission. Agent views link actual work, rather than only an editable prompt.

## Knowledge and delivery

Organize requirements, decisions, produced artifacts, selected memory and verified lessons by role/project. Show provenance and usage. Stage references open the same knowledge entry/artifact without losing run context.

Delivery gathers changes, checks, reviews and external publication references. Distinguish prepared, accepted and deployed. Retain supported learning/change proposals; do not automatically store every model sentence as project memory.

The [delivery review interaction](delivery-review-ued.md) places this material beside the waiting decision in both project and global inspection. The person can inspect changes, screenshots and actual publication observations before accepting or requesting changes, without retyping the agent's result. An explicit preparation action adds material through a linked execution and leaves the decision open.

## Concrete review journey

Use the GW website mismatch as a clearly labeled replay: select GW; submit the mismatch; see the chosen operations flow; inspect roles and shared case; review rejection/return; inspect CI/publication evidence; accept delivery; find the reusable finding. Historical evidence must not masquerade as a fresh run.

Then operate a fresh bounded real task through the same controls and connected backend. Record interventions and unpassed checks. Inspect both locales, normal/narrow layouts, keyboard use, waiting/failure recovery and return navigation. Screenshots and diagrams alone are insufficient.

## Operational acceptance

Use an isolated local state directory, separate loopback service and a dedicated synthetic project containing only authored test material. Create and change fixtures through supported UI/API operations. A component fixture or synthetic provider result can cover a visual branch, but must be labeled and cannot establish real native execution, cancellation, CI or account consumption. Record actual provider-backed evidence separately from no-model manual tests. Do not modify private production projects, redeem account resets, publish artifacts or dispatch unbounded work to make a test pass.

| Journey | Required observed evidence |
| --- | --- |
| First project and start | Empty/loading/error pages have useful actions; cancel or blank launch starts nothing; scanning cannot be duplicated; proposal/manual setup applies only deliberately; Workbench opens with usable defaults, a focused shortcut and compact empty work regions. Natural-language and saved-pipeline entries remain distinct. A known manual-only child workflow is not falsely account-gated. |
| Author and reuse | Create a focused definition, edit/duplicate/connect stages, switch Steps/Graph, save, reopen and run with a concrete outcome. Invalid/stale saves retain the draft; unsaved navigation does not silently discard it. |
| Handoff and review | In a manual-only fixture, record blocked/revise/done results, inspect evidence, request changes, retry only the affected stage and accept. Prior attempts and accepted work remain visible; no model/allowance claims appear for manual work. |
| Supervision and recovery | Observe actual executing/waiting/review/paused/ended states, retained boundaries, stop and pending-continuation cancellation. Verify work beyond former numeric quotas, stale account approval and unknown external state with controlled evidence. No duplicate dispatch or false cancellation claim. |
| Context and persistence | Open runs from Workbench, goal, Executions, Team and Knowledge; return to the originating selection. Test browser Back/Forward, direct links, unknown IDs, reload and interruption. Frozen role/definition/result history does not change with current defaults. |
| Supporting modules | Exercise role/agent/skill management and a revision conflict; register/sync a synthetic source, inspect stale/missing/error status, add a lesson and follow its origin; save/reload Settings without losing an unrelated draft. Unsupported prerequisites remain explicitly unpassed. |
| Feedback and input | Operate dialogs and stage lists by keyboard, check focus after close/navigation and verify running-border motion plus reduced motion. Updates preserve the reader's selected stage and activity position; raw transport stays in technical history. |
| Layout, language and attention | Walk the same journeys in English and Simplified Chinese at desktop, intermediate and narrow widths (including a 390px viewport and the 320px minimum). Inspect long names/requests, action wrapping, inspector access, visible focus, errors and empty pages. Allowance stays compact and the start action remains close to the outcome. |

Record expected/actual result, locale/viewport, fixture basis and any intervention privately. Separate implemented, source-tested, operationally observed and still-unpassed cases. After a meaningful batch, walk the whole project-to-result journey again and remove redundant copy, repeated errors, unnecessary panels and competing actions before adding features.

## Reasoning controls

Team role and connected-agent editors use identical native effort choices; Settings shows a read-only summary with locale-independent labels: Light, Medium, High, Extra High, Max, Ultra. New roles and agents start at Max. Keep existing selections visible; disable choices excluded by the selected installed model's capability list, without silently changing a saved effort. Inherited models use the catalog default when known. Unknown capability data is not a promise of support: runtime availability remains authoritative. Place one concise guidance paragraph in the current UI locale and the advisory CodexRadar link beside these controls. Switching between English and Simplified Chinese updates the guidance and advisory marker; only the six effort labels stay in English. Existing role edits and run history retain their original values until explicitly saved.

The [ownership and first-work continuity contract](human-workbench-ued.md#ownership-and-first-work-continuity) supersedes the earlier duplicated advanced Settings editors and explicit post-adoption indexing step. Model-free source readiness is an actionable observation, not another configuration phase.
