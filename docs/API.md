# Local control API

UI and agents use the same versioned objects from `src/contracts.ts`. The server binds to `127.0.0.1`; default port is 4318. Actual configuration, knowledge and event data are private local state.

## Hosted browser capability

A role may explicitly include `browser.use` in `tools` and set `browser:{origins:["http://127.0.0.1:4320"]}`. Origins are exact HTTP origins with a literal `127.0.0.1` or `[::1]` address and a port from 1024 to 65535. Local bindings remain in the frozen role revision and are excluded from portable templates. Missing bindings fail before model dispatch. GWI, Multica and runtime control ports are rejected across loopback aliases.

Connected Multica executions receive `gwi_browser_use` through their existing authenticated `/mcp/control` lease. Arguments are `{action,url?,selector?,text?,key?,width?,height?,files?}`. Supported actions are `open`, `snapshot`, `click`, `fill`, `press`, `resize`, `upload`, `drop`, `paste`, `screenshot` and `close`. Selectors are CSS. File paths are relative to that attempt's execution workspace; hidden/private targets, escapes, links to outside files and non-regular inputs are rejected. Transfers allow 10 MiB per file and 32 MiB total. Screenshot responses include actual MCP image content and a private host artifact path; viewport/image/DOM bounds protect transport, not model execution time or work counts. File drop/paste use synthetic browser events.

The host retains Chrome's own sandbox and a separate context, without the user's profile. An authenticated local proxy validates HTTP requests and blocks redirects and downloads; WebSockets, service workers, direct WebRTC UDP and QUIC are disabled. Streaming HTTP remains available. Native command permissions are unchanged. `GET /api/runs/:id/executions` includes the latest `browser` observation, operation count, configured origins and browser cleanup confirmation when present. Browser cleanup and external worker termination are separate facts. Revocation/Stop closes browser authority immediately; late results cannot authorize another operation. Standalone native adapter calls fail with `BROWSER_REQUIRES_MULTICA` before a model turn. See [browser requirements](browser-runtime-prd.md).

## Local object routes

Current execution semantics follow [supervised stages without numeric quotas](stage-execution-prd.md). Deprecated policy fields remain readable historical metadata; no concurrency, attempt, iteration, action-round, model-time or token quota is enforced, including through legacy APIs and resumed snapshots. Account availability, scope, permissions, verification, human gates and explicit stop remain authoritative.

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
| `GET /api/runs/:id/recovery?stageId=&resourceMode=account` | `RunRecovery`: current failed scope, account availability, readiness and actual usage diagnostics; no quota-extension recommendation |
| `POST /api/runs/:id/continue` | `{stageId,recoveryKey,note?,resourceMode?,approveRecommendation?,approveAccountStep?,accountAssessmentKey?}` → `Run`; continue only the selected stage under the current recovery and account assessment |
| `POST /api/runs/:id/cancel` | `{note}` → run with cancellation/interrupt requested |
| `POST /api/runs/:id/stages/:stageId/complete` | `{output:TaskOutput}` → updated run; human/manual work only |
| `POST /api/runs/:id/stages/:stageId/review` | `{decision:"accept"|"revise",note}` → run; retries preserve earlier attempt |
| `POST /api/runs/:id/stages/:stageId/retry` | `{note}` → run; bounded explicit retry after failure/interruption |
| `POST /api/runs/:id/stages/:stageId/rework` | `{attemptId,controlRevision,idempotencyKey,note}` → durable run receipt; return concrete findings to the failed verifier's frozen `reworkTo` predecessor |
| `POST /api/runs/:id/stages/:stageId/steer` | `{text}` → active-turn steering result |
| `GET /api/events?projectId=&runId=&after=` | `{events:AuditEvent[]}` in sequence order |

Configuration and pipeline updates require their exact `expectedRevision`. Stage/run IDs and role IDs are stable identifiers independent of display language. Running work uses the captured configuration and knowledge, not later edits. All mutations append an audit event with actor and scope.

Saved-pipeline launch requires a concrete `goal`; its name or description is not an outcome. `baseline` may be omitted: the server derives the committed input revision, or records the project configuration for human-only work without Git. Model-backed starts require the selected Git repository root and a committed HEAD. Nested human-only pipelines bypass this check; missing or unresolved child references cannot establish that a workflow is human-only. Workers recheck before model dispatch, and execution checkouts retain their actual source commit. GWI never initializes, stages or commits source as setup. New starts use account availability. Existing pipeline snapshots and stored token counters are preserved without enforcing historical quotas. New pipeline policies are empty objects; numeric fields are optional deprecated metadata.

`ProjectReadiness` contains `projectId`, `projectRevision`, `observedAt`, `workspace` and `knowledge`. Workspace `status` is `ready`, `blocked` or `unavailable`, with `code` (`READY`, `WORKSPACE_UNAVAILABLE`, `GIT_UNAVAILABLE`, `GIT_REPOSITORY_REQUIRED`, `GIT_ROOT_MISMATCH`, `GIT_COMMIT_REQUIRED`, `GIT_INSPECTION_FAILED`) and a `sourceCommit` only for a verified committed root. Knowledge `status` is `not_configured`, `not_indexed`, `indexed` or `issues`, with `configuredSources`, `indexedSources`, `currentEntries`, `missingEntries`, `errorEntries` and optional `lastSyncedAt`. A private synchronization receipt distinguishes an empty directory successfully indexed from a source never indexed. This reports the recorded indexing result, not a fresh content scan or runtime/account/permission guarantee; no-source projects are valid.

