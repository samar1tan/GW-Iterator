# Human workbench interaction and visual design

Status: implementation baseline for the current iteration. This replaces the earlier default live canvas and configuration-heavy ordinary paths.

## Visual contract

Use GitHub-like neutral dark surfaces, restrained borders, 6px radii, readable 14px body text, clear section headings and compact aligned controls. Blue identifies selection and links; status colors describe actual state. Support a coherent light appearance where provided. Avoid ornamental gradients, emoji/unicode icons, oversized empty cards and 8–11px essential text.

Use an original GWI loop/branch mark. App, favicon, website and README share the same canonical SVG asset. Standard icons use a consistent SVG geometry. Follow semantic color, spacing, type, border and focus tokens rather than per-screen palettes.

## Spatial roles

- Global chrome: GWI identity, current project, connection health when useful, locale/appearance.
- Project navigation: Workbench, Pipelines, Team, Knowledge, Settings with stable naming and selection.
- Workbench: outcome entry, current work, waiting decisions and recent deliverables in that order. Use readable rows with one primary next action.
- Run: clear outcome/state header, stage list or graph, selected-step result and a visible activity timeline. Technical execution details remain expandable.
- Desktop uses a bounded list/detail layout. Narrow screens provide the same controls in a readable document/selected-detail flow; nothing relies on an offscreen canvas card.

## Launch

Run pipeline opens a dialog with workflow name, one concrete outcome field, inherited settings summary, Cancel and Start. Empty starts are disabled. Advanced settings are collapsed. Closing the dialog starts nothing. Preserve entered work after errors. General intake remains another entry, not an obligatory extra coordination step for known work.

## Pipeline library and editor

Library uses compact searchable rows with name, purpose, shape, last actual result and Edit/Run actions. Reusable definitions and executions remain separate. The editor starts with a readable stage sequence and contextual fields; the editable graph is available for dependencies, branches, conditions and returns. JSON is an expert path.

## Live execution

Default to a step list with status icon, stage name, owner, concise latest result and artifact/check summary. Select by click or keyboard. The optional graph shows the same identities; nodes stay compact, fit the actual visible pane and do not recenter on every polling update.

The selected step prioritizes actual result, evidence, pending decision and next action. Put raw IDs, policy numbers, provider state, attempt logs and native configuration behind descriptive disclosure. The complete request is available without repeating its full text in every card or heading.

Use a GitHub-like timeline with stable event keys, short localized event titles, real message/evidence, actor/time and optional details. Filter meaningful categories and group related events where useful. Streaming updates must not move a reader inspecting older work; offer an explicit follow/new-events action when needed. Do not present raw event codes as the main title.

## Continue, review and stop

- Continue identifies the failed scope and preserves accepted work. Sufficient approved allowance needs no separate top-up form.
- A true ceiling presents a concise finite recommendation and one explicit approval; advanced policy fields are optional.
- An uncertain external task offers Check state with a useful explanation, not an ordinary retry button that duplicates work.
- Review offers Accept or Request changes with relevant evidence. A requested revision needs a concrete finding, not generic mandatory prose for every normal action.
- Manual delivery provides a short result/checklist and artifact inputs. Distinguish prepared, reviewed, integrated and published facts.

## Team, knowledge and settings

Team defaults to working roles, responsibilities, current model/effort and effective capabilities. Role editing surfaces responsibility and model choices first. Native templates, skills, MCP tools, permission mechanics and import/export remain advanced and truthful. Do not require editing permanent permissions to run a routine check.

Knowledge uses a readable source/list/detail structure with provenance and current/stale status. Settings groups general project bindings, execution defaults, integrations and advanced controls. Keep the ordinary page short; avoid duplicating an entire role editor as the first view. Six effort labels stay English; surrounding explanation follows the locale.

## Public website and README

Lead with what a person does and the work they can inspect. Use the own mark, a representative workflow preview with explicitly authored example data, setup and source links. Language switching preserves equivalent sections/case content. A preview is not an acceptance record of a real private run.

## Rendered review

Review all destinations and transient states after a meaningful batch. Check button wrapping, aligned actions, long requests/events, live-state stability, keyboard/modal focus, both locales and a narrow viewport. Record observed failures and fix structural issues before adding decoration.
