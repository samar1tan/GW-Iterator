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

## Human journey continuity

Outcome and saved-workflow request fields keep a tab-local draft on navigation, dismissal and reload. Review guidance is scoped to the stage attempt, so inspecting another step does not lose a finding and a later attempt does not inherit it. Inputs stay private on the loopback origin; they are cleared after a confirmed write, not after an attempted submission. A short draft hint explains this behavior without a confirmation dialog. A successful start opens its recorded object even when the subsequent refresh fails; the existing observation error and refresh action describe that gap rather than reporting another failed start.

Manual task instructions are ordinary task content, visible above its Record result or Review delivery action. Show the human's actual prompt, without expanding raw role configuration. Keep upstream results inspectable alongside it. Pending role saves use the same busy/dismissal contract as other mutating dialogs.

Add stage appends after the selected stage (or the last stage when none is selected), exposes that dependency in the step row, and chooses free graph space. Duplicating a stage retains its existing dependencies but also chooses free space. Explicit dependency controls still support parallel work; no existing saved definition is rewritten.

Workbench history expands in place to all recorded outcomes and direct executions; older unsuccessful outcomes remain reachable through that list instead of disappearing after six items. Retaining a lesson provides an Open saved entry action that deliberately clears conflicting filters for that navigation, while ordinary browsing retains its current filters. Manual project connection explains the existing local-directory requirement before submission and renders validation errors in the chosen UI language.

Project sidebar destinations open their project-wide scope. A selected Team role is not an implicit Pipelines or Knowledge filter; contextual role links and browser history still preserve their explicit selection and return context.

The prepared-change preview and provider-backed owner delivery step explicitly identify the execution-workspace boundary: acceptance does not write back to the original project directory or establish integration/publication. Do not let a successful task state imply those effects.

Knowledge keeps the Sources heading outside a bounded, vertically scrollable source list. Expanded source paths and status details scroll within that region; Entries begins below it and must not overlap. Use the same containment at desktop, intermediate and narrow widths, including enlarged text and long names.

The workbench's index notice names the actual gap: local content without a verified source receipt, unsynchronized registrations, or counts of missing/error entries. Use a quiet informational treatment for unverified existing content and warnings for recorded problems. Synchronize sources performs the existing local indexing operation without a model; afterward the notice follows the refreshed authoritative status. A refresh failure offers Check again rather than repeating a confirmed sync. Keep source inspection available in Knowledge and preserve the current outcome draft.

Knowledge bodies use the shared dark reading surface with a clear document heading scale, paragraph spacing, indented list markers, quotation rules, understated inline code and bounded code/table scrolling. Prose and long links wrap inside the reading panel. Source selection, metadata and provenance keep their existing positions. Markdown task boxes are read-only content, not editable application settings.

A web link opens a separate tab. An in-document link scrolls and focuses its target within the current reader, retaining the selected project and entry. Unsupported file destinations retain readable labels and a destination tooltip. Image references are links with their alternative text; opening one is an explicit action. No Markdown source toggle, rich-text editor or new setup step is added for this reading repair.

When the first rendered document heading matches the entry title, show that document heading once and keep the header's kind, revision and role metadata. Preserve the heading node and anchor; entries without a matching leading heading retain their existing title. Opening a section link separately retains the selected document's valid workbench URL; chapter-level shareable URLs are outside this reading repair. Footnote destinations and their return references accept keyboard focus.

A direct informational response appears in the existing outcome detail as Answered, with an Answer heading and the formatted response. Keep the original request, evidence/decision history and technical references available. Omit the empty action panel for an answered question; there is no new chat surface, setup field or mode selector.

When a failed request already has an ended successful coordinator output, show Generated result with a short notice that workflow completion failed and the retained text is not accepted delivery. Keep the original error in details and the original failure status. Reading this text requires no retry. Other failed requests with zero actions say no action was dispatched, not that planning is still happening.

## Default information density

A default surface earns space by identifying the current object, a real choice, a material state or the next action. Do not fill it with explanations of the design, unchanged safeguards or speculative uses. Replace prose with a visual only when it makes a specific relationship easier to scan: execution-type icons, dependency markers, selection/state, actual remaining allowance and trend. Keep accessible labels and essential names; icons alone must not conceal a decision or error. Fewer paragraphs must not become a larger pile of bordered cards or repeated icons.

Pipeline launch uses this order: workflow header; Task input; compact execution path with actual stage owners; effective model summary; account window/remaining indicators; one collapsed Execution details section. The footer contains Cancel and Start. No nested technical-history section is shown during ordinary launch. An identical model/effort shared across roles is summarized once, with per-role information available in details. Purely human and CI-only paths omit model/account information according to their actual resolved scope; unknown child work remains conservative.