Editing or removing a knowledge source invalidates its affected current entries immediately with `status:"error"` and `errorCode:"SOURCE_CONFIGURATION_CHANGED"`. Content, provenance and earlier frozen run/goal knowledge remain readable. Unrelated sources and lessons stay current. Synchronization replaces this diagnostic with its actual source result; successful entries no longer carry the code. The existing full-project PUT remains compatible, while the narrow bindings PATCH rejects role/source fields and stale revisions.

## Private goal attachments

`PUT /api/projects/:id/attachments/uploads/:uploadKey?draft=<scope>&name=<display-name>&selected=<id>` accepts raw `application/octet-stream` bytes under the existing local-owner session/token. Repeat `selected` for already selected ready files. The upload key is a stable 1–160-character alphanumeric/underscore/hyphen identity; `draft` is a nonempty scope of at most 2,000 characters. Encode the query parameters normally. Names are display metadata, limited to 255 characters without path separators or control characters. Directories, server-path imports and remote URLs are unsupported. Workers gain no upload permission.

The response is an immutable `GoalAttachment`: `{id,projectId,name,size,mediaType,sha256,preview}`. The server verifies actual bytes, enforces 10 MiB per original and 32 MiB per selected submission, and detects content independently of filenames/browser MIME. An unchanged upload key/metadata/content returns the same receipt; changed bytes or metadata return `IDEMPOTENCY_CONFLICT`. `GET .../attachments/uploads/:uploadKey` reconciles a lost receipt. Reselecting the exact original bytes under that identity can restore a missing/corrupt regular original; unsafe/symlinked storage still blocks. There is no automatic expiry or garbage collector.

| Authenticated project route | Result |
| --- | --- |
| `GET /api/projects/:id/attachments/:attachmentId` | Manifest metadata after original digest/readability verification |
| `GET /api/projects/:id/attachments/:attachmentId/preview` | Verified generated PNG only; private/no-store, nosniff and restrictive CSP |
| `GET /api/projects/:id/attachments/:attachmentId/content` | Verified original bytes as an explicit octet-stream download; supplied active content is never served as inline HTML/SVG |

Verified PNG/JPEG/GIF/WebP produces a small static PNG thumbnail with a 20-million-pixel input boundary. Valid UTF-8 produces a literal excerpt of up to 4,000 characters, including an explicit empty state and truncation flag. PDF, archives and other binaries produce information cards. Decoding failure retains the original with a card. A preview error does not imply the upload failed. Storage and previews live under private application state, outside public assets; cross-project references/reads are rejected even for an otherwise valid ID. Project-scoped actors need their existing `context.read` authorization for reads; file IDs confer no authority.

Initial Intake and Run requests accept optional ordered `attachmentIds`. Goal retry/resume and run resolve/continue also accept them, with an `idempotencyKey` required for attachment-bearing continuation. An unchanged request returns its durable receipt, including after restart; a changed text/manifest under the same key conflicts. Existing recovery/control-generation guards still apply to a new continuation. Empty manifests preserve legacy contracts. `/runs/:id/resume` only resumes dispatch and does not consume an instruction or attachments.

Original Intake inputs live in `Intake.attachments`; the effective frozen input lives in `Run.snapshot.attachments`. Goal/work recovery records and `StageRun.attachmentHistory` retain deliberately added supplements; each launched worker attempt records its effective manifest. New supplements create a new Intake basis revision. Earlier snapshots and accepted independent stages remain intact. Follow-ups inherit authorized same-project frozen input as historical context. Selection byte limits apply to each new submission, not the cumulative historical material.

Before assigning model work, the native and Multica paths check original digests and create generated-identity copies under private GWI application state: `attachment-inputs/<project>/<workspace-digest>/<run>/<attempt>/`. The workspace digest separates worker and independent-verification copies. Host writes never traverse worker-controlled workspace parents. The server derives writable roots from the effective frozen role/runtime, not from request fields. Native read-only Intake coordination and read-only stages can use project-local `.local/state`; connected execution checks its actual isolated workspace, including the writable verification copy. The Multica path also excludes system temporary roots. A native workspace-write stage with state inside its project workspace returns `ATTACHMENT_HANDOFF_UNAVAILABLE` before assignment: use independent private state through `GWI_DATA_DIR` or an isolated executor, retaining existing history. The runtime reads exact staged paths under its existing read permissions; no sandbox, approval or output-artifact boundary is relaxed. A completed subordinate handoff that cannot consume new input returns the same explicit blocker. A prepared/readable copy is not evidence that a real provider read it.

Agent `run.start` calls always bind `parentRunId` and `parentStageId` to the server's calling run/stage, overriding supplied ancestry. The child inherits that stage's effective frozen attachment manifest, including its continuation supplements. Earlier attempts and accepted independent stages are preserved.

Errors retain `{error:{code,message,details?}}`: `INVALID_ATTACHMENT`/`INVALID_ATTACHMENTS` (400), `ATTACHMENT_TOO_LARGE`/`ATTACHMENT_TOTAL_TOO_LARGE` (413), `ATTACHMENT_NOT_FOUND` (404), `ATTACHMENT_MISSING`/`ATTACHMENT_CORRUPT`/`ATTACHMENT_UNSAFE_PATH`/`ATTACHMENT_HANDOFF_UNAVAILABLE` (409), and existing authentication/project/idempotency errors. Preserve successful siblings and text after an error. Retry byte transfer or reconcile the original work identity; an observation failure never authorizes a new dispatch.

