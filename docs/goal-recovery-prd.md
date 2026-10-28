# Goal recovery after native capacity failures

Current execution revision: [Supervised stages without numeric quotas](stage-execution-prd.md). Numeric fields shown in compatibility records are historical metadata, never enforcement or continuation prerequisites.

Scope: the original native-goal compatibility path. The integrated Multica coordinator uses the same cumulative recovery boundaries with provider-specific references and cleanup checks; see the current [API contract](API.md#goal-entry) and [product requirements](PRD.md#loop-engineering).

Owner: the goal execution backend. Independent review: the root integrator. This document adds a bounded recovery path to the current local release; it does not reopen the original product scope.

## User outcome

A temporary model-capacity failure must not erase an investigation, repeat completed work, or silently authorize a different model. The user can continue the same GWI goal through a fresh owned native execution, with the original request, action decisions, evidence, usage and limits retained.

## Scope and behavior

- Recovery creates a new owned native goal. It never resumes or reactivates a cleared or uncertain native goal. `routerRunId` identifies the latest supervisor run; `supervisorRunIds` retains every supervisor run in order. Existing run snapshots remain immutable.
- Manual recovery accepts an optional note and requires a terminal previous native run, confirmed native cleanup, and terminal child runs. Completed goals cannot be retried. A recovery already starting or running cannot be started again.
- A requested model must be an ID in the actual adapter model catalog. Without an override, recovery retains a known previous requested/effective model; it does not guess a model from a catalog's default marker. The override applies to the native supervisor only. Delegated roles retain their project configuration; refreshing that configuration is a separate explicit choice. Earlier role/run snapshots are unchanged.
- `refreshConfiguration` defaults to false. A manual request may refresh the future project, workflow and current knowledge basis. Each basis revision is retained, with project/workflow revisions and source knowledge hashes. Automatic recovery never refreshes configuration.
- Recovery does not require extending action-round, token, time or attempt quotas. Historical policy values and changes remain readable but inert. Recorded rounds, consumption and execution time remain cumulative diagnostics. Completion checks the most recent dispatch with real accepted targets and requires all linked work to be terminal. `active-windows-v1` merges actual supervisor/child execution intervals, so parallel work is not added twice; scheduled backoff counts while stopped/failed idle time does not. `createdAt` stays unchanged. New native and connected executions receive no GWI time/token ceiling.
- The GWI token meter uses the shared `budgetTokens` helper over reported `Usage`; raw counts and the native goal meter remain distinct. Missing usage remains unavailable and is not described as an exact zero or a monetary cost.
- A non-capacity native `blocked` result or clarification is a handoff, not an instruction to cancel delegated work. Existing workflows keep their state and may finish deployment observation, review or manual delivery. Explicit stop/cancel and authoritative external failure remain meaningful; obsolete quotas cannot stop delegated work. Reconciliation checks ownership and actual external state during a handoff without automatically replacing a supervisor. After existing actions finish, the owner may continue through a fresh native execution for final acceptance; old attempts and cancelled historical runs are not rewritten or revived.

## Coordinator capacity recovery

`IntakePolicy.recovery` is optional. Stored legacy outcomes without `smartRetry` keep automatic retry off. New `smartRetry:true` outcomes enable eligible capacity recovery when no explicit override is present. Technical backoff defaults to 30 seconds and the fallback-model pool starts empty. Historical `maxAttempts` values do not limit retries. Automatic recovery requires a useful next action; repeated unchanged failure returns for owner attention rather than replaying.

Only a native capacity code or a precise native capacity message can schedule an automatic recovery. The message `Selected model is at capacity. Please try a different model.` is recognized. Generic rate limits, a task's `blocked` result, permissions, budget limits, cancellation and unknown cleanup are not capacity failures.

Automatic recovery retains the known current model or uses only an explicitly allowed fallback that provides a new useful action. Every selected model is validated against the actual catalog. There is no implicit model upgrade, price inference, configuration refresh or permission change.

Waiting uses `retry_wait` and `nextRetryAt`. The existing engine reconciliation tick starts an eligible recovery when due; there is no additional cron or polling loop. A restart turns an unowned scheduled recovery into an interrupted failure requiring inspection; it never continues an unknown native execution automatically.

## API and stored contract

`POST /api/intakes/:id/retry` calls `service.retry(id, input, actor)` with:

```ts
{ note: string; model?: string; refreshConfiguration?: boolean;
  policy?: { maxRounds?: number; maxTotalTokens?: number; maxElapsedSeconds?: number;
    recovery?: GoalRecoveryPolicy } }
```

Creation configures the same recovery policy under `policy.recovery`. Recovery history records trigger, status, reason/note, selected model, previous/new run IDs and native refs, basis revisions, and explicit policy changes. Read responses expose `canRetry` and `retryBlockedReason` for the current safety state. UI and server integration are delivered by their respective owners.

## Focused acceptance evidence

Synthetic tests cover capacity-only classification; legacy default-off behavior; same-goal recovery beyond old quotas with preserved evidence; actual-catalog validation; future-basis refresh; duplicate-start protection; unknown cleanup and active-child rejection; technical backoff and fallback allowlists; restart interruption; omitted execution quotas; and blocked-supervisor handoff to existing manual/deployment work. Stop/cancel and real account/permission boundaries remain effective. No paid model call is required for these checks. Root integration separately verifies the local API/UI; synthetic checks do not establish successful provider recovery or artifact delivery.


## Unified work recovery

A failed task is a recoverable work item with one current reason and one primary action. Outcome details and project/global work lists lead to the same recovery surface. A person can choose Retry failed step directly; checking the old external execution is part of that action, not a prerequisite they must discover elsewhere. Detailed provider errors remain inspectable.

New outcomes enable smart retry by default; existing stored outcomes retain their opt-in behavior. A persisted flag makes this choice inspectable without numeric setup. The coordinator waits while recovery checks are active. Use model-free observation of the exact owned task and authoritative terminal/daemon proof, shared with manual reconciliation. A cancellation acknowledgement, missing task or expired check is never termination proof. Background confirmation retains its persisted 60-second technical deadline across restart. Expiry exposes Needs attention without killing an unknown task or dispatching its replacement.

Smart retry supports Codex/Multica stages with termination proof; GitHub dispatch/observation and unsupported executors require a handoff. Retry only the failed step with a supported transient cause after owned cleanup and current account admission. Preserve its snapshot, model, permissions, completed independent work and earlier attempts. A repeated unchanged failure requires attention and does not replay the pipeline. Legacy timeout records remain inspectable, but GWI no longer creates a model deadline. Business blockers, human review, permission/source errors, unknown dispatch and cancellation require a specific handoff. Approved capacity fallback policy remains the only authority to change models.

Manual continuation and automatic recovery share identity/generation locks. Stop cancels pending confirmation/backoff and prevents late account/provider responses from dispatching work. A failed or stale account observation must not be bypassed; background refresh is model-free and an allowance decision requiring owner input becomes Needs attention. Recovery states, exact target, reason, counters, next check and deadlines are durable and auditable. A completed target returns to ordinary coordinator acceptance; recovery itself cannot declare delivery complete. Native compatibility recovery retains its existing cleanup rules.

Acceptance includes delayed/lost cancellation responses, optional message-read failure after terminal proof, exact task identity, technical confirmation deadlines across restart, repeated unchanged failure escalation, legacy opt-in behavior, preserved account admission, Stop races and model-free bilingual browser operation. Public evidence distinguishes these checks from a paid provider run or successful completion of the original request.
