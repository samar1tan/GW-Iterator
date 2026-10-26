# Operating GWI

## Start with a project and a goal

After [starting the app](../README.md#run-locally), open `http://127.0.0.1:4318` and choose **Create project**. Supply a name and an existing absolute workspace path. A GitHub repository binding uses `owner/repository`; it is needed for GitHub work. Initial role profiles and workflow templates are created with the project.

For an existing repository, **Adopt existing project** offers a reviewed setup route. **Scan with Codex** collects bounded eligible project documents and package metadata, then runs a read-only Codex task to propose role guidance, knowledge sources and starter workflows. Inspect the excerpts, hashes, exclusions and proposal before **Apply configuration**. Apply validates the saved source hashes and revision, creates local settings through the normal project APIs, and preserves any partial application for inspection. It does not start a goal, run CI or synchronize the proposed knowledge sources; use **Knowledge → Synchronize** when ready. The collection boundary is not a native filesystem-read sandbox: Codex retains its installed permissions.

Open the project and enter the desired outcome under **Set a goal** on **Pipelines**. A baseline is optional: use it for a relevant revision, URL or observation. **Run limits** sets decision rounds, parallel actions, total reported tokens and elapsed time. **Start goal** begins a real Codex native goal.

The supervisor reads the available project workflows and captured knowledge, records a concise reason and expected gain, and delegates specific actions. An action can involve several roles, human review or another pipeline. The supervisor waits for actual results before deciding again. You do not have to select a role, construct a DAG or register knowledge to submit a goal.

## Goal, pipeline, role and knowledge

| Object | Purpose |
| --- | --- |
| Goal | The outcome being supervised. Codex chooses actions, observes evidence and records completion, clarification or a stop. |
| Pipeline | A reusable workflow with explicit stages, dependencies, executors and limits. A goal can use several pipelines; you can also start one directly. |
| Run and attempt | A particular execution of a pipeline and its recorded stage attempts, outputs, reviews and references. Earlier attempts remain inspectable. |
| Role | Instructions, model/effort, selected skills, allowed GWI control tools and requested Codex sandbox for a stage. |
| Knowledge | Optional project context from explicit local sources and retained lessons, with role tags, hashes, revisions and provenance. |

The left navigation keeps **Pipelines**, **Knowledge** and **Configuration** within the selected project. **Projects** returns to the project list. The role filter narrows the current view; it does not create a different project or replace Codex's native sandbox.

## Follow the work

Select a goal from **Goals** to inspect each decision round, its reason, expected gain and **Runs and evidence**. **Inspect decision** opens the native supervision run. An action link opens the delegated workflow's stages, attempts, output and event trail. These links inspect existing work; they do not start another execution.

**Codex native goal** reports the native thread and status when available. **GWI result** records the supervised outcome. Assignment means an action was dispatched. Completion requires accepted delegated outcomes and a final native completion; it does not independently prove that an external change was published. Publication or live verification needs its own evidence.

Reported tokens can be partial or late. Missing usage is unavailable, not zero, and GWI does not invent fees. When Codex supplies cached input, the execution budget counts `max(0, input - cachedInput) + output`; otherwise it uses the reported gross total conservatively. Raw input, cached input, output and total remain evidence, and the native goal's own meter stays separate. This accounting does not clear a cache or estimate a currency cost. The execution-time limit merges active supervisor and owned-action intervals, counting parallel work once and including scheduled recovery backoff. Idle time after a failed or stopped execution is excluded; the original creation time remains visible. Review the saved limits when work stops at a boundary.

If a goal asks for clarification or supervision stops, inspect its recorded question, native/external references and existing results before starting further work. Interrupted execution is not silently replayed. See the [goal recovery contract](goal-recovery-prd.md) for explicit restart and continuation rules.

## Continue a goal

**Continue goal** starts a fresh owned native execution under the same GWI goal. It preserves earlier decisions, delegated outcomes, usage and configuration history; it does not reactivate a cleared native goal. The server enables continuation only after the previous execution and all owned actions are terminal and native cleanup is confirmed. A blocked control shows the reason. Completed goals cannot be retried.

Provide a continuation note. You can select a coordinator model from the discovered catalog, explicitly refresh the future configuration basis, or extend the recorded total token/execution-time limits. Leaving those options unchanged keeps the earlier basis and known model. A coordinator model override does not change delegated roles' model configuration. Consumption and execution time remain cumulative across recoveries.

**Capacity recovery** is off by default. Enabling it allows a finite number of fresh executions after confirmed native model-capacity failures, with backoff. The first retry keeps the known model; later switches use only your selected fallback pool. An empty pool permits no model switch. Ordinary blocked outcomes, generic rate limits, budget exhaustion and uncertain cleanup do not authorize automatic recovery. **Recovery history** links each earlier/new execution and records model, basis and explicit limit changes. These controls do not establish that an actual provider recovery has succeeded; inspect the recorded outcome.

## Controls that change execution

| Control | Actual effect |
| --- | --- |
| **Scan with Codex** | Runs the bounded adoption analysis and records a proposal for review. |
| **Apply configuration** | Installs the reviewed project setup; it does not start project work. |
| **Start goal** | Starts native Codex supervision, which can dispatch project workflows. |
| **Continue goal** | Starts a fresh native supervisor for the same goal after cleanup checks, with cumulative evidence and limits. |
| **Start run** → **Start** | Starts the selected pipeline with a purpose, baseline, captured knowledge and optional run dependencies. **Bounded loop** enables its configured iteration limits. |
| **Accept output** | Records review acceptance and releases eligible dependent stages. |
| **Request revision** | Records the finding and queues revision at the configured upstream target, within attempt limits. |
| **Complete task** | Records a human stage's structured result and evidence. It does not perform a deployment or publication command for you. |
| **Retry stage** | Requests another attempt after a failure or interruption. Supply what changed; earlier attempts and limits remain. |
| **Send input** | Sends steering to the actual active Codex turn. |
| **Stop goal** / **Cancel run** | Records a stop request and requests interruption of owned work. Inspect the resulting execution states; stopping a GitHub observation does not cancel external CI. |

A manual task waits for a recorded result. A stage marked **Review required** waits for a review decision. Select the stage to see the relevant control and provide its note or output. Native supervision runs are inspected and stopped through their goal; **Retry stage** applies to ordinary workflow runs.

## Adjust reusable resources

In **Configuration**, edit project bindings and role profiles. **Refresh skills** discovers installed skills for the workspace; select them and **Save** to include them in future execution. GWI tool permissions govern its project control API and are separate from Codex's native tool, sandbox and approval policy.

**Edit definition** opens a pipeline's JSON definition for stages, dependencies and limits. **Save** creates a new configuration revision; it does not launch work. **Apply proposal** creates a pipeline revision from a pending proposal. A stale revision is rejected: keep the draft, load the latest basis and reconcile. Goals and runs retain their captured configuration and knowledge; later resource edits apply to new work.

In **Knowledge**, **Register source** saves an explicit absolute local file or directory, its kind and relevant roles. For a shared memory Markdown file, enter the exact heading title to import only that heading's subtree. **Synchronize** reads supported text sources and reports added, changed, unchanged, missing and failed entries. It does not run a model or automatically translate imported material. Credential/configuration files, binary content, oversized inputs and paths that escape the declared boundary are rejected.

Search matches titles and content with role/type filters. Missing and failed entries remain visible for inspection but do not enter new context. **Retain lesson** stores a project finding and can link it to a run. Selecting an entry shows its content and provenance. Keep source selection narrow; the index is not a home-directory or agent-history crawler.

## Private API and CLI

The browser and CLI use the same local API. Browser access establishes an HttpOnly same-origin session. The CLI reads GWI's private runtime token from `.local/state/token`; it does not read Codex or GitHub credential files. API responses can include private settings, paths and knowledge, so keep their output local.

From the repository root:

```sh
npm run gwi -- status
npm run gwi -- projects
npm run gwi -- request GET /api/projects/PROJECT_ID
```

Replace `PROJECT_ID` with the ID from your local project list. To create a project through the CLI, replace the synthetic values below, including the workspace placeholder with an existing absolute directory:

```sh
npm run gwi -- request POST /api/projects <<'JSON'
{"name":"Example project","workspace":"/absolute/path/to/project","repository":"example/project"}
JSON
```

Submit a goal without selecting a workflow:

```sh
npm run gwi -- request POST /api/projects/PROJECT_ID/intakes <<'JSON'
{"request":"Check and correct inconsistent public documentation.","idempotencyKey":"example-goal-001"}
JSON
```

The `/intakes` API routes represent supervised goals. Reuse the same idempotency key only for a retry of the same request; different work needs a new key. Inspect goals with `GET /api/projects/PROJECT_ID/intakes`. Stop one with `POST /api/intakes/INTAKE_ID/cancel` and a JSON `note`.

Adoption uses `POST /api/adoptions` with `{workspace,name?,repository?,idempotencyKey}`. Inspect it with `GET /api/adoptions/ADOPTION_ID`; apply the reviewed result with `POST /api/adoptions/ADOPTION_ID/apply` and its `expectedRevision`. These are local-owner operations, and their responses contain private source excerpts and setup details. See the [API reference](API.md#project-adoption) for lifecycle and conflict handling.

`gwi request METHOD /api/path --file PRIVATE_INPUT_FILE` reads a private request body instead of stdin. Configuration updates require `expectedRevision`; pipeline/run IDs and role IDs are independent of display language. See the [API reference](API.md) for configuration, source synchronization, reviews, pipeline starts and tool scope. Project-scoped dynamic tools are available only when the selected role permits them; the local owner CLI can administer all local projects.

| Setting | Effect |
| --- | --- |
| `GWI_DATA_DIR` | Private state directory for the server and CLI; default `.local/state`. Use the same value for both. |
| `GWI_PORT` | Server port; default `4318`. The server remains bound to `127.0.0.1`. |
| `GWI_URL` | CLI loopback endpoint; default `http://127.0.0.1:4318`. Match it to a changed server port. |
| `GWI_CODEX_BIN` | Codex executable selected when the server starts; overrides the private runtime setting. |
| `GWI_CODEX_MODEL` | Runtime default model ID; overrides `defaultModel` in private runtime settings. Role-specific model selections take precedence. |

Keep runtime data outside public source and asset directories. Do not publish tokens, actual project/pipeline/role configuration, knowledge, transcripts, audit exports or captures. Public examples above are placeholders, not project seed data. Codex and GitHub authentication remains managed by their own installed tools.

## Select the Codex executable

The server uses `GWI_CODEX_BIN`, then `codexBinary` in `GWI_DATA_DIR/runtime.json`, then `codex` on `PATH`. Restart the server after changing this selection. To override it for one launch, use an executable placeholder replaced with your local path:

```sh
GWI_CODEX_BIN=/absolute/path/to/codex npm start
```

For a persistent local setting, create `runtime.json` inside the private data directory. Its supported fields are `codexBinary`, an absolute executable path, and optional `defaultModel`, a model ID from the installed Codex catalog used when a role inherits its model. A minimal placeholder example is `{"codexBinary":"/absolute/path/to/codex"}`. The default `.local/state/runtime.json` is ignored with the rest of `.local`; keep any custom data directory private as well. These are runtime selections, not Codex credentials. Do not commit the file or copy an actual machine path or private settings into public examples.
