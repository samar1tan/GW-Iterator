# Operating GWI

## Connect a project

After [local setup](multica-setup.md), start GWI and open `http://127.0.0.1:4318`. Projects is the top-level entry. The global workbench shows work and decisions across projects. Choose a request target or open an item to reply, follow up, inspect evidence and handle decisions without entering a project workspace. Project filters limit observation; they do not authorize a request to change every project. Each project retains its own workspace, team, pipelines, knowledge and configuration.

Choose an existing local workspace. Add a GitHub repository binding when the work needs it. Codex-assisted adoption reads bounded eligible sources and proposes project guidance, registered knowledge and workflows. Review the sources and proposal before applying it. Applying a new configuration also synchronizes its reviewed local knowledge sources, without starting model work or CI. If indexing fails, the created project remains available; resolve the source in Knowledge and synchronize again. Previously applied setup records are not silently resynchronized.

**Connect manually** creates the project with reusable defaults without a model scan. Repository binding and description are optional; team and workflow settings remain editable afterward.

## Start and follow work

Before model work, GWI checks that the selected folder is its Git repository root and has a committed source baseline. A dirty working tree does not block setup, but runs use committed files. Missing Git input is shown before dispatch; **Check again** refreshes it without model work. GWI does not initialize, stage or commit source as a hidden setup step. Known human-only workflows do not require this model-source check.

In the project **Workbench**, describe what should change and how you will recognize a useful result. Running a saved pipeline opens a short dialog for this concrete outcome; cancelling or leaving it empty starts no work. Ordinary starts inherit the project and role settings. Request fields send with Enter and insert a line break with Shift+Enter, including saved-workflow launches. Inspect the role/model and native permissions when useful. Stages have no numeric execution quota fields. Codex allowance shows the actual account windows, remaining percentages and reset times; Refresh reads them without starting a model task.

A general outcome records one bounded coordination decision at a time. The coordinator can select several workflows or retry a failed owned stage from new evidence. GWI waits for their actual results before another decision. Inspect the reason, selected actions and remaining allowance; a successful provider task is not outcome acceptance.

Open an action to see its steps and activity timeline. Selecting a step shows its owner, checks, actual result and permitted controls. Switch to the graph when dependencies or branches need inspection. Human activity opens newest first. Reading earlier entries pauses following and preserves your position; the selected category shows a new-activity count and a return to the latest update. Complete results stay in their main reader, with full output available in collapsed activity details. **Inspect changes** reads the execution checkout's tracked diff and status. Relative text artifacts can be previewed without executing their contents. Technical details retain execution references, usage and the frozen basis.

Only a recorded running stage has a moving blue border. Waiting, paused, completed and editing states stay still; a paused run can still have an in-flight stage finishing. The reduced-motion style retains a static state border and label. Execution details identify the Multica task and native session. These jobs are separate from chats in the Codex desktop app; GWI currently has no desktop-chat bridge.

Work uses committed-source checkouts, not the original dirty working directory. Each run records its actual input commit. Dependencies must be installed inside that checkout when required; source, ignored configuration and dependency directories are not shared by a writable link. A configured delivery role or the supervising owner must integrate or publish the accepted result. Inspecting an artifact does not perform that operation.

An independent QA stage can use a disposable copy of the actual prepared source, including eligible untracked files and deletions. Its input manifest is recorded. A no-model permission probe must demonstrate writes in the copy and denied writes to original source before dispatch. Test/build output may be written in ignored build/cache paths or `.gwi-verification/` scratch; changing its included source invalidates the review. This is task-scoped write confinement, not filesystem read isolation or a network domain allowlist. Unavailable browser, CI or dependency checks remain explicit work for a capable runner or the owner delivery gate.

## Review, return and stop

A manual stage waits for a recorded result. A review gate waits for an acceptance or revision decision. Attach a concrete finding to the work; bounded rework invalidates affected downstream stages and preserves independent accepted work and older attempts.

**Pause** stops further dispatch while current work may finish. **Resume** releases eligible stages. **Stop** requests cancellation of owned work; stopping GitHub observation does not cancel external CI. A running agent can receive supplementary guidance when its actual runtime supports it. A pending receipt is not confirmation that the instruction was delivered.

Use **Retry failed step** on failed work to continue its recorded scope. That action checks supported external execution state before replacing work; it preserves completed preparation. Unsupported external tasks require an explicit owner handoff. Preparation that stopped before assignment is recorded as not dispatched. A lost assignment response remains uncertain until an exact existing task can be identified; the platform does not blindly repeat the POST.

Ordinary starts and continuations use the account's remaining allowance together with recent comparable task executions. You do not enter or refill a token quota. GWI collects before/after account observations during real work and shows a range and direction once at least three comparable samples exist. With no history, it says that samples are needed. This account is shared with your other Codex sessions; observed changes are estimates, not exact charges for one task.