Stage rows use distinct execution-type icons and name/owner hierarchy. A connector is shown only for an actual serial relationship; other dependencies, conditions and return paths use their actual labels rather than a fake linear chain. Healthy account readings use named window values and small remaining meters. Confirmed observed ranges may be shown without an additional sample-history paragraph; insufficient/uncertain evidence remains in the account details. Unavailable or blocked readings show the current actionable cause in the main surface, not an automatically unfolded technical log.

The shared modal is a bounded flex column: fixed header, scrollable body with `min-height:0`, and an optional nonshrinking footer. Launch's footer submit button targets the real form by ID; required fields, busy state and focus containment remain functional. Existing modals without the footer slot still scroll their body and action groups inside the shell. At narrow or short viewports, content may scroll but the shell, focus and launch controls remain reachable. Inspect real rendering and operation after the structural change.

Workbench intake follows the same attention rule: its placeholder identifies questions and tasks without a separate paragraph about orchestration or draft storage. Draft preservation remains behavior, not a default explanatory block.

## Execution as an observable process

During initial coordination, replace the repeated empty Decision and Actions regions with one Current execution surface. Its leading icon and state name explain the current operation; a second line identifies the role and step. A quiet metadata row shows actual elapsed wall time and latest meaningful activity age. Public commentary or a short command/tool detail occupies one bounded line or disclosure rather than a growing transcript. When work is delegated, show actual active steps and keep their existing open/result/decision paths. A selected active step uses the same feedback component.

Animate the existing surface edge only while its authoritative state and recent observation support active work. An operation change updates its icon and short label in place; no random rotating messages, invented percentages or animated waiting placeholders. Use static queue, human/CI wait, review and observation-gap treatments. After a quiet interval, state that there is no new activity without labeling the execution failed. An observation failure stops active motion and retains the last known operation. Terminal results replace live feedback. Keep polling and timestamps separate from evidence of provider activity, and do not announce a ticking timer through an ARIA live region.

Filter execution signals by run, stage and attempt. Transport usage, reasoning summaries and unclassified provider text remain technical records. Explicit public commentary can appear as a concise update; command/tool and file-change categories use semantic icons. Expose the full command only on demand. Keep source states, both locales, reduced-motion fallback, keyboard access and narrow wrapping in the rendered review.

## Result-to-next-work continuity

Completed results have a compact Continue here composer before Activity/history. Its placeholder invites the next question or change; the send action uses ordinary account admission and adds no policy form. Match the Workbench input and private draft behavior. Avoid autofocus that scrolls a newly opened answer past its content. The reply should be within reach after reading, with an optional local shortcut to focus it.

A linked result identifies its preceding request in a concise navigation row and lists the included source requests and any omissions in a collapsed disclosure. Those links open the original completed results; exact frozen execution context remains available in the recorded snapshot. Show existing follow-ups as direct links beside that relationship. Do not repeat complete answers as a stack of open cards. Navigating between linked entries preserves the project, drafts and normal Back/Forward behavior. A new result keeps its own execution/decision history while the earlier result remains intact.

Clarification uses a Reply field in the same location and the guarded continuation path. Keep the actual question visible, omit duplicate Continue controls when the inline reply is ready, and preserve explicit recovery/approval controls when additional action is required. Announce submission/busy/error states without adding a tutorial or treating a normal reply as a new independent project task.


## Request-entry keys

Use Enter to send and Shift+Enter for a new line in the shared message textarea. Keep Command/Ctrl+Enter as an equivalent send shortcut. A short localized hint beside the input's actions makes this discoverable; the hint and accessible description do not replace the normal action button. Input-method candidate confirmation follows native composition behavior, and a held Enter cannot create repeated requests. Focus on account refresh, disclosure controls or action buttons retains native behavior.


## Request heading hierarchy

Use the same short request preview in project/global work lists and goal/execution details. The detail header has a compact 20px, semibold heading, limited to two visible lines; status and project/workflow remain smaller context. The preview selects the first text-bearing line/first sentence, skips empty list/heading markers and is bounded to 64 grapheme clusters, adding an ellipsis for length truncation. It identifies the task without interpreting or rewriting the request.

Full request remains a separate, keyboard-operable disclosure directly below the header, closed on entry. Opening it reveals the exact original multiline input in a normal reading style, with long text wrapping inside the content area. Do not repeat the complete input as a display heading or add another preview card. Header actions remain reachable alongside or below the heading without squeezing its text; the current execution/result follows the collapsed disclosure. Apply the same hierarchy to both UI locales and the global detail shell.


## Recovery without a navigation hunt

Show one compact recovery surface before the result/history: affected step, a localized cause, the current automatic action or concrete stopping reason, and the primary Retry failed step action. While checking termination or backing off, show the finite next check/retry and retain Stop. Distinguish Check again from a confirmed dispatch. Keep full provider errors and attempt records in details. Failed outcome links from project/global work lists open this surface; a stage inspector uses the same recovery vocabulary and does not require account refresh before a model-free termination check. A failed-step retry preserves accepted upstream work and returns to ordinary coordination after the target completes.
