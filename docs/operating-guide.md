# Operating GWI

## Connect a project

After [local setup](multica-setup.md), start GWI and open `http://127.0.0.1:4318`. Projects is the top-level entry. A project has its own workspace, team, pipelines, knowledge and configuration; GitWorld and GWI can be managed independently.

Choose an existing local workspace. Add a GitHub repository binding when the work needs it. Codex-assisted adoption reads bounded eligible sources and proposes project guidance, registered knowledge and workflows. Review the sources and proposal before applying it. Applying a configuration does not start project work or synchronize knowledge.

**Connect manually** creates the project with reusable defaults without a model scan. Repository binding and description are optional; team and workflow settings remain editable afterward.

## Start and follow work

In the project **Workbench**, describe what should change and how you will recognize a useful result. Running a saved pipeline opens a short dialog for this concrete outcome; cancelling or leaving it empty starts no work. Ordinary starts inherit the project and role settings. Inspect the role/model summary when useful; attempt/time bounds and native permissions are advanced controls, not required launch fields. Codex allowance shows the actual account windows, remaining percentages and reset times; Refresh reads them without starting a model task.

A general outcome records one bounded coordination decision at a time. The coordinator can select several workflows or retry a failed owned stage from new evidence. GWI waits for their actual results before another decision. Inspect the reason, selected actions and remaining allowance; a successful provider task is not outcome acceptance.

Open an action to see its steps and activity timeline. Selecting a step shows its owner, checks, actual result and permitted controls. Switch to the graph when dependencies or branches need inspection. Activity updates preserve selection and let you pause following while reading earlier events. **Inspect changes** reads the execution checkout's tracked diff and status. Relative text artifacts can be previewed without executing their contents. Technical details retain execution references, usage and the frozen basis.

Only a recorded running stage has a moving blue border. Waiting, paused, completed and editing states stay still; a paused run can still have an in-flight stage finishing. The reduced-motion style retains a static state border and label. Execution details identify the Multica task and native session. These jobs are separate from chats in the Codex desktop app; GWI currently has no desktop-chat bridge.

Work uses committed-source checkouts, not the original dirty working directory. Each run records its actual input commit. Dependencies must be installed inside that checkout when required; source, ignored configuration and dependency directories are not shared by a writable link. A configured delivery role or the supervising owner must integrate or publish the accepted result. Inspecting an artifact does not perform that operation.

An independent QA stage can use a disposable copy of the actual prepared source, including eligible untracked files and deletions. Its input manifest is recorded. A no-model permission probe must demonstrate writes in the copy and denied writes to original source before dispatch. Test/build output may be written in ignored build/cache paths or `.gwi-verification/` scratch; changing its included source invalidates the review. This is task-scoped write confinement, not filesystem read isolation or a network domain allowlist. Unavailable browser, CI or dependency checks remain explicit work for a capable runner or the owner delivery gate.

## Review, return and stop

A manual stage waits for a recorded result. A review gate waits for an acceptance or revision decision. Attach a concrete finding to the work; bounded rework invalidates affected downstream stages and preserves independent accepted work and older attempts.

**Pause** stops further dispatch while current work may finish. **Resume** releases eligible stages. **Stop** requests cancellation of owned work; stopping GitHub observation does not cancel external CI. A running agent can receive supplementary guidance when its actual runtime supports it. A pending receipt is not confirmation that the instruction was delivered.

A failed stage can be retried from its recorded scope. If external execution is uncertain, use **Check external state** first. Preparation that stopped before assignment is recorded as not dispatched. A lost assignment response remains uncertain until an exact existing task can be identified; the platform does not blindly repeat the POST.

Ordinary starts and continuations use the account's remaining allowance together with recent comparable task executions. You do not enter or refill a token quota. GWI collects before/after account observations during real work and shows a range and direction once at least three comparable samples exist. With no history, it says that samples are needed. This account is shared with your other Codex sessions; observed changes are estimates, not exact charges for one task.

**Continue** preserves completed work and earlier attempts. At an actual attempt/time/round boundary, inspect the concrete one-step recommendation before approving it. If the account is exhausted, wait for its actual reset or refresh. If the observation is unavailable or the trend suggests little room, an explicit one-step owner decision can proceed within the other limits; it cannot override a known exhausted account. You can stop a continuation while its account check is pending. Unknown external execution must be reconciled before replacement work. Manual stages need no Codex allowance. Stopped gaps and human review/manual waits do not count as model-execution time.

Token counts remain under technical details, alongside their original configured values and missing-meter status. Old counters are not converted into percentage history; an ordinary continuation can adopt account-aware policy while retaining its original snapshot. Explicit token caps remain an expert API safeguard. Capacity recovery is off by default, finite when enabled, and uses only selected fallback models. Permission failures, ordinary blocked tasks and unknown cleanup are not capacity failures. GWI does not infer fees or purchase credits.

## Adjust pipelines and teams

The **Pipelines** library separates reusable definitions from executions. Start with **Focused change** for a known bounded increment, or use the longer product, operations and knowledge templates when their handoffs are useful. The editor shows the stage sequence first; select a step to change its action, responsibility or checks. Use the graph for dependencies and the advanced definition for conditions, child work and return paths. Publishing a revision affects future runs; it does not overwrite older execution bases. Ordinary project work does not require creating a new workflow.

Process proposals record a definition revision, rationale and supporting run. Inspect them before applying. Stale revisions are rejected. Local configuration changes remain private; do not publish actual project, pipeline or role settings as examples.

In **Team**, role contracts describe responsibilities, inputs, outputs and acceptance checks. Select actual agents, skills, tools and runtimes. A shared agent is a template for a project copy. Materialized role agents are immutable; use role settings to create another revision. Project custom templates can be edited. Native configuration that may contain credentials is write-only in the browser.

If a batch role import stops partway through, confirmed roles are already saved. The form reports progress and retains only the remaining roles; correct those entries and retry. Do not resubmit the original batch.

GWI control-tool permissions and native file permissions are separate. Each worker gets only its selected project-scoped control capabilities. The verified native runtime governs filesystem access and network behavior. Read-only instructions alone do not establish enforcement; see the setup guide for the tested policies and their limits.

## Maintain knowledge

In **Knowledge**, register deliberate local sources and relevant roles, then synchronize. Supported text documents and selected memory-heading subtrees retain source identity, revision and hash. Missing or failed sources remain inspectable but do not enter new execution context. Synchronization does not crawl the home directory or translate arbitrary material.

Source paths can be absolute or relative to the project's workspace, such as `docs` or `README.md`. Synchronization indexes eligible formats and excludes private configuration and credential paths. If a missing directory later becomes available, synchronize again to replace its missing-source placeholder with the current documents.

Search by title/content with role/type filters. Worker context uses bounded excerpts while the full indexed content remains available in the knowledge view. Retain verified lessons with the source run; do not turn every model sentence into project memory. A lesson or process improvement still needs supporting evidence.

Opening a lesson's source execution and returning preserves the selected knowledge entry and filters. A confirmed save remains saved even if the following metadata refresh fails; use Refresh to observe it rather than submitting the mutation again. Pipeline and Settings drafts are protected on navigation, and stale revision errors preserve the draft for reconciliation.

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
