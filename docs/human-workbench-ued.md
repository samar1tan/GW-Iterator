# Human workbench interaction and visual design

Allowance revision: [Account allowance interaction](account-allowance-ued.md) defines the current ordinary execution policy. Earlier execution and configuration records remain historical evidence.

Status: shared visual and interaction contract for the implemented workbench and current experience refinement. Operational acceptance remains separate. This replaces the earlier default live canvas and configuration-heavy ordinary paths.

## Visual contract

Use GitHub-like neutral dark surfaces, restrained borders, 6px radii, readable 14px body text, clear section headings and compact aligned controls. Blue identifies selection and links; status colors describe actual state. Support a coherent light appearance where provided. Avoid ornamental gradients, emoji/unicode icons, oversized empty cards and 8–11px essential text.

Use an original GWI loop/branch mark. App, favicon, website and README share the same canonical SVG asset. Standard icons use a consistent SVG geometry. Follow semantic color, spacing, type, border and focus tokens rather than per-screen palettes.

## Spatial roles

- Global chrome: GWI identity, current project, connection health when useful, locale/appearance.
- Project navigation: Workbench, Pipelines, Team, Knowledge, Settings with stable naming and selection.
- Workbench: outcome entry, current work, waiting decisions and recent deliverables in that order. Use readable rows with one primary next action.
- Run: clear outcome/state header, stage list or graph, selected-step result and a visible activity timeline. Technical execution details remain expandable.
- Desktop uses a bounded list/detail layout. Narrow screens provide the same controls in a readable document/selected-detail flow; nothing relies on an offscreen canvas card.

