# Local control API

UI and agents use the same versioned objects from `src/contracts.ts`. The server binds to `127.0.0.1`; default port is 4318. Actual configuration, knowledge and event data are private local state.

Browser requests use a same-origin HttpOnly session established by `GET /api/session`. Agent clients send the bearer token from the private runtime token file. Never put a token in a URL. Mutations reject an unexpected Origin or Host. JSON errors use `{error:{code,message,details?}}` and preserve existing state.

The server resolves its Codex executable from `GWI_CODEX_BIN`, then `codexBinary` in the private `GWI_DATA_DIR/runtime.json`, then `codex` on `PATH`. Runtime JSON accepts an absolute `codexBinary` value and optional `defaultModel`; the model must be an ID from the installed Codex catalog. `GWI_CODEX_MODEL` overrides that runtime default; an explicit role model overrides the default. The default data directory is ignored `.local/state`; no actual runtime file or machine path is shipped. Restart the server after changing these settings. See [runtime settings](operating-guide.md#private-api-and-runtime-settings).

| Method and route | Input and result |
| --- | --- |
| `GET /api/overview` | `{projects: ProjectOverview[], integrations: IntegrationInfo, events: AuditEvent[]}` |
| `GET /api/workspace` | Lightweight authorized project identities, root work, exact human decisions, audit sequence and observation time; excludes configuration/knowledge snapshots. |
| `POST /api/projects` | `{name,description,workspace,repository}` → `Project` with initial role/workflow templates |
| `GET /api/projects/:id` | `ProjectDetail` |
| `PUT /api/projects/:id` | `{expectedRevision,project:Project}` → next `Project` revision |
| `PATCH /api/projects/:id/bindings` | `{expectedRevision,bindings:{name,description,workspace,repository}}` → next `Project`; changes only the supplied binding fields and preserves roles and sources |
| `GET /api/projects/:id/readiness` | Model-free `ProjectReadiness`: committed Git input and registered-source indexing observations |
| `GET /api/integrations` | `IntegrationInfo` |
| `GET/POST /api/account-allowance` | Project/task context → sanitized `AllowanceAssessment`; POST `{refresh:true,...context}` refreshes the read-only native account observation. |
| `GET /api/projects/:id/skills` | `{skills:[{name,path,description}]}` discovered for this workspace |
| `POST /api/pipelines` | `{projectId,name,description,roleId,template?}` → `Pipeline`; optional template is `focused`, `product`, `operations`, `role` or `knowledge` |
| `PUT /api/pipelines/:id` | `{expectedRevision,definition:Pipeline}` → next pipeline revision; validates roles and DAG |
| `POST /api/pipelines/:id/proposals` | `{expectedRevision,definition,rationale,runId?}` → `Proposal` |
| `POST /api/proposals/:id/apply` | `{}` → updated pipeline; fails on stale proposal basis |
| `POST /api/projects/:id/knowledge/sync` | `{}` → `KnowledgeSyncResult` |
| `GET /api/projects/:id/knowledge?q=&role=&kind=` | `{entries:KnowledgeEntry[]}` |
| `POST /api/projects/:id/knowledge/lessons` | `{title,content,roles,runId?}` → local lesson entry with source run |
| `POST /api/runs` | `StartRunInput` → `Run`; required idempotency key deduplicates starts |
| `GET /api/runs/:id` | `{run:Run,events:AuditEvent[]}` |
| `GET /api/runs/:id/recovery?stageId=&resourceMode=account` | `RunRecovery`: current failed scope, allowance, readiness and a finite continuation recommendation when needed |
| `POST /api/runs/:id/continue` | `{stageId,recoveryKey,note?,resourceMode?,approveRecommendation?,approveAccountStep?,accountAssessmentKey?}` → `Run`; continue only the selected stage under the current recovery and account assessment |
| `POST /api/runs/:id/cancel` | `{note}` → run with cancellation/interrupt requested |
| `POST /api/runs/:id/stages/:stageId/complete` | `{output:TaskOutput}` → updated run; human/manual work only |
| `POST /api/runs/:id/stages/:stageId/review` | `{decision:"accept"|"revise",note}` → run; retries preserve earlier attempt |
| `POST /api/runs/:id/stages/:stageId/retry` | `{note}` → run; bounded explicit retry after failure/interruption |
| `POST /api/runs/:id/stages/:stageId/steer` | `{text}` → active-turn steering result |
| `GET /api/events?projectId=&runId=&after=` | `{events:AuditEvent[]}` in sequence order |

Configuration and pipeline updates require their exact `expectedRevision`. Stage/run IDs and role IDs are stable identifiers independent of display language. Running work uses the captured configuration and knowledge, not later edits. All mutations append an audit event with actor and scope.

Saved-pipeline launch requires a concrete `goal`; its name or description is not an outcome. `baseline` may be omitted: the server derives the committed input revision, or records the project configuration for human-only work without Git. Model-backed starts require the selected Git repository root and a committed HEAD. Nested human-only pipelines bypass this check; missing or unresolved child references cannot establish that a workflow is human-only. Workers recheck before model dispatch, and execution checkouts retain their actual source commit. GWI never initializes, stages or commits source as setup. New ordinary starts use `resourceMode:"account"`. Existing pipeline snapshots and stored token counters are preserved; the run's resource policy is separate. Owner-only attempt, time and iteration overrides remain finite.

`ProjectReadiness` contains `projectId`, `projectRevision`, `observedAt`, `workspace` and `knowledge`. Workspace `status` is `ready`, `blocked` or `unavailable`, with `code` (`READY`, `WORKSPACE_UNAVAILABLE`, `GIT_UNAVAILABLE`, `GIT_REPOSITORY_REQUIRED`, `GIT_ROOT_MISMATCH`, `GIT_COMMIT_REQUIRED`, `GIT_INSPECTION_FAILED`) and a `sourceCommit` only for a verified committed root. Knowledge `status` is `not_configured`, `not_indexed`, `indexed` or `issues`, with `configuredSources`, `indexedSources`, `currentEntries`, `missingEntries`, `errorEntries` and optional `lastSyncedAt`. A private synchronization receipt distinguishes an empty directory successfully indexed from a source never indexed. This reports the recorded indexing result, not a fresh content scan or runtime/account/permission guarantee; no-source projects are valid.

Editing or removing a knowledge source invalidates its affected current entries immediately with `status:"error"` and `errorCode:"SOURCE_CONFIGURATION_CHANGED"`. Content, provenance and earlier frozen run/goal knowledge remain readable. Unrelated sources and lessons stay current. Synchronization replaces this diagnostic with its actual source result; successful entries no longer carry the code. The existing full-project PUT remains compatible, while the narrow bindings PATCH rejects role/source fields and stale revisions.

## Account-aware allowance

`GET /api/account-allowance` accepts `projectId` and optional `pipelineId`, `stageId`, `runId` or `intakeId`; an intake assessment may include a coordinator `model` override. POST uses the same context with optional `refresh:true`. Scope is validated against the actual project, pipeline and run. Refresh reads the installed Codex app-server using existing authentication and makes no model call. Responses contain no credential, account identity, contact details, credit balance or raw provider payload.

`AllowanceAssessment` contains `key`, `status` (`ready`, `learning`, `caution`, `exhausted`, `unavailable`), `code`, `action` (`continue`, `wait`, `owner-step`), `account`, `trend`, `target` and `activeExecutions`. `account` includes sanitized window identity, duration, used/remaining percentage, reset timestamp, observation and expiry times. Prefer native `rateLimitsByLimitId`; missing windows remain unavailable. Cache ordinary reads for up to sixty seconds and invalidate across a reset. Never convert token counts into subscription allowance.

The private execution ledger records before/after observations around real dispatched work. Trends require at least three valid comparable executions of the same project, task/stage, role, model and effort. Resets, account changes, stale readings, missing windows and overlapping GWI work invalidate a comparable delta. Rounded zero change has measurement uncertainty; it does not prove free execution. The shared account can also be used outside GWI: ranges and direction describe observed changes, not exact task charges or a guaranteed task count. Old token-only history is not backfilled into percentage history.

A fresh exhausted account blocks new model work, including explicit expert token mode. Manual stages need no account read. Missing/stale data or a caution assessment requires a deliberate bounded owner step using `approveAccountStep:true` and the exact `accountAssessmentKey`. This grant is tied to the observation and execution generation, consumed once, and invalidated by Stop or changed state. It cannot override known exhaustion or unresolved external execution. The final admission and observation reservation are serialized across projects before paid dispatch; another parallel task cannot reuse the same estimated remainder. Time, attempts, rounds, concurrency and finite executor safeguards still apply.

`RunRecovery` retains `action`, `code`, `recoveryKey`, scope, attempt/time bounds and diagnostic `allowance`; account-aware responses add `resourceMode`, `account` and `accountAcknowledgementRequired`. `approveRecommendation:true` approves a displayed finite attempt/time increment. Unknown external execution returns `EXTERNAL_RECONCILIATION_REQUIRED` and must be reconciled first. A pending continuation can be cancelled before dispatch; stopping invalidates its recovery generation.

UI continuation explicitly selects account mode. An owner may migrate a stopped legacy token-policy run by supplying `resourceMode:"account"`; earlier snapshots, usage and revisions stay intact. `resourceMode:"tokens"` and explicit token caps remain expert API options. Explicitly mixing account mode with a new raw token cap is rejected. In token mode, worker grants remain disjoint and missing usage stays held until confirmed; native reporting/cancellation can lag. Those technical counters do not establish remaining account allowance. The existing `/limits` and stage `/retry` routes remain available.

## Integrated execution and supervision

With a verified Multica connection, new agent stages and bounded goal decisions use Multica. GWI owns the dependency, review and loop state; a terminal provider task is not product acceptance. The native adapter remains available for recorded legacy work, discovery and project adoption. [Local setup](multica-setup.md) installs the separately licensed dependency; actual connections and profiles stay private. `GWI_MULTICA_CONNECTION` can select a private connection file.

| Method and route | Input and result |
| --- | --- |
| `GET /api/platform` | Sanitized backend availability, authentication and version; never the connection token. |
| `GET /api/projects/:id/team` | Roles, actual agents/skills/runtimes/MCP metadata, project-owned and immutable agent IDs, and connection capabilities. Native credential-bearing configuration is write-only. |
| `POST /api/projects/:id/team/prepare` | Prepare actual project role agents without starting a model task. |
| `POST /api/projects/:id/team/roles` | `{expectedRevision,role}` creates a role and its project agent revision. |
| `PUT /api/projects/:id/team/roles/:roleId` | `{expectedRevision,role}` creates a new role basis; existing run agents remain immutable. |
| `POST /api/projects/:id/team/roles/:roleId/duplicate` | `{expectedRevision}` creates a project role copy. |
| `DELETE /api/projects/:id/team/roles/:roleId` | `{expectedRevision}` retires the role; history remains. |
| `POST /api/projects/:id/team/agents` | Native agent fields create a project custom template. |
| `PUT /api/projects/:id/team/agents/:agentId` | Edit a project custom template; shared or immutable role-revision agents are rejected. |
| `GET/PUT /api/projects/:id/team/agents/:agentId/skills` | Read bindings or replace them with `{skillIds}`. |
| `POST /api/projects/:id/team/skills` | `{name,description,content}` creates an actual skill. |
| `GET/PUT /api/projects/:id/team/skills/:skillId` | Read/update the actual skill content. |
| `POST /api/projects/:id/team/mcp-servers` | `{name,config}` creates a write-only MCP connection. |
| `PUT /api/projects/:id/team/mcp-servers/:serverId` | Replace connection configuration; bound agents share that library connection. |
| `GET/POST /api/projects/:id/team/agents/:agentId/mcp-servers` | Read connections or bind `{serverId}` to a project custom agent. |
| `PUT/DELETE /api/projects/:id/team/agents/:agentId/mcp-servers/:serverId` | Set `{enabled}` or remove the binding. |
| `POST /api/runs/:id/pause` | `{note}` stops further dispatch; existing work may finish. |
| `POST /api/runs/:id/resume` | `{}` releases eligible queued stages without replaying accepted work. |
| `GET /api/runs/:id/executions` | Recorded external task identities, usage, state and cleanup confirmation. |
| `POST /api/runs/:id/stages/:stageId/reconcile` | Observe the existing assignment. A coordinator uses `supervise`; no replacement task is dispatched. |
| `GET /api/runs/:id/changes` | Actual tracked diff/status and committed input revision from the isolated execution checkout. |
| `GET /api/runs/:id/artifacts?path=RELATIVE_PATH` | Plain-text preview, up to 512 KiB, inside that execution checkout; private paths and symlink escapes are rejected. |
| `POST /api/runs/:id/limits` | `{expectedRevision,limits,note}` extends finite token/attempt/iteration/time limits of a stopped pipeline. Keeps its original snapshot, usage and attempts; does not start work. |

Team/capability changes and limit extensions require the local owner. Role-selected native templates are copied; their original shared agents are not overwritten. `role.multica` can select `agentId`, `runtimeId`, `skillIds` and `mcpServerIds`. Native model execution requires the selected verified runtime, not merely an online process or a permission-profile name.

Executions use standalone checkouts of committed source. Dirty/untracked/ignored files and installed dependency directories are not copied. Each run records the actual source revision. Relative artifacts and diffs are evidence for inspection; they do not establish publication.

Task-scoped `POST /mcp/control` uses a short-lived bearer capability for the frozen role's allowed tools and project. The owner token is never placed in agent configuration. The GWI connection is explicitly preauthorized for those selected capabilities; unrelated MCP servers retain their own approval policy. Revocation, expiry, project scope and role permissions are checked on calls. File permissions remain governed by the native runtime.

Codex stages may set `executionPurpose:"review"`. A legacy stage owned by the canonical read-only `qa` role derives that purpose at execution; planner decisions do not. Review captures the current prepared checkout, including tracked changes/deletions and eligible nonignored untracked source, in an independent disposable copy. Before assignment, a model-free guard probe must prove scratch writes and deny write opens against original execution, project and sibling files. The task-only agent uses `gwi-workspace`; permanent roles and frozen snapshots remain unchanged. Input SHA-256 manifests, scope proof and post-run source integrity appear in `verification.prepared`/`verification.checked` events and execution records. Unsafe scope or source mutation rejects the result without a full-access fallback. Unknown tasks retain their copy until reconciliation; ended copies are removed while audit metadata remains.

`team.capabilities.verification.available` describes support prerequisites and `requiresProbe:true`, not a completed per-task proof. Native read isolation and network domain restriction are not provided. Execution capability reports an unknown native task limit when no trusted runtime ceiling is published; the configured observation/cancellation deadline is a separate value. A larger GWI timeout does not establish that a native daemon can run that long. New starter stages use a five-minute configured deadline. Dependency installation and browser checks are not inferred from source review; pending required checks remain part of owner delivery acceptance.

New goal decisions run once, return structured actions and end before GWI waits for human/CI outcomes. Continuation notes, actual remaining limits and role permissions enter the next decision. Provider preparation failure is distinct from an uncertain assignment: `not_dispatched` confirms no task was created; an unknown issue POST remains unrecoverable until its external state is reconciled. Steering returns the actual supplement receipt; `pending` is not `delivered`.

`scripts/gwi.mjs` supplies a local CLI for Codex and other agent clients. Its `request METHOD /api/path` command reads JSON from stdin or a private file. Public examples contain no real project configuration.

# Goal entry

- `POST /api/projects/:id/intakes`: `{request, baseline?, idempotencyKey, parentIntakeId?, policy?, resourceMode?, approveAccountStep?, accountAssessmentKey?}` creates a supervised goal. It does not require a role or pipeline selection. Optional `parentIntakeId` links a follow-up to a completed result in the same project; active, failed, stopped or unconfirmed work cannot be bypassed this way. Idempotency includes this parent identity.
- `GET /api/projects/:id/intakes`: returns persisted goals and decision rounds. Project detail also includes `intakes`.
- `POST /api/intakes/:id/cancel`: `{note}` records a stop and cancels owned work.
- `POST /api/intakes/:id/retry`: `IntakeRetryInput` continues the same goal through a fresh bounded coordinator after cleanup, child-state and model-catalog checks. Read responses expose `canRetry` and `retryBlockedReason`.
- Goal policy bounds `maxRounds`, `maxParallel` and `maxElapsedSeconds`. Account-aware work records `maxTotalTokens` as legacy diagnostics; explicit expert token mode still enforces it. A decision can dispatch existing workflows, retry a specific failed owned stage, complete, clarify or stop. The Multica coordinator returns one validated structured decision; GWI applies it and waits without keeping a model turn alive. Recorded legacy native-goal runs instead use the project-scoped `intake.route` tool.

Restart and continuation behavior is specified in the [goal recovery contract](goal-recovery-prd.md). Recovery must be an explicit action based on recorded execution references, not an automatic replay of previously dispatched work.

Follow-up `Intake.parentIntakeId` is a discussion link, separate from execution parentage, retry and accounting families. A frozen `conversation` in its configuration basis and execution snapshots contains recent requests/results, source intake/run IDs, result kind, date, basis revision and up to four recorded clarification replies per turn. It marks omitted clarification pairs as well as excerpts. It retains at most four turns within 24,000 serialized characters, marks any excerpt and counts omitted earlier turns. Read responses expose this context; clients cannot supply its contents. Native/connected coordinators and delegated workers receive it as historical reference data, never as additional authority or current-state proof. Existing completed records, approvals and consumption remain unchanged; follow-ups use current project configuration and ordinary admission.

A clarification reply uses the existing `/retry` endpoint with a nonempty `note`, current recovery key and normal account approval when required. It retains the same Intake and cumulative boundaries. Manual continuation records carry `replyToQuestion` when replying to a question. Native and connected planners receive that current question/reply separately from bounded older history. A blank clarification reply is rejected before dispatch. Read responses expose `continuationPending:true` while an existing continuation is being checked; the inline reply remains visible and cancellable through the normal stop endpoint until its receipt or failure.

`IntakeRetryInput` is `{note?,model?,refreshConfiguration?,policy?,recoveryKey?,approveRecommendation?,resourceMode?,approveAccountStep?,accountAssessmentKey?}`. Ordinary continuation uses account mode and a useful recorded default note; caution/unavailable readings also need the current explicit one-step account approval. Read responses expose `allowance`, `retryBlockedCode`, `retryBlockedScope`, an optional failed `retryBlockedStageId`, `recoveryKey` and `recoveryRecommendation`. The recommendation supplies a finite same-scope attempt/time policy and its recorded basis; `{approveRecommendation:true,recoveryKey}` approves it without estimating raw token values. Stale approval fails before execution.

Advanced owner-only `policy` can extend `maxRounds` or `maxElapsedSeconds` (and `maxTotalTokens` in explicit token mode) and set `recovery: {autoRetry,maxAttempts,backoffSeconds,allowedFallbackModels}`. Explicit extensions remain available when the previous allowance is exhausted. Defaults keep the prior configuration basis and known model; a model override affects the coordinator, while delegated roles retain their project settings. Explicit configuration refresh creates a new future basis. Earlier snapshots, decisions, runs and cumulative consumption are preserved. Duplicate active recovery, completed goals, unknown external cleanup or active children are rejected.

Known child-pipeline attempt/time or account-admission holds stop coordination before another paid decision. Token ceilings also apply to explicit token mode. Their code and run scope direct the user to that failed stage. If both the outcome and a child are exhausted, a same-scope outcome approval may save an audited `Intake.limitRevisions` entry without starting a coordinator; the child still needs its own explicit continuation. Successful coordinator recovery records requested/actual policy changes and any approved recommendation in `recoveryHistory`. No approval automatically extends both scopes. Exhausted action rounds still permit a final acceptance decision; an attempted additional action records `GOAL_ROUND_LIMIT` and offers a finite additional round when available.

Capacity recovery is off by default and accepts only the recognized provider capacity code or precise native capacity message. Attempts and backoff are bounded; model fallback uses only the explicit allowed pool and actual catalog. Automatic recovery does not refresh configuration or extend limits. History retains previous/new run IDs and actual execution references, requested/actual model, basis revision, trigger, reason and explicit policy changes. Actual provider recovery is separate acceptance evidence.

`executionTimeMeter: "active-windows-v1"` measures merged supervisor/owned-action execution intervals, including scheduled backoff and counting concurrent intervals once. Stopped/failed idle time is excluded. Read responses expose `executionTime.usedSeconds`, `remainingSeconds` and wall-clock `totalElapsedSeconds`; `createdAt` remains the original timestamp. Recovery forwards the remaining cumulative execution-time allowance. Account-aware executors use a separate finite technical per-attempt token guard; explicit token mode also forwards the remaining cumulative token allowance.

## Project adoption

| Method and route | Input and result |
| --- | --- |
| `POST /api/adoptions` | `{workspace,name?,repository?,idempotencyKey}` → `Adoption`; starts one bounded project-source scan and Codex setup analysis. |
| `GET /api/adoptions` | `{adoptions: Adoption[]}` for the local owner. |
| `GET /api/adoptions/:id` | Current proposal, revision, inspected sources, omissions, native references and errors. |
| `POST /api/adoptions/:id/apply` | `{expectedRevision}` → `Project`; applies the reviewed proposed revision through normal Engine configuration APIs. |

Adoption routes require the local owner and the ordinary authentication/Host/Origin checks. Reusing an idempotency key with identical scan inputs returns the existing record; changed inputs conflict. Apply revalidates source hashes and the exact proposal revision. Changed evidence requires a fresh scan. Configuration writes and application checkpoints commit together; a partial installation retains its durable IDs for inspection and revision-checked retry. New Apply also makes one bounded local knowledge synchronization without model work, runs or CI. `application.phase` records `installing`, `indexing`, `completed` or `failed`; optional `application.knowledgeSync` records `status` (`pending`, `completed`, `failed`), `at`, result `stats` and an optional `error`. If configuration is installed but indexing fails, `status:"applied"` records that fact, the indexing failure stays inspectable and the existing project opens for Knowledge recovery. Restart marks unfinished installation/indexing honestly without automatically replaying work. Repeated Apply returns an already applied project without a second synchronization; older applied records are unchanged. Proposal and source contents remain private. Exported adoption types live in `src/adoption.ts`.

## Token accounting

`Usage` retains raw `input`, `output`, `total` and optional `cachedInput` counters. Diagnostics and explicit token-mode budgets use `max(0, input - cachedInput) + output` when a valid cached-input counter is reported; without it, they use `total`. Goal accounting includes owned descendant execution. The native goal's meter remains separately identified and is used as a fallback when detailed usage is unavailable. Missing usage is not a fabricated zero, and delayed reports cannot guarantee an exact pre-spend ceiling. These are token meters, not a currency estimate or a cache-clearing operation.

Each agent attempt uses a unique issue title and the explicit upstream duplicate allowance after the GWI execution guard. This does not authorize repeating an uncertain POST. Reconciliation can locate a lost assignment through its exact execution marker, provider project, agent and runtime; zero or ambiguous candidates stay unconfirmed. Finished issue metadata is synchronized only after task termination is confirmed. Metadata-update failure retains its desired state for a later check and never retries model work.

### Native reasoning effort

Role `effort` and connected-agent `thinking_level` accept `low`, `medium`, `high`, `xhigh`, `max`, `ultra`. New role/agent creation defaults to `max` when no explicit effort is provided. Updates preserve existing effort when omitted; duplicate/import operations preserve explicit source settings. Project serialization and Codex/Multica execution preserve the native value without substitution. This does not migrate private configurations or frozen snapshots; actual model availability and supported efforts are determined by the installed catalog and execution runtime.

## Informational request results

A coordinator can return `IntakeDecision` with `action:"answer"`, an empty `tasks` array and a nonempty `response` of at most 16,000 characters, alongside the usual concise `rationale` and `expectedGain`. This is a read-only informational result, not artifact delivery. It is rejected after any recorded dispatch/retry or actual ordinary delegated execution in the durable run family, including a child omitted from the target list. Current execution scope, Stop and authoritative completion/cleanup checks still apply. Native and connected planners use the same decision boundary.

After verified execution termination, the request has `status:"completed"`, `resultKind:"answer"` and its response in `outcome`; the final event is `goal.answered`. Existing requests and delegated `complete` decisions retain their prior semantics and acceptance checks. Viewing a completed coordinator's retained output on a failed historical request changes no persisted state and starts no model work.


## Global workbench projection

`GET /api/workspace` returns `WorkspaceSummary`. Project identities are restricted to the caller's authorized project list. Work is keyed by project, kind and ID; outcomes and independent executions are roots, while owned coordinator/child runs are not repeated. Every pending clarification, review, manual handoff and allowance decision retains its exact project/run/stage target. Roots entirely waiting on those decisions are marked `waitingForInput`; parallel active work remains visible. Goal router/control identities let clients distinguish an earlier observation from a continuation receipt.

The projection invokes no model or runtime discovery. Existing project-scoped request, run, recovery and review endpoints remain the mutation interface. Full detail is fetched only for the selected project. Global routes use `#/projects?project=PROJECT_ID&goal=INTAKE_ID` or `&run=RUN_ID&stage=STAGE_ID`; optional `filter=PROJECT_ID` controls observation only. Dedicated project routes retain their existing meaning.

Global summary and detail observations acknowledge their own receipts independently. Before the first successful summary, locally acknowledged work remains available with an explicit unavailable-summary state and no invented empty counts or observation timestamp. Late starts do not navigate after a newer interaction, including an A-to-B-to-A target switch or leaving the global shell.


### Work recovery

`POST /api/intakes/:id/resume` (local owner, empty body) records or reuses one pending work recovery and returns the Intake receipt immediately. It does not wait for cleanup or report a retry as completed. Observe `workRecoveryHistory` through the existing project/global detail refresh. Each record includes the exact run/stage/attempt, trigger, phase, cause code, counters, absolute confirmation deadline, next check and eventual retry/end timestamps. Earlier records remain immutable audit evidence except for their own lifecycle completion.

New Intake policies set `smartRetry:true`; absence on an older stored policy does not opt it into unattended work. Confirmation and retry use the same backend path and preserve source/account/permission checks. Pending recovery can be cancelled through the existing task Stop endpoint. Retry never extends an execution policy; limit changes remain explicit existing owner operations.
