# Integrated pipeline workspace

Status: replacement interaction baseline; implementation and user review are pending. Read with [the PRD](PRD.md). The former form-and-history layout is not the target design.

## Structure and visual system

Projects is the top-level entry. Inside a project, use a compact global header, stable left navigation, the current work/pipeline in the main canvas, and selected-item details in a contextual inspector. Preserve project and role context; show runner/connection health where it affects work.

Primary destinations: Workbench, Pipelines, Team, Knowledge, Settings. They represent current work, reusable work definitions, working capabilities, accumulated context and deliberate configuration. Raw logs are never the initial project view.

Use near-black canvas, distinct charcoal surfaces, blue selection and restrained status colors. Maintain readable type, aligned controls, clear density and adequate hit targets. Large empty cards do not replace hierarchy. Every visible item has a useful role and a working interaction.

## First use

Connect project asks for the local location. Infer name/repository/context and show a concise team/capability proposal, including reusable existing Multica agents. Ordinary work must not require prompt/model/tool/budget setup first. These remain editable afterward.

Setup failures identify a missing prerequisite and useful action. A configured URL is not a successful connection. Credentials remain server-side/private; tasks do not ask users to paste provider tokens.

After connection enter a usable workbench. GW/GWI are actual independent configurations, not fixed cards.

## Workbench and intake

Answer what is being advanced, who is doing what, what needs attention and what was delivered. Active outcomes, pending decisions, useful pipeline shortcuts and recent artifacts take priority over counts.

A short natural-language entry starts an outcome. Known pipelines have a direct Run action with inherited defaults. Ask only for a genuinely missing required input. Keep configuration outside both ordinary paths.

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

For a stopped pipeline, its stage inspector shows the used/remaining allowance and an advanced **Extend limits** action. The dialog names the pipeline scope, preserves consumption, and requires the finite new limits and a reason. Saving records a revision without starting work. Return to the outcome to continue coordination, or retry the failed stage directly. Unknown external execution state must be reconciled first.

## Team

Show working roles, real agents, availability and assignments. A selected role exposes responsibilities, deliverables, skills/tools, knowledge and handoffs. Add, duplicate, retire and import roles; the initial role set does not define a limit.

Distinguish defaults and project overrides. Capability/permission changes show their effect on future work and retain past bases. Do not equate an instruction with an enforced native permission. Agent views link actual work, rather than only an editable prompt.

## Knowledge and delivery

Organize requirements, decisions, produced artifacts, selected memory and verified lessons by role/project. Show provenance and usage. Stage references open the same knowledge entry/artifact without losing run context.

Delivery gathers changes, checks, reviews and external publication references. Distinguish prepared, accepted and deployed. Retain supported learning/change proposals; do not automatically store every model sentence as project memory.

## Concrete review journey

Use the GW website mismatch as a clearly labeled replay: select GW; submit the mismatch; see the chosen operations flow; inspect roles and shared case; review rejection/return; inspect CI/publication evidence; accept delivery; find the reusable finding. Historical evidence must not masquerade as a fresh run.

Then operate a fresh bounded real task through the same controls and connected backend. Record interventions and unpassed checks. Inspect both locales, normal/narrow layouts, keyboard use, waiting/failure recovery and return navigation. Screenshots and diagrams alone are insufficient.

## Reasoning controls

Team role, Settings role and connected-agent editors use identical native effort choices with locale-independent labels: Light, Medium, High, Extra High, Max, Ultra. New roles and agents start at Max. Keep existing selections visible; disable choices excluded by the selected installed model's capability list, without silently changing a saved effort. Inherited models use the catalog default when known. Unknown capability data is not a promise of support: runtime availability remains authoritative. Place one concise guidance paragraph in the current UI locale and the advisory CodexRadar link beside these controls. Switching between English and Simplified Chinese updates the guidance and advisory marker; only the six effort labels stay in English. Existing role edits and run history retain their original values until explicitly saved.