## Account-aware allowance

`GET /api/account-allowance` accepts `projectId` and optional `pipelineId`, `stageId`, `runId` or `intakeId`; an intake assessment may include a coordinator `model` override. POST uses the same context with optional `refresh:true`. Scope is validated against the actual project, pipeline and run. Refresh reads the installed Codex app-server using existing authentication and makes no model call. Responses contain no credential, account identity, contact details, credit balance or raw provider payload.

`AllowanceAssessment` contains `key`, `status` (`ready`, `learning`, `caution`, `exhausted`, `unavailable`), `code`, `action` (`continue`, `wait`, `owner-step`), `account`, `trend`, `target` and `activeExecutions`. `account` includes sanitized window identity, duration, used/remaining percentage, reset timestamp, observation and expiry times. Prefer native `rateLimitsByLimitId`; missing windows remain unavailable. Cache ordinary reads for up to sixty seconds and invalidate across a reset. Never convert token counts into subscription allowance.

The private execution ledger records before/after observations around real dispatched work. Trends require at least three valid comparable executions of the same project, task/stage, role, model and effort. Resets, account changes, stale readings, missing windows and overlapping GWI work invalidate a comparable delta. Rounded zero change has measurement uncertainty; it does not prove free execution. The shared account can also be used outside GWI: ranges and direction describe observed changes, not exact task charges or a guaranteed task count. Old token-only history is not backfilled into percentage history.

A fresh exhausted account blocks new model work. Manual stages need no account read. Missing/stale data or a caution assessment requires a deliberate owner step using `approveAccountStep:true` and the exact `accountAssessmentKey`. This grant is tied to the observation and execution generation, consumed once, and invalidated by Stop or changed state. It cannot override known exhaustion or unresolved external execution. Final admission and observation recording are serialized across projects before paid dispatch; shared account observations are not independent resource guarantees. There are no GWI numeric execution quotas.

`RunRecovery` retains `action`, `code`, `recoveryKey`, scope and diagnostic `allowance`; account responses add `resourceMode`, `account` and `accountAcknowledgementRequired`. It emits no quota-extension recommendation. Historical recommendation flags cannot bypass remaining boundaries. Unknown external execution returns `EXTERNAL_RECONCILIATION_REQUIRED` and must be reconciled first. A pending continuation can be cancelled before dispatch; stopping invalidates its recovery generation.

Failed agent-verifier rework requires exact attempt/control identities, a stable request key and concrete findings within 2,000 characters. The destination is a configured ancestor in the frozen workflow; a client cannot supply or forge one. The local task controls can request this handoff, while project-scoped worker tokens cannot. Reject active or unconfirmed execution, closed supervising goals, Stop and stale identities. Cleanup records must match the actual assignment references and a terminal state; `not_dispatched` requires empty assignment references and a consistent preparation record. Queue only that predecessor and its dependents, retain earlier attempts and snapshots, invalidate unused affected account approvals and every affected browser grant for future use, and retain Pause. Historical attempt bindings remain readable. Persist the receipt and supervising recovery observation atomically before dispatch. Subsequent execution still needs its original account and permission checks. Repeated identical requests return their original receipt without another dispatch.

Execution records retain a failed provider task's `error` separately from `verification.check`. An integrity observation with `errorCode` establishes neither source mutation nor acceptance; a completed verifier with unavailable integrity fails as `VERIFICATION_INTEGRITY_UNAVAILABLE`. Confirmed changed source retains `VERIFICATION_SOURCE_MUTATED`. Neither diagnostic overwrites the primary error of an already failed provider task. Private, untracked verification scratch remains excluded even when Git reports nested repositories as directory entries; tracked private state and unsafe included paths remain rejected.

Continuation checks account availability while earlier snapshots, usage and revisions stay intact. Legacy `resourceMode:"tokens"`, `limits` and numeric policy fields cannot activate a token ceiling or reserve a synthetic remaining budget. Native reporting/cancellation can lag; missing usage remains unknown and counters do not establish account allowance. The existing `/limits` route accepts only historical policy metadata under owner/revision checks; it does not authorize additional work or change permissions. Stage `/retry` remains available without a numeric extension.

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
| `GET /api/runs/:id/changes` | Actual diff against the frozen input commit, status, candidate commit/manifest and bounded eligible new-file previews from the execution checkout. Includes committed implementation changes and deletions. |
| `GET /api/runs/:id/artifacts?path=RELATIVE_PATH` | Plain-text preview, up to 512 KiB, inside that execution checkout; private paths and symlink escapes are rejected. |
| `POST /api/runs/:id/limits` | Deprecated compatibility route: `{expectedRevision,limits,note}` records valid historical policy metadata under owner/revision checks; no quota is enforced and no work starts. |

Team/capability changes and historical policy metadata writes require the local owner. Role-selected native templates are copied; their original shared agents are not overwritten. `role.multica` can select `agentId`, `runtimeId`, `skillIds` and `mcpServerIds`. Native model execution requires the selected verified runtime and live execution-policy proof.

Executions use standalone checkouts of committed source. Dirty/untracked/ignored files and installed dependency directories are not copied. Each run records the actual source revision. Relative artifacts and diffs are evidence for inspection; they do not establish publication.

