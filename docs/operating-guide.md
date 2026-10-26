# Operating GWI

## Connect a project

After [local setup](multica-setup.md), start GWI and open `http://127.0.0.1:4318`. Projects is the top-level entry. A project has its own workspace, team, pipelines, knowledge and configuration; GitWorld and GWI can be managed independently.

Choose an existing local workspace. Add a GitHub repository binding when the work needs it. Codex-assisted adoption reads bounded eligible sources and proposes project guidance, registered knowledge and workflows. Review the sources and proposal before applying it. Applying a configuration does not start project work or synchronize knowledge.

## Start and follow work

In the project **Workbench**, describe what should change and how you will recognize a useful result. You can also run a saved pipeline directly. Ordinary starts inherit the project and role settings; models, skills and limits are deliberate configuration choices rather than required launch fields.

A general outcome records one bounded coordination decision at a time. The coordinator can select several workflows or retry a failed owned stage from new evidence. GWI waits for their actual results before another decision. Inspect the reason, selected actions and remaining allowance; a successful provider task is not outcome acceptance.

Open an action to see its stage canvas. Selecting a stage shows its responsibility, inputs, checks, actual result and permitted controls. **Inspect changes** reads the execution checkout's tracked diff and status. Relative text artifacts can be previewed without executing their contents. Technical details retain events, execution references, usage and the frozen basis.

Work uses committed-source checkouts, not the original dirty working directory. Each run records its actual input commit. Dependencies must be installed inside that checkout when required; source, ignored configuration and dependency directories are not shared by a writable link. A configured delivery role or the supervising owner must integrate or publish the accepted result. Inspecting an artifact does not perform that operation.

## Review, return and stop

A manual stage waits for a recorded result. A review gate waits for an acceptance or revision decision. Attach a concrete finding to the work; bounded rework invalidates affected downstream stages and preserves independent accepted work and older attempts.

**Pause** stops further dispatch while current work may finish. **Resume** releases eligible stages. **Stop** requests cancellation of owned work; stopping GitHub observation does not cancel external CI. A running agent can receive supplementary guidance when its actual runtime supports it. A pending receipt is not confirmation that the instruction was delivered.

A failed stage can be retried from its recorded scope. If external execution is uncertain, use **Check external state** first. Preparation that stopped before assignment is recorded as not dispatched. A lost assignment response remains uncertain until an exact existing task can be identified; the platform does not blindly repeat the POST.

A stopped pipeline and its supervising outcome have separate ceilings. **Extend limits** changes only that pipeline execution, retains usage and attempts, and records a reason and revision. Saving does not start work. The outcome's **Continue** control retains earlier actions and consumption; its note becomes evidence for the next coordination decision. Stopped gaps and human review/manual waits do not count as model-execution time.

Capacity recovery is off by default. An enabled policy is finite and can use only its selected fallback models. Permission failures, ordinary blocked tasks and unknown cleanup are not capacity failures. Missing usage is unavailable, not zero; delayed provider counters cannot guarantee an exact pre-spend ceiling. Token limits use reported uncached input plus output, retaining the original cache counters for inspection. GWI does not invent fees.

## Adjust pipelines and teams

The **Pipelines** library separates definitions from executions. Start with **Focused change** for a known bounded increment, or use the longer product, operations and knowledge templates when their handoffs are useful. In the visual editor, add stages, assign responsibility/actions, connect dependencies and configure checks, conditions, human gates or bounded return paths. Publishing a revision affects future runs; it does not overwrite older execution bases. Structured definitions remain available as an expert interface.

Process proposals record a definition revision, rationale and supporting run. Inspect them before applying. Stale revisions are rejected. Local configuration changes remain private; do not publish actual project, pipeline or role settings as examples.

In **Team**, role contracts describe responsibilities, inputs, outputs and acceptance checks. Select actual agents, skills, tools and runtimes. A shared agent is a template for a project copy. Materialized role agents are immutable; use role settings to create another revision. Project custom templates can be edited. Native configuration that may contain credentials is write-only in the browser.

GWI control-tool permissions and native file permissions are separate. Each worker gets only its selected project-scoped control capabilities. The verified native runtime governs filesystem access and network behavior. Read-only instructions alone do not establish enforcement; see the setup guide for the tested policies and their limits.

## Maintain knowledge

In **Knowledge**, register deliberate local sources and relevant roles, then synchronize. Supported text documents and selected memory-heading subtrees retain source identity, revision and hash. Missing or failed sources remain inspectable but do not enter new execution context. Synchronization does not crawl the home directory or translate arbitrary material.

Search by title/content with role/type filters. Worker context uses bounded excerpts while the full indexed content remains available in the knowledge view. Retain verified lessons with the source run; do not turn every model sentence into project memory. A lesson or process improvement still needs supporting evidence.

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
