# Local control API

UI and agents use the same versioned objects from `src/contracts.ts`. The server binds to `127.0.0.1`; default port is 4318. Actual configuration, knowledge and event data are private local state.

Browser requests use a same-origin HttpOnly session established by `GET /api/session`. Agent clients send the bearer token from the private runtime token file. Never put a token in a URL. Mutations reject an unexpected Origin or Host. JSON errors use `{error:{code,message,details?}}` and preserve existing state.

The server resolves its Codex executable from `GWI_CODEX_BIN`, then `codexBinary` in the private `GWI_DATA_DIR/runtime.json`, then `codex` on `PATH`. Runtime JSON accepts an absolute `codexBinary` value and optional `defaultModel`; the model must be an ID from the installed Codex catalog. `GWI_CODEX_MODEL` overrides that runtime default; an explicit role model overrides the default. The default data directory is ignored `.local/state`; no actual runtime file or machine path is shipped. Restart the server after changing these settings. See [runtime settings](operating-guide.md#private-api-and-runtime-settings).

| Method and route | Input and result |
| --- | --- |
| `GET /api/overview` | `{projects: ProjectOverview[], integrations: IntegrationInfo, events: AuditEvent[]}` |
| `POST /api/projects` | `{name,description,workspace,repository}` → `Project` with initial role/workflow templates |
| `GET /api/projects/:id` | `ProjectDetail` |
| `PUT /api/projects/:id` | `{expectedRevision,project:Project}` → next `Project` revision |
| `GET /api/integrations` | `IntegrationInfo` |
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
| `GET /api/runs/:id/recovery?stageId=` | `RunRecovery`: current failed scope, allowance, readiness and a finite continuation recommendation when needed |
| `POST /api/runs/:id/continue` | `{stageId,recoveryKey,note?,approveRecommendation?}` → `Run`; retry within approved allowance or explicitly approve the current finite recommendation and retry only that stage |
| `POST /api/runs/:id/cancel` | `{note}` → run with cancellation/interrupt requested |
| `POST /api/runs/:id/stages/:stageId/complete` | `{output:TaskOutput}` → updated run; human/manual work only |
| `POST /api/runs/:id/stages/:stageId/review` | `{decision:"accept"|"revise",note}` → run; retries preserve earlier attempt |
| `POST /api/runs/:id/stages/:stageId/retry` | `{note}` → run; bounded explicit retry after failure/interruption |
| `POST /api/runs/:id/stages/:stageId/steer` | `{text}` → active-turn steering result |
| `GET /api/events?projectId=&runId=&after=` | `{events:AuditEvent[]}` in sequence order |

Configuration and pipeline updates require their exact `expectedRevision`. Stage/run IDs and role IDs are stable identifiers independent of display language. Running work uses the captured configuration and knowledge, not later edits. All mutations append an audit event with actor and scope.

Saved-pipeline launch requires a concrete `goal`; its name or description is not an outcome. `baseline` may be omitted from HTTP starts: the server derives the committed input revision, or records the project configuration when no Git revision is available. Optional owner-only `limits` overrides finite tokens, attempts, stage time or iterations for this run. `Run.approvedPolicy` records the initial run allowance separately from `snapshot.pipeline.policy`; later explicit changes remain in `limitRevisions`. Existing stored runs keep their original fallback semantics and are not migrated.

`RunRecovery.action` is `retry`, `approve`, `reconcile`, `wait`, `blocked` or `none`. It includes `code`, a fallback `reason`, `recoveryKey`, `limitRevision`, `scope: {kind:"run"|"goal",id}`, `stageAttempts` and `allowance: {policy,usedTokens,reservedTokens,remainingTokens,usageComplete}`. A supervising outcome adds its actual `goal` allowance. A recommendation contains finite `limits` and a `basis` with recorded consumption, held reservations, the previous attempt's reported tokens when available, attempts and the previous policy. It authorizes one failed-stage continuation, not a promise that the whole outcome will complete.

Ordinary continuation needs no note or token form. When `action` is `approve`, `approveRecommendation:true` explicitly approves the displayed recommendation. The key binds the current execution, policy and supervising allowance; stale approval returns `RECOVERY_CONFLICT`. Unknown external execution returns `EXTERNAL_RECONCILIATION_REQUIRED` and must use reconciliation before any replacement task. A goal-wide ceiling returns `GOAL_TOKEN_BUDGET` or `GOAL_TIME_LIMIT` with the goal scope; a run approval never silently extends it. Existing `/limits` and stage `/retry` routes remain available.

Worker token grants are reserved before dispatch. Parallel workers receive disjoint shares of the same remaining allowance. Reported consumption and held reservations remain separate; known completion with a known meter releases its unused grant. Missing usage, including legacy records without a grant, is conservatively held rather than treated as free work. Confirmed `not_dispatched` preparation is the explicit zero-usage exception. Provider usage reporting and cancellation can lag; these accounting ceilings do not claim token-exact native interruption.

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

- `POST /api/projects/:id/intakes`: `{request, baseline?, idempotencyKey, policy?}` creates a supervised goal. It does not require a role or pipeline selection.
- `GET /api/projects/:id/intakes`: returns persisted goals and decision rounds. Project detail also includes `intakes`.
- `POST /api/intakes/:id/cancel`: `{note}` records a stop and cancels owned work.
- `POST /api/intakes/:id/retry`: `IntakeRetryInput` continues the same goal through a fresh bounded coordinator after cleanup, child-state and model-catalog checks. Read responses expose `canRetry` and `retryBlockedReason`.
- Goal policy bounds `maxRounds`, `maxParallel`, `maxTotalTokens` and `maxElapsedSeconds`. A decision can dispatch existing workflows, retry a specific failed owned stage, complete, clarify or stop. The Multica coordinator returns one validated structured decision; GWI applies it and waits without keeping a model turn alive. Recorded legacy native-goal runs instead use the project-scoped `intake.route` tool.

Restart and continuation behavior is specified in the [goal recovery contract](goal-recovery-prd.md). Recovery must be an explicit action based on recorded execution references, not an automatic replay of previously dispatched work.

`IntakeRetryInput` is `{note?,model?,refreshConfiguration?,policy?,recoveryKey?,approveRecommendation?}`. Ordinary continuation can submit `{}` and uses a useful recorded default note. Read responses expose `allowance`, `retryBlockedCode`, `retryBlockedScope`, an optional failed `retryBlockedStageId`, `recoveryKey` and `recoveryRecommendation`. The recommendation supplies a finite same-scope policy and its consumption/time/action basis; `{approveRecommendation:true,recoveryKey}` approves it without estimating raw token values. Stale approval fails before execution.

Advanced owner-only `policy` can extend `maxRounds`, `maxTotalTokens` or `maxElapsedSeconds` and set `recovery: {autoRetry,maxAttempts,backoffSeconds,allowedFallbackModels}`. Explicit extensions remain available when the previous allowance is exhausted. Defaults keep the prior configuration basis and known model; a model override affects the coordinator, while delegated roles retain their project settings. Explicit configuration refresh creates a new future basis. Earlier snapshots, decisions, runs and cumulative consumption are preserved. Duplicate active recovery, completed goals, unknown external cleanup or active children are rejected.

Known child-pipeline token/attempt ceilings stop coordination before another paid decision. Their code and run scope direct the user to that failed stage. If both the outcome and a child are exhausted, a same-scope outcome approval may save an audited `Intake.limitRevisions` entry without starting a coordinator; the child still needs its own explicit continuation. Successful coordinator recovery records requested/actual policy changes and any approved recommendation in `recoveryHistory`. No approval automatically extends both scopes. Exhausted action rounds still permit a final acceptance decision; an attempted additional action records `GOAL_ROUND_LIMIT` and offers a finite additional round when available.

Capacity recovery is off by default and accepts only the recognized provider capacity code or precise native capacity message. Attempts and backoff are bounded; model fallback uses only the explicit allowed pool and actual catalog. Automatic recovery does not refresh configuration or extend limits. History retains previous/new run IDs and actual execution references, requested/actual model, basis revision, trigger, reason and explicit policy changes. Actual provider recovery is separate acceptance evidence.

`executionTimeMeter: "active-windows-v1"` measures merged supervisor/owned-action execution intervals, including scheduled backoff and counting concurrent intervals once. Stopped/failed idle time is excluded. Read responses expose `executionTime.usedSeconds`, `remainingSeconds` and wall-clock `totalElapsedSeconds`; `createdAt` remains the original timestamp. Recovery forwards only the remaining cumulative token and execution-time allowance.

## Project adoption

| Method and route | Input and result |
| --- | --- |
| `POST /api/adoptions` | `{workspace,name?,repository?,idempotencyKey}` → `Adoption`; starts one bounded project-source scan and Codex setup analysis. |
| `GET /api/adoptions` | `{adoptions: Adoption[]}` for the local owner. |
| `GET /api/adoptions/:id` | Current proposal, revision, inspected sources, omissions, native references and errors. |
| `POST /api/adoptions/:id/apply` | `{expectedRevision}` → `Project`; applies the reviewed proposed revision through normal Engine configuration APIs. |

Adoption routes require the local owner and the ordinary authentication/Host/Origin checks. Reusing an idempotency key with identical scan inputs returns the existing record; changed inputs conflict. Apply revalidates source hashes and the exact proposal revision. Changed evidence requires a fresh scan. A partial application retains its created IDs for inspection and retry; a successful repeated apply returns the existing project. Apply installs local configuration and registers sources without starting runs, CI or knowledge synchronization. Proposal and source contents remain private. Exported adoption types live in `src/adoption.ts`.

## Token accounting

`Usage` retains raw `input`, `output`, `total` and optional `cachedInput` counters. Execution budgets use `max(0, input - cachedInput) + output` when a valid cached-input counter is reported; without it, they use `total`. Goal accounting includes owned descendant execution. The native goal's meter remains separately identified and is used as a fallback when detailed usage is unavailable. Missing usage is not a fabricated zero, and delayed reports cannot guarantee an exact pre-spend ceiling. These are token meters, not a currency estimate or a cache-clearing operation.

Each agent attempt uses a unique issue title and the explicit upstream duplicate allowance after the GWI execution guard. This does not authorize repeating an uncertain POST. Reconciliation can locate a lost assignment through its exact execution marker, provider project, agent and runtime; zero or ambiguous candidates stay unconfirmed. Finished issue metadata is synchronized only after task termination is confirmed. Metadata-update failure retains its desired state for a later check and never retries model work.

### Native reasoning effort

Role `effort` and connected-agent `thinking_level` accept `low`, `medium`, `high`, `xhigh`, `max`, `ultra`. New role/agent creation defaults to `max` when no explicit effort is provided. Updates preserve existing effort when omitted; duplicate/import operations preserve explicit source settings. Project serialization and Codex/Multica execution preserve the native value without substitution. This does not migrate private configurations or frozen snapshots; actual model availability and supported efforts are determined by the installed catalog and execution runtime.