Task-scoped `POST /mcp/control` uses an execution-scoped bearer capability for the frozen role's allowed tools and project. It remains valid through long work and is revoked when its execution ends or observation is interrupted. The owner token is never placed in agent configuration. The GWI connection is explicitly preauthorized for those selected capabilities; unrelated MCP servers retain their approval policy. Revocation, project scope and role permissions are checked on calls. File permissions remain governed by the native runtime.

Codex stages may set `executionPurpose:"review"`. A legacy stage owned by the canonical read-only `qa` role derives that purpose at execution; planner decisions do not. Review captures the current prepared checkout, including tracked changes/deletions and eligible nonignored untracked source, in an independent disposable copy. Before assignment, a model-free guard probe must prove scratch writes and deny write opens against original execution, project and sibling files. The task-only agent uses `gwi-workspace`; permanent roles and frozen snapshots remain unchanged. Input SHA-256 manifests, scope proof and post-run source integrity appear in `verification.prepared`/`verification.checked` events and execution records. Unsafe scope or source mutation rejects the result without a full-access fallback. Unknown tasks retain their copy until reconciliation; ended copies are removed while audit metadata remains.

`team.capabilities.verification.available` describes support prerequisites and `requiresProbe:true`, not a completed per-task proof. Native read isolation and network domain restriction are not provided. Static execution capability reports `nativeTaskLimit:"unknown"` and the configured policy separately; every dispatch verifies actual serving process identity, exact patch hash and disabled task/idle/tool clocks. New starter stages have no model deadline. Transport and cancellation confirmation keep technical deadlines. Dependency installation and browser checks are not inferred from source review; pending checks remain part of owner delivery acceptance.

New goal decisions return structured actions and end before GWI waits for human/CI outcomes. Continuation notes, current account observations and role permissions enter the next decision without old execution quotas. Model-facing tools project legacy policy fields out while owner snapshots retain their original values. Provider preparation failure is distinct from an uncertain assignment: `not_dispatched` confirms no task was created; an unknown issue POST requires external reconciliation. Steering returns the actual supplement receipt; `pending` is not `delivered`.

`scripts/gwi.mjs` supplies a local CLI for Codex and other agent clients. Its `request METHOD /api/path` command reads JSON from stdin or a private file. Public examples contain no real project configuration.

## Lesson lifecycle

`PATCH /api/projects/:id/knowledge/lessons/:entryId` takes `{expectedRevision,expectedLifecycleRevision,archived}` and requires the local owner session/token. The content revision is retained; missing historical `lifecycleRevision` means zero. Each actual archive/restore increments that lifecycle revision and returns the acknowledged entry. A stale content/lifecycle pair returns `REVISION_CONFLICT`, including an archive/restore cycle that returned to the same status. Source-backed and cross-project entries cannot be changed through this operation.

Default knowledge search and newly frozen context include only current entries. Proposed and declined lessons have separate owner-only filters; neither can be promoted through archive/restore. The owner can use `GET /api/projects/:id/knowledge?status=archived` to manage archived lessons. Archive preserves content, hash, origin and historical context; synchronization cannot undo a concurrent lifecycle change. An existing goal/run that deliberately reuses an older frozen basis keeps that basis. Clients must retain a successful lifecycle receipt across failed or stale reads and refresh observation before another change. No worker control permission is added.

# Goal entry

- `POST /api/projects/:id/intakes`: `{request, baseline?, idempotencyKey, parentIntakeId?, policy?, resourceMode?, approveAccountStep?, accountAssessmentKey?}` creates a supervised goal. It does not require a role or pipeline selection. Optional `parentIntakeId` links a follow-up to a completed result in the same project; active, failed, stopped or unconfirmed work cannot be bypassed this way. Idempotency includes this parent identity.
- `GET /api/projects/:id/intakes`: returns persisted goals and decision rounds. Project detail also includes `intakes`.
- `POST /api/intakes/:id/cancel`: `{note}` records a stop and cancels owned work.
- `POST /api/intakes/:id/retry`: `IntakeRetryInput` continues the same goal through a fresh bounded coordinator after cleanup, child-state and model-catalog checks. Read responses expose `canRetry` and `retryBlockedReason`.
- New goal policy contains `smartRetry` and optional recovery behavior without numeric execution quotas. Historical `maxRounds`, `maxParallel`, `maxElapsedSeconds` and `maxTotalTokens` values are inert. A decision can dispatch existing workflows, retry a specific failed owned stage, complete, clarify or stop. The Multica coordinator returns one validated structured decision; GWI applies it and waits without keeping a model turn alive. Recorded legacy native-goal runs instead use the project-scoped `intake.route` tool.

Restart and continuation behavior is specified in the [goal recovery contract](goal-recovery-prd.md). Manual and preapproved bounded smart recovery use recorded execution references and authoritative termination checks; neither blindly replays previously dispatched work.

Coordinator reconciliation uses the accepted round's exact `decision-N` identity when available. A historical preparation rejected before an accepted round instead uses its single project/run-scoped recorded decision identity, including a confirmed `not_dispatched` record. Later rounds cannot renumber it. Missing or ambiguous execution identity, mismatched task references and unconfirmed cleanup remain blocking evidence.