**Continue** preserves completed work and earlier attempts without a quota extension or refill. If the account is exhausted, wait for its actual reset or refresh. If the observation is unavailable or the trend suggests little room, an explicit one-step owner decision can proceed within the remaining boundaries; it cannot override a known exhausted account. You can stop a continuation while its account check is pending. Unknown external execution must be reconciled before replacement work. Manual stages need no Codex allowance. Stopped gaps and human review/manual waits do not count as model-execution time.

Token counts remain under technical details, alongside their historical configured values and missing-meter status. Old counters are not converted into percentage history. Historical concurrency, attempt, iteration, round, time and token quotas are not enforced on new or continued work. New goals enable smart retry for supported transient execution failures: GWI checks termination and account availability, applies technical backoff and requires a useful next action. An unchanged failure or unconfirmed termination returns for owner input instead of automatic repetition. Existing goals without smart retry are not silently opted in. Capacity-specific model fallback remains a separate optional policy using only selected fallback models. Permission failures, ordinary blocked tasks and unknown cleanup are not capacity failures. GWI does not infer fees or purchase credits.

## Adjust pipelines and teams

The **Pipelines** library separates reusable definitions from executions. Start with **Focused change** for a known bounded increment, or use the longer product, operations and knowledge templates when their handoffs are useful. The editor shows the stage sequence first; select a step to change its action, responsibility or checks. Use the graph for dependencies and the advanced definition for conditions, child work and return paths. Publishing a revision affects future runs; it does not overwrite older execution bases. Ordinary project work does not require creating a new workflow.

Process proposals record a definition revision, rationale and supporting run. Inspect them before applying. Stale revisions are rejected. Local configuration changes remain private; do not publish actual project, pipeline or role settings as examples.

Settings edits project bindings; its role/default summaries link to **Team**. In **Team**, role contracts describe responsibilities, inputs, outputs and acceptance checks. Select actual agents, skills, tools and runtimes. New projects receive independent role defaults, not a live inheritance link to every other project. A shared agent is a template for a project copy. Inherited skills and MCP bindings are shown from that template; an explicit edit begins with those effective selections. Duplicating a role retains its selected capabilities while creating an independent role/agent revision. Materialized role agents are immutable; use role settings to create another revision. Project custom templates can be edited. Native configuration that may contain credentials is write-only in the browser. Advanced role settings distinguish Multica skill-library bindings used by ordinary work from local skill files used by native Codex execution. Local discovery failures retain saved paths.

If a batch role import stops partway through, confirmed roles are already saved. The form reports progress and retains only the remaining roles; correct those entries and retry. Do not resubmit the original batch.

GWI control-tool permissions and native file permissions are separate. Each worker gets only its selected project-scoped control capabilities. The verified native runtime governs filesystem access and network behavior. Read-only instructions alone do not establish enforcement; see the setup guide for the tested policies and their limits.

## Maintain knowledge

In **Knowledge**, register deliberate local sources and relevant roles. Synchronize to inspect them immediately; starting new work also refreshes the registered source set before freezing its context. Supported text documents and selected memory-heading subtrees retain source identity, revision and hash. Missing or failed sources remain inspectable but do not enter new execution context. Synchronization does not crawl the home directory or translate arbitrary material.

Source paths can be absolute or relative to the project's workspace, such as `docs` or `README.md`. Synchronization indexes eligible formats and excludes private configuration and credential paths. If a missing directory later becomes available, synchronize again to replace its missing-source placeholder with the current documents.

Expand a source to edit its path, kind, role tags or memory section, or remove its registration. Changes invalidate its former current context immediately; source files, lessons and frozen historical run context remain intact. Synchronize after an edit to establish the revised current content.

Search by title/content with role/type filters. New work selects task-relevant passages with source locations; an execution’s **Sources used** disclosure shows its frozen guidance, evidence, selection gaps and later search/read records. A matching deep section is read at that location. No match does not substitute the first documents. Required guidance stays complete; use a deliberate section when a large source contains only one applicable contract. The project’s root AGENTS.md defaults to guidance; other sources default to reference. These are readable source choices, not tuning weights. Retain verified lessons with the source run; do not turn every model sentence into project memory. A lesson or process improvement still needs supporting evidence. Archive an obsolete lesson to exclude it from new context and work, then use the archived-lesson view to inspect or restore it. Archive is reversible and leaves earlier frozen goal/run context intact, including continuations that reuse that basis. Start a new outcome or deliberately refresh its configuration basis to use current knowledge. Source registration edits/removal handle source-backed entries; neither a model nor synchronization silently retires lessons. The default knowledge workflow proposes a lesson for review; an authorized writer or owner must save it through Add lesson.