The core [module and entry contract](UED.md#module-and-entry-contract) owns navigation. A back label names the real origin, including a goal, execution list, team role or knowledge entry. Preserve the project, selected object and useful filter; unknown links show an explicit missing-object action. Do not silently substitute another stage. Keep one primary action for the current object rather than copying start/retry controls into several sections.

## Launch

Run pipeline opens a dialog with workflow name, one concrete outcome field, inherited settings summary, Cancel and Start. Empty starts are disabled. Advanced settings are collapsed. Closing the dialog starts nothing. Preserve entered work after errors. General intake remains another entry, not an obligatory extra coordination step for known work.

On an empty Projects page, provide a short explanation of the local team/pipeline workbench and Connect project. Keep manual connection directly available beside Codex-assisted adoption; it is a normal entry, not an advanced permission setting. Avoid a feature grid or a mandatory tutorial. Manual-only launch and stages show their actual human action; omit model/allowance help that does not apply, including known child workflows that contain only manual actions. Unresolved child definitions remain explicit uncertainty. Account summaries stay compact beside the outcome, with reset/observation and full trend evidence in one disclosure. A submitted launch remains discoverable until its authoritative result is shown; the dialog cannot silently discard its receipt.

## Pipeline library and editor

Library uses compact searchable rows with name, purpose, shape, last actual result and Edit/Run actions. Reusable definitions and executions remain separate. The editor starts with a readable stage sequence and contextual fields; the editable graph is available for dependencies, branches, conditions and returns. JSON is an expert path.

## Live execution

Default to a step list with status icon, stage name, owner, concise latest result and artifact/check summary. Select by click or keyboard. The optional graph shows the same identities; nodes stay compact, fit the actual visible pane and do not recenter on every polling update.

The selected step prioritizes actual result, evidence, pending decision and next action. Put raw IDs, policy numbers, provider state, attempt logs and native configuration behind descriptive disclosure. The complete request is available without repeating its full text in every card or heading.

Use a GitHub-like timeline with stable event keys, short localized event titles, real message/evidence, actor/time and optional details. Filter meaningful categories and group related events where useful. Streaming updates must not move a reader inspecting older work; offer an explicit follow/new-events action when needed. Do not present raw event codes as the main title.

## State feedback and motion

Recorded stage state is the source of truth. Render the same state in the step list, optional graph and inspector; selection is an independent treatment. A model message, healthy connection, account observation or elapsed timer does not make a stage running. A paused run may still have an in-flight task; show the actual stage and pause boundary instead of inventing its termination.

| Recorded condition | Feedback and useful next action |
| --- | --- |
| Queued / dependency pending | Static neutral marker and dependency/context; no running animation. |
| Running | A restrained blue accent moves along the existing stage-row/node border, with a visible Running label/icon. No extra card, full-surface pulse, flashing text or layout movement. |
| Waiting / account hold / human task | Static waiting treatment and the responsible person/service or account uncertainty; offer the actual decision. Waiting is not a model failure. |
| Review | Static review treatment with result/evidence and Accept / Request changes. A recorded result alone is not proof of acceptance. |
| Paused / stopped / cancelled | Static state and authoritative explanation; show the existing permitted resume/recovery action. A submitted stop is not yet confirmed remote termination. |
| Failed / interrupted / external state unknown | Static failure or uncertainty treatment, scoped explanation and Continue or Check state as appropriate. Do not infer failure from a lost observation connection. |
| Completed / skipped | Static terminal treatment and actual evidence; no active motion, warning for successful completion or lingering live claim. |

Keep running motion subtle, continuous and slow (approximately one pass every three seconds). Use a thin border accent rather than a glowing surface. It must not change geometry, obscure keyboard focus/selection, intercept clicks or restart on every data refresh. Multiple running stages may animate independently. Authoring nodes never animate as execution. Stop the treatment when the stage leaves Running; offscreen/hidden views need not animate. Under `prefers-reduced-motion: reduce`, show a static running border and the same text/icon. State is understandable without color or motion, and border motion is never presented as a provider heartbeat or progress percentage.

Keep request submission, background observation and execution feedback separate. A pending action names what is happening; repeated activation is prevented. If a server-supported continuation is pending, its explicit Cancel action invokes authoritative cancellation and reports the receipt. A read-only reconciliation is labeled as checking external state. Failed refreshes keep readable content and offer retry, rather than replacing the workspace with an empty/error-only page.

## Continue, review and stop

- Continue identifies the failed scope and preserves accepted work. Sufficient approved allowance needs no separate top-up form.
- Attempt/time/round ceilings present a concise finite recommendation. Account exhaustion offers wait/refresh; unavailable or caution readings name the uncertainty before one-step approval. Token diagnostics remain expandable history.
- An uncertain external task offers Check state with a useful explanation, not an ordinary retry button that duplicates work.
- Review offers Accept or Request changes with relevant evidence. A requested revision needs a concrete finding, not generic mandatory prose for every normal action.
- Manual delivery provides a short result/checklist and artifact inputs. Distinguish prepared, reviewed, integrated and published facts.

## Keyboard, layout and draft continuity

Use semantic links/buttons and visible focus throughout. Tab/Shift+Tab reach all controls in reading order. In the step list, Up/Down/Home/End move focus and Enter/Space select the focused step; graph use is optional. A changing run does not steal focus or move the selected stage. Opening a detail from an action gives it a named heading and a discoverable return.

Dialogs have an accessible title, an appropriate initial focus, a contained Tab order and focus restored to their opener (or the nearest surviving logical control). Escape and the close button dismiss only the view when safe; neither submits, approves nor cancels server work. A pending operation must remain discoverable after dismissal, or the dialog keeps an explicit explanation and supported cancel/stop control. Confirm only the loss of actual unsaved edits. Dirty editor/settings drafts survive background refresh; errors/stale revisions preserve inputs and offer deliberate reload/retry. A deliberate editor reload resets all field representations to the same current revision, including intermediate text drafts. Do not add confirmation steps to routine inspection or successful starts.

At desktop widths, keep stage list/topology and selected detail in stable panes with activity visible. At intermediate/narrow widths, use document order: identity/actions → steps → selected result/decision → activity. Keep every action usable without graph panning. At 390px and the 320px minimum, long names/paths wrap, action groups can stack, essential text remains 14px, and modal/page controls remain in reach without horizontal page scrolling. Test focus visibility inside scrolled/sticky regions and at browser text zoom.

Empty states name the absent object and one relevant existing action. Distinguish loading, no matches, no records and failed retrieval. Errors identify the affected operation and next useful step; identical stop reason/attempt error/result prose appears once. Detailed IDs, source errors and provider payload remain inspectable without dominating the ordinary result.

## Team, knowledge and settings

Team defaults to working roles, responsibilities, current model/effort and effective capabilities. Role editing surfaces responsibility and model choices first. Native templates, skills, MCP tools, permission mechanics and import/export remain advanced and truthful. Do not require editing permanent permissions to run a routine check.

Knowledge uses a readable source/list/detail structure with provenance and current/stale status. Source entry explains project-relative paths and supported formats; the registered effective path remains inspectable. Settings groups project bindings and read-only default/integration summaries. Team owns all role edits and Knowledge owns source management. Six effort labels stay English; surrounding explanation follows the locale.

## Public website and README

Lead with what a person does and the work they can inspect. Use the own mark, a representative workflow preview with explicitly authored example data, setup and source links. Language switching preserves equivalent sections/case content. A preview is not an acceptance record of a real private run.

## Rendered review

Review all destinations and transient states after a meaningful batch. Check button wrapping, aligned actions, long requests/events, live-state stability, keyboard/modal focus, both locales and a narrow viewport. Record observed failures and fix structural issues before adding decoration.

## Ownership and first-work continuity

Settings starts with the four project-binding fields and Save/Reload. Team defaults are a read-only summary with a link to the responsible role; sources are managed in Knowledge. Do not retain a hidden second role/source editor. Preserve real unsaved binding edits on navigation/conflict and avoid submitting unchanged roles/sources with a binding-only action.

Team keeps role editing in one dialog. Advanced capability settings distinguish Multica library skills from local Codex skill paths; local discovery/bindings explain their actual execution applicability. Discovery errors preserve the existing selected paths.

A Knowledge source's expanded row has Edit and Remove registration actions. Editing opens the same source form as registration, retaining its identity, roles and optional memory section. Removal explicitly explains that it removes the registration, preserves source files and historical run context, and excludes its old indexed text from future work. The current-state list shows an actionable stale/missing explanation until a valid sync. Confirmed mutations are distinct from refresh failures and cannot be accidentally resubmitted.

A new adoption's Apply action includes local source synchronization before entering Workbench. If indexing has a gap, show the created project and a Knowledge action. Setup history records the actual indexing result; existing setup records remain unchanged.

Workbench and model-backed launch display one concise readiness notice only when the Git baseline is unavailable or registered sources need attention. Offer Check again and the relevant Settings/Knowledge destination; no required new fields or setup dashboard. A committed baseline is a source prerequisite, not a requirement to have a clean working tree or proof of a configured runtime. Human-only launch does not inherit the model-source gate. Automatic observations and manual refresh never start a model task.

## Art direction: precise, calm, connected

Use GitHub's clarity as a reference for an original GWI workbench. Three dark values separate the near-black canvas, charcoal navigation and raised working surfaces. Blue is an intentional accent for primary actions, selection, links and real running feedback; operational state colors remain semantic. Avoid a blue wash, ornamental gradients, excessive pills and equally strong nested rectangles. Keep the canonical GWI mark.

The type scale is 28px page titles, 16–18px section/result titles, 14px reading/control text and 12–13px supporting metadata. Use medium-weight labels and normal reading text rather than making every line bold. Native/system sans and monospace fonts keep the app self-contained. Use a 4/8/12/16/24/32 spacing rhythm, 36–40px standard controls, restrained 6–8px corners, fine dividers and a small number of stronger working surfaces.

Use one masthead composition across destinations: identity/title and supporting context on the left, a deliberate action group on the right. Content widths follow the object rather than stretching every field across the screen. Workbench gives the outcome composer visual priority and presents current work/decisions before reusable workflows and evidence. Its account observation is a compact subordinate part of the composer, with full warnings/evidence retained. Execution gives readable steps in roughly 40–45% of the desktop working width, a selected result/evidence inspector in the remaining 55–60% and an orderly activity rail. The graph view uses a full-width topology above its evidence, with readable initial node scale, explicit pan/zoom and a direct jump to the selected result; it does not shrink all node text to fit an inspector beside it. Settings groups labels and editing fields, with a separate secondary summary area; it should not resemble a full-width schema form.

Lists use quiet dividers and aligned action groups; independent cards are reserved for separate objects or working surfaces. Selected rows retain a clear indicator without filling whole pages with saturated color. Role/knowledge panes inherit the same rhythm; reading content remains primary over provenance metadata. Modals share the same heading, control, footer and focus contract.

Hover/focus/selection changes are short and stationary. Running borders keep their existing authoritative-state and reduced-motion contract. Responsive layouts deliberately stack in document order; important actions and reading text remain visible at 390px and the 320px minimum. Inspect actual long names, failures and both languages rather than using edited marketing text as visual proof.

Maintain the visual foundation in the existing human.css layer, with platform.css retaining structural layout and experience.css retaining state/interaction rules. Do not add a parallel theme stylesheet per page. All screen changes must be checked in a real browser; design images are not substitutes for functioning controls.