Follow-up `Intake.parentIntakeId` is a discussion link, separate from execution parentage, retry and accounting families. A frozen `conversation` in its configuration basis and execution snapshots contains recent requests/results, source intake/run IDs, result kind, date, basis revision and up to four recorded clarification replies per turn. It marks omitted clarification pairs as well as excerpts. It retains at most four turns within 24,000 serialized characters, marks any excerpt and counts omitted earlier turns. Read responses expose this context; clients cannot supply its contents. Native/connected coordinators and delegated workers receive it as historical reference data, never as additional authority or current-state proof. Existing completed records, approvals and consumption remain unchanged; follow-ups use current project configuration and ordinary admission.

A clarification reply uses the existing `/retry` endpoint with a nonempty `note`, current recovery key and normal account approval when required. It retains the same Intake and cumulative boundaries. Manual continuation records carry `replyToQuestion` when replying to a question. Native and connected planners receive that current question/reply separately from bounded older history. A blank clarification reply is rejected before dispatch. Read responses expose `continuationPending:true` while an existing continuation is being checked; the inline reply remains visible and cancellable through the normal stop endpoint until its receipt or failure.

`IntakeRetryInput` remains backward compatible with `{note?,model?,refreshConfiguration?,policy?,recoveryKey?,approveRecommendation?,resourceMode?,approveAccountStep?,accountAssessmentKey?}`. Continuation uses a useful recorded/default note; caution/unavailable readings need current explicit account approval. Read responses expose actual diagnostics, `retryBlockedCode`, `retryBlockedScope`, an optional failed `retryBlockedStageId` and `recoveryKey`. They emit no execution-quota recommendation. Stale account approval fails before execution.

Owner-only `policy.recovery` can set `autoRetry`, technical `backoffSeconds` and `allowedFallbackModels`; historical numeric quota fields are inert. Defaults keep the prior configuration basis and known model; a model override affects the coordinator, while delegated roles retain their project settings. Explicit configuration refresh creates a new future basis. Earlier snapshots, decisions, runs and cumulative consumption are preserved. Duplicate active recovery, completed goals, unknown external cleanup or active children are rejected.

Known child account-admission holds and actual failed work direct the user to that stage before another paid decision. Historical attempt/time/token/round values do not create holds, refill decisions or stop codes. Successful coordinator recovery records actual changes in `recoveryHistory`; prior `limitRevisions` remain readable without constraining execution.

Capacity-specific model fallback is a separate optional policy and accepts only a recognized provider capacity code or precise native message. New goals enable smart work retry; existing goals without it are not silently opted in. Repeated unchanged failure requires attention rather than automatic replay. Model fallback uses only the explicit allowed pool and actual catalog. Automatic recovery does not refresh configuration or permissions. History retains previous/new run IDs and actual execution references, requested/actual model, basis revision, trigger and reason. Actual provider recovery is separate acceptance evidence.

`executionTimeMeter: "active-windows-v1"` measures merged supervisor/owned-action execution intervals, including scheduled backoff and counting concurrent intervals once. Stopped/failed idle time is excluded. Read responses expose `executionTime.usedSeconds` and wall-clock `totalElapsedSeconds`; `createdAt` remains the original timestamp. They do not expose an invented remaining quota or forward time/token limits to model execution.

## Project adoption

| Method and route | Input and result |
| --- | --- |
| `POST /api/adoptions` | `{workspace,name?,repository?,idempotencyKey}` → `Adoption`; starts one bounded project-source scan and Codex setup analysis. |
| `GET /api/adoptions` | `{adoptions: Adoption[]}` for the local owner. |
| `GET /api/adoptions/:id` | Current proposal, revision, inspected sources, omissions, native references and errors. |
| `POST /api/adoptions/:id/apply` | `{expectedRevision}` → `Project`; applies the reviewed proposed revision through normal Engine configuration APIs. |

Adoption routes require the local owner and the ordinary authentication/Host/Origin checks. Reusing an idempotency key with identical scan inputs returns the existing record; changed inputs conflict. Apply revalidates source hashes and the exact proposal revision. Changed evidence requires a fresh scan. Configuration writes and application checkpoints commit together; a partial installation retains its durable IDs for inspection and revision-checked retry. New Apply also makes one bounded local knowledge synchronization without model work, runs or CI. `application.phase` records `installing`, `indexing`, `completed` or `failed`; optional `application.knowledgeSync` records `status` (`pending`, `completed`, `failed`), `at`, result `stats` and an optional `error`. If configuration is installed but indexing fails, `status:"applied"` records that fact, the indexing failure stays inspectable and the existing project opens for Knowledge recovery. Restart marks unfinished installation/indexing honestly without automatically replaying work. Repeated Apply returns an already applied project without a second synchronization; older applied records are unchanged. Proposal and source contents remain private. Exported adoption types live in `src/adoption.ts`.

## Token accounting

`Usage` retains raw `input`, `output`, `total` and optional `cachedInput` counters. Diagnostics use `max(0, input - cachedInput) + output` when a valid cached-input counter is reported; without it, they use `total`. Goal accounting includes owned descendant execution. The native goal's meter remains separately identified and is used as a fallback when detailed usage is unavailable. Missing usage is not a fabricated zero. These are token meters, not execution quotas, currency estimates or cache-clearing operations.

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

Stopped/completed goals and cancelled/completed executions project as historical results. Their earlier recovery phases and owned manual/review/account gates do not contribute current decisions, counts or recovery badges. A current recovery must match its goal's router and control revision. Detail histories retain the original records; clients also honor terminal status when reading an older summary payload. A newer terminal observation supersedes an earlier continuation receipt, while a fresh explicit continuation remains protected against an older stopped observation.