Opening a lesson's source execution and returning preserves the selected knowledge entry and filters. A confirmed save remains saved even if the following metadata refresh fails; use Refresh to observe it rather than submitting the mutation again. Pipeline and Settings drafts are protected on navigation, and stale revision errors preserve the draft for reconciliation.

Project-agent suggestions appear under **Proposed lessons** and are excluded from new tasks. Review the original, optionally revise the useful statement, then retain or decline it. Feedback such as outdated or conflicting evidence is recorded separately. Confirm a relationship only between exact versions; a later source revision does not inherit an older conflict automatically. Archive/restore applies to retained lessons, never bypasses proposal review, and leaves old executions unchanged.

## Reuse a role or workflow

Use **Save as template** on a project role/workflow to create a local reusable contract. It opens the maintained role or workflow editor; ordinary work still needs no template setup or JSON. The source version is recorded, and saving does not bind or change the original project object. The purpose and role responsibility are separate fields.

Open **Reusable templates** from Projects to inspect a version before using it. Role details show responsibility and declared model/effort defaults: **Not specified by template** differs from **Inherit default**, and effort labels retain their native English names. Workflow previews show compact stage names, roles and check counts; expand the selected contract when needed. Choose the target project and **Use in project**, then select the project definition or prepare a new one. Map missing roles or external targets. Requirements describe needed capabilities; they do not grant permissions. Review actual access in **Team** when required.

A bound object's primary source row identifies its reusable template/version and project choices. Its original creation source remains in details. Loading or unavailable binding data is reported without guessing an unbound or built-in source; legacy objects without provenance remain unidentified. **View update** compares the bound base, current project and selected template revision. Inspect **Changes to apply**, **Project choices to keep** and any unresolved conflicts. Choosing a value moves that conflict to its resolved group. Kept fields show actual project values, including inherited model selection and the saved effort.

Project ownership persists even when a value equals the new template default. Use **Use template management** only when you want that field to follow reviewed template changes. Applying never updates other projects or earlier frozen work. Current child-workflow and GitHub targets stay local unless explicitly remapped. Retiring a template prevents new installs/upgrades while existing pins remain readable. A successful Apply stays acknowledged if refresh fails; refresh observes the saved result instead of applying again or forcing navigation to a project.

The local GUI walk-through covered template creation, installation, revision publication and conflict review with an explicit project effort retained. Stale-version/CAS rejection, permission scope and fault recovery are established by model-free tests, not claimed as live GUI or provider checks.

## Private API and runtime settings

The browser and CLI use the same local APIs. The browser has a same-origin HttpOnly session. The CLI reads GWI's private owner token; task-scoped MCP connections never receive that token.

```sh
npm run gwi -- status
npm run gwi -- projects
npm run gwi -- request GET /api/projects/PROJECT_ID
```

Replace `PROJECT_ID` with a local project identity. `gwi request METHOD /api/path --file PRIVATE_INPUT_FILE` reads a private request body. See the [API reference](API.md) for request formats and revision checks. Keep API responses containing paths, knowledge or settings local.

| Setting | Effect |
| --- | --- |
| `GWI_DATA_DIR` | Private application state; default `.local/state`. Use the same value for server and CLI. |
| `GWI_PORT` | Loopback port; default `4318`. |
| `GWI_URL` | CLI endpoint; default `http://127.0.0.1:4318`. |
| `GWI_MULTICA_CONNECTION` | Optional private Multica connection file. Normal setup is discovered automatically. |
| `GWI_CODEX_BIN` | Native executable for discovery, adoption and compatibility work. The Multica daemon has its separately verified executable. |
| `GWI_CODEX_MODEL` | Inherited model default; explicit role selections take precedence. |

For a persistent native executable/default model, the private data directory can contain `runtime.json` with `codexBinary` and optional `defaultModel`. Use a real catalog model and an absolute executable path. Restart after changing runtime selections. Never publish that file, credentials, user sources, transcripts, audit exports or captures.

## When work stops for a decision

Use the affected step's **Retry this step / Do not retry** actions. If an actual account uncertainty or execution-bound change needs approval, the same location offers **Approve / Reject** with the relevant evidence. GWI checks the previous execution before retrying; separate status-refresh and retry decisions are unnecessary. Add instructions in the visible note field when the next attempt needs more direction. Accepted upstream results are retained.

A refusal stops further work on that outcome and keeps its recorded results. A paused pipeline must be explicitly resumed; this does not erase its failed attempt. Completed outcomes expose history, not live retry controls. If external termination still cannot be confirmed, GWI retains the blocker and offers a bounded check instead of starting another copy.

Account observations refresh quietly. An old healthy reading does not require a manual quota refresh or approval; execution checks the actual account again. Real exhaustion and an unavailable account remain explicit decisions. Old execution quota fields remain historical evidence and do not require an extension approval.