### Work recovery

`POST /api/intakes/:id/resume` (local owner, empty body) records or reuses one pending work recovery and returns the Intake receipt immediately. It does not wait for cleanup or report a retry as completed. Observe `workRecoveryHistory` through the existing project/global detail refresh. Each record includes the exact run/stage/attempt, trigger, phase, cause code, counters, absolute confirmation deadline, next check and eventual retry/end timestamps. Earlier records remain immutable audit evidence except for their own lifecycle completion.

The same endpoint accepts `WorkResumeInput`: `{note?,attachmentIds?,recoveryKey?,idempotencyKey?,controlRevision?,target?:{runId,stageId,attemptId,runControlRevision},browserProjectRevision?}`. An explicit target requires a stable request identity and the current goal control revision. It must belong to that goal; stale attempts/control revisions, completed goals and cancelled executions fail before replacement work. An identical recorded request returns current state without starting another attempt, including after restart; changed content under the same identity conflicts. Attachment-bearing submissions return their saved receipt, including after an original becomes unavailable; new work still verifies the bytes. Ordered attachment manifests and an optional current recovery key participate in that identity alongside the exact target and browser choice. The recovery record retains the supplement for the retried step or coordinator without changing earlier snapshots. An account wait retains that accepted note and manifest: ordinary approval inherits an unconsumed supplement only from the matching current goal/router/control/run/stage/attempt, checks its original bytes, and records it once. An earlier superseded or stopped recovery cannot supply pending files. Approval pins the owning goal/router/control/recovery identity across every asynchronous account check and the write transaction; a newer owner instruction rejects the older approval with `RECOVERY_CONFLICT`. Only matching unexecuted admission-held attempts can retain the accepted instruction beyond its original failed attempt.

`browserProjectRevision` requires the local human owner and an exact target. GWI records the current same-role `browser.use`/origins for the next executed attempt, after authoritative cleanup. The original snapshot, native sandbox, model, instructions, other tools and accepted stages remain fixed. `Run.browserContinuations` and `Attempt.browserContinuationId` retain this explicit authority separately; an account-admission hold does not consume it, and ordinary approval retains it. A real executed attempt consumes it; Stop records `revokedAt` and prevents unused authority from being inherited by a later continuation. Default/automatic retries acquire no new browser authority. QA success lets the existing scheduler proceed to queued maintenance and its original review gate before another coordinator decision.

New Intake policies set `smartRetry:true`; absence on an older stored policy does not opt it into unattended work. Confirmation and retry share the backend path and preserve source/account/permission checks. Pending recovery can be cancelled through Stop. Repeated unchanged failure or an oscillating result requires new guidance or actual changed evidence; no numeric extension is needed.

### Direct continuation and refusal

`POST /api/runs/:id/resolve` accepts `stageId`, a stable `idempotencyKey`, optional `attemptId`/`controlRevision` and `note` (up to 20,000 characters). It checks current recovery, performs an exact external termination check when supported (5-second check, 15-second request deadline), and retries only the failed step when its scope, account and permission boundaries permit it. These technical observation deadlines do not cap model execution or establish unconfirmed termination.

The response is `{status:"continued", run}` with a durable receipt, or `{status:"needs_input", recovery}` without starting replacement work. An actual approval can include the exact returned `recoveryKey` and the existing `approveRecommendation`, `approveAccountStep`/`accountAssessmentKey` fields. Retry an uncertain request with the same key and body; reuse with different content is rejected. A later Stop or changed attempt supersedes an earlier continuation.

`POST /api/runs/:id/cancel` accepts `declineRetry:true` for an explicit owner refusal after a failure as well as during a hold. It preserves attempts/results, records the refusal and stops the owning goal from dispatching replacement work. Completed work cannot be declined retroactively. Repeated refusal does not create another event or attempt.

`POST /api/intakes/:id/resume` accepts an optional `note` of up to 2,000 characters. The recovery record retains it and delivers it to the failed step or resumed coordinator after termination checks. It does not widen permissions or model scope.
## Delivery review evidence and decisions

| Endpoint | Contract |
| --- | --- |
| `GET /api/runs/:id/stages/:stageId/delivery` | `DeliveryBundle` for a manual or review stage. Assembles evidence without model work. |
| `POST /api/runs/:id/stages/:stageId/delivery/prepare` | `DeliveryRequest` → linked support `Run`; local-owner action through ordinary protected execution and account admission. |
| `POST /api/runs/:id/stages/:stageId/delivery/decide` | `DeliveryRequest` plus `decision:"accept"|"revise"` → parent `Run`; revision requires a concrete finding. |
| `GET /api/runs/:id/browser-evidence/:attemptId` | Authenticated recorded PNG for that run/project/attempt. No client filesystem path is accepted; unavailable, unsafe and out-of-scope files are rejected. |

`DeliveryBundle` includes `key`, exact run/stage/attempt/control identity, `status`, `stageStatus`, `observedAt`, request, transitive upstream results and the current review subject. Its `source` is observed or unavailable, with `sourceRequired` for code delivery; `screenshots` use scoped local URLs. `publications` separate observed GitHub head/check facts from reported or unavailable links; only the bound repository is observed. A PR head does not establish that a dirty/different prepared candidate passed those checks. `preparations` retain linked outputs, current/stale basis and cleanup state. Missing evidence remains explicit in `gaps`.

`DeliveryRequest` requires stable `idempotencyKey`, `bundleKey`, `attemptId` and `controlRevision`, with optional `note` up to 2,000 characters. Evidence, source manifest and current decision state are revalidated; stale requests fail with `REVIEW_CONFLICT`. Durable preparation/decision receipts deduplicate successful requests after restart. A preparation with unchanged evidence and instructions reuses its existing child even with another request key. Active or unconfirmed support blocks replacement preparation and decisions. Stop invalidates/cancels linked support; pausing prevents new preparation dispatch. A support result never advances its parent.

The server-owned `Run.reviewSupport` pins parent stage/attempt/control, source manifest and retained upstream results before dispatch. It cannot be supplied through public `StartRunInput`. The fixed support stage and opt-in workflow `Stage.deliveryPreparation:true` require Codex protected review execution. Preparation narrows control tools and removes unrelated skills, MCP bindings and browser authority while retaining source-integrity checks. It does not claim native filesystem read or network isolation. Missing original source is a prerequisite failure, not permission to clone current project HEAD. New default change workflows prepare material before `ownerGate:true`; legacy frozen workflows remain unchanged. Owner gates require the actual local human session; agent technical conclusions remain distinct.

## Frozen task context and knowledge review

New owner run/goal starts refresh only the already registered source set before capturing their basis. Capture records the checked project/source configuration, per-document hashes and capture interval; it is not a cross-filesystem atomic snapshot. Continuations reuse the earlier corpus unless an explicit configuration refresh creates a new basis. The corpus, selection and actual scoped tool reads remain private.

| Method and route | Input and result |
| --- | --- |
| `GET /api/runs/:id/context?stage=STAGE_ID&attempt=ATTEMPT_ID` | `{context: KnowledgeContextRecord | null}` for the exact attempt; legacy attempts without a recorded selection return null. |
| `POST /api/runs/:id/context/read` | `{stageId,attemptId?,locator}` → bounded frozen `KnowledgeReadPage`, including contiguous surrounding material and an optional continuation; mismatched project/corpus/revision/hash/range is rejected. |
| `GET /api/projects/:id/knowledge/governance` | Retained feedback, effective relationships and pending/declined lesson proposals. |
| `POST /api/projects/:id/knowledge/feedback` | `KnowledgeFeedbackInput` naming an exact reference, kind and optional note/evidence. Records feedback without silently reranking or blocking work. |
| `POST /api/projects/:id/knowledge/relationships` | Owner-confirmed `KnowledgeRelationshipInput`: exact from/to references, kind, evidence note and optional resolution. |
| `POST /api/projects/:id/knowledge/lessons/:entryId/review` | `{expectedRevision,expectedLifecycleRevision,decision,title?,content?,roles?,note?,evidence?}`; retain/revise or decline the pending proposal with CAS. |

`KnowledgeSource.purpose` is optional: `guidance` supplies the complete applicable material before dispatch; `reference` selects task-relevant passages. Without an explicit purpose, only the project's own root `AGENTS.md` receives the guidance default. Missing/oversized applicable guidance or an unresolved owner-confirmed exact conflict blocks before a model call. Role tags remain applicability metadata, not cross-project authorization.

Native and connected workers and coordinators use the same frozen-corpus retrieval service. The existing scoped `knowledge.search` tool accepts a bounded query and optional role/kind/cursor. `format:'v2'` returns `{corpusId,matches,total,coverage,nextCursor?}`; `coverage` is `matched`, `no-match` or `discovery`. The compatibility array contains matching passages rather than unrelated document openings. Default role applicability can be replaced by an explicit role or `all` within the same frozen project corpus. Connected coordination receives a task-scoped read-only `context.read`/`knowledge.search` lease, not an `intake.route` capability or owner token.

`local-passages-v5` retains the earlier lexical ranking, tokenizer and AST index boundaries. After a body passage qualifies, it materializes the complete nearest Markdown section when that section fits the 2,000-character passage bound. This includes neighboring rules without query terms. Identical materialized ranges are returned once. Long sections remain positioned fragments, and metadata-only discovery anchors are not expanded. `KnowledgeSelection.reasons` includes `SECTION_CONTEXT` for this expansion; the serialized initial evidence also marks `structuralContext:true`. Other reasons still describe the original body match, not a claim that every surrounding line matched.

The initial serialized task envelope defaults to 32,000 characters, including task metadata, guidance, optional evidence and dependency/feedback records. Section expansion and JSON metadata count toward it. A short section that cannot fit is omitted as a whole with `BUDGET_OMISSION`; it is not silently reduced to its first paragraph. Blocked guidance diagnostics may retain complete oversized material for inspection, but are not dispatched to a model. `KnowledgeContextPlan.omissions` describes candidates not selected as lexical primaries, lower-ranked candidates and actual budget omissions. A weak or metadata-only candidate may nevertheless appear inside a structurally included section; these character counts are not a measure of text never provided or never read. The exact initial selection is recorded in `context`, `guidance` and `evidence` with its strategy version.

A locator binds `corpusId`, entry ID/revision/hash, `chunkId`, heading ancestry and source line range. Optional `startOffset`/`endOffset` are zero-based JavaScript string offsets into the frozen entry; source lines remain one-based. Passing `read:locator` to the tool, or using the owner read endpoint, returns `{corpusId,passage,complete,next?}`. A read page can include contiguous neighboring text, up to 4,000 body characters; search and read replies are bounded to 7,000 serialized JSON characters including metadata and cursors. Oversized metadata returns an explicit bounded error instead of silently cutting source text. `next` continues after the returned range, and `complete` indicates the end of the entry's indexed material, not verified task completion. Earlier v4 paragraph locators remain readable against the same corpus bytes.

The source viewer labels surrounding text separately and shows selected/requested versus returned line ranges when they differ. Opening it does not enlarge or rewrite the initial outgoing selection, and owner inspection does not add an agent lookup receipt. Actual scoped agent searches/reads are recorded separately. Historical attempt records are not recomputed or relabeled when a later strategy is installed. Lexical matching does not translate unrelated concepts across languages; an agent can refine or translate a query during its ordinary task. Selection and search/read receipts remain distinct from evidence proven useful.

Project-scoped agent lessons enter `proposed` status. Owner-authored lessons remain directly retainable. `status=proposed` and `status=declined` provide owner inbox/history views. Review preserves original suggested text and origin. The proposal cannot bypass review by being archived and restored. Source feedback and relationships name exact versions; previous-version findings remain historical after a new source revision.

## Reusable local templates

Reusable template content is private local state. Immutable template revisions, project bindings/owned fields and frozen execution are separate layers. Existing project definitions do not become live subscribers to a code default. Types are exported from `src/template-types.ts`.

| Method and route | Input and result |
| --- | --- |
| `GET /api/templates` | `{templates:TemplateHead[]}`; the owner sees the local catalog, while a project-scoped caller sees template identities present in its project bindings. |
| `POST /api/templates` | `CreateTemplateInput` → `{template:TemplateHead,revision:TemplateRevision}` from an exact project role/workflow source. |
| `GET /api/templates/:id/revisions/:revision` | Exact immutable revision. Project-scoped callers require a binding to that template identity; cross-project creation provenance is replaced with the template reference. |
| `POST /api/templates/:id/revisions` | `ReviseTemplateInput` → `{template,revision}` with head CAS, portable definition, change summary and idempotency key. |
| `PATCH /api/templates/:id` | `{expectedRecordRevision,retired}` changes catalog availability without rewriting content. |
| `GET /api/projects/:id/template-bindings` | `ProjectTemplateBinding[]` for governed objects. |
| `POST /api/projects/:id/template-previews` | `PreviewTemplateInput` → `TemplateChangePreview`; prepares a candidate without installing it or starting work. |
| `POST /api/projects/:id/template-previews/:previewId/apply` | `{previewKey,idempotencyKey}` → durable `TemplateChangeReceipt` committed with the definition/binding. |

`TemplateHead.recordRevision` guards catalog edits; `latestRevision` identifies the latest content version. `CreateTemplateInput.source` supplies `{projectId,kind,id,expectedProjectRevision,expectedPipelineRevision?}`. A pipeline source requires its pipeline revision as well as the project revision. Portable `definition` and purpose/use/avoid guidance may be supplied; creation and revision requests keep an `idempotencyKey`.

`PreviewTemplateInput` names `template:{id,revision}`, `expectedProjectRevision` and an optional `target:{kind,id}`. Omitting the target prepares a new identity. Updating an existing workflow also requires `expectedPipelineRevision`. `mappings.roles` maps logical responsibilities to active project roles; `mappings.external` supplies project child-workflow or GitHub targets. Logical slots need not equal stage IDs, and several role slots may share one project role. Current stage targets are preserved unless the reviewed request explicitly replaces their mapping.

The preview returns `id`, `key`, `state`, `candidate`, `binding`, `changes` and `checks`. States are `ready`, `conflicts` or `blocked`. The comparison uses the bound template base, current project and requested template revision. Ordinary arrays are atomic; workflow stages merge by stable ID. `resolutions` maps listed conflict paths to `project` or `template`; it is not an arbitrary patch. Resolved rows belong to the Apply/Keep groups rather than the unresolved-conflict group.

Role templates can declare optional model/effort defaults: an omitted field has no template opinion, while `model:null` means inherit the project default. Existing explicit choices remain project owned, including coincident values. `releaseOwnedPaths` deliberately returns listed fields to template management. The effective values remain in the project definition. Capability declarations are requirements, not grants; native agents/runtimes, MCP bindings, local skill paths, credentials and execution targets remain project owned.

Origin, binding and preview metadata is server owned. Legacy definition PUT/import cannot forge lineage or transfer another object's binding. Duplicate identities remain independent. Global creation/revision/retirement and Apply require the local owner; a project worker may prepare a change only for its bound definition with the existing proposal permission. Preview/apply checks reject invalid mappings, unmet requirements and stale project/object/binding bases. Retirement blocks new installs/upgrades but retains exact historical revisions and existing work.

Apply commits the definition, binding and durable receipt together. Retrying the same request returns the recorded result; a failed observation is not permission to submit a new application. Preparation can create an unused immutable agent revision, but template maintenance starts no model task. Provenance and binding-record IDs do not change the execution-agent hash; real contract changes still create an execution revision. Earlier run and Intake bases remain frozen.

Local GUI checks exercised saving a role template, selecting its project target, installing a version, publishing an update and reviewing a local conflict while retaining an explicit effort choice. Model-free automated tests cover CAS/permission rejection, many-to-one and custom-slot mappings, preparation races, receipt faults and frozen earlier work. These checks are separate from live provider execution or product acceptance.
