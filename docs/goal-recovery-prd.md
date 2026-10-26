# Goal recovery after native capacity failures

Scope: the original native-goal compatibility path. The integrated Multica coordinator uses the same cumulative recovery boundaries with provider-specific references and cleanup checks; see the current [API contract](API.md#goal-entry) and [product requirements](PRD.md#loop-engineering).

Owner: the goal execution backend. Independent review: the root integrator. This document adds a bounded recovery path to the current local release; it does not reopen the original product scope.

## User outcome

A temporary model-capacity failure must not erase an investigation, repeat completed work, or silently authorize a different model. The user can continue the same GWI goal through a fresh owned native execution, with the original request, action decisions, evidence, usage and limits retained.

## Scope and behavior

- Recovery creates a new owned native goal. It never resumes or reactivates a cleared or uncertain native goal. `routerRunId` identifies the latest supervisor run; `supervisorRunIds` retains every supervisor run in order. Existing run snapshots remain immutable.
- Manual recovery requires a note, a terminal previous native run, confirmed native cleanup, and terminal child runs. Completed goals cannot be retried. A recovery already starting or running cannot be started again.
- A requested model must be an ID in the actual adapter model catalog. Without an override, recovery retains a known previous requested/effective model; it does not guess a model from a catalog's default marker. The override applies to the native supervisor only. Delegated roles retain their project configuration; refreshing that configuration is a separate explicit choice. Earlier role/run snapshots are unchanged.
- `refreshConfiguration` defaults to false. A manual request may refresh the future project, workflow and current knowledge basis. Each basis revision is retained, with project/workflow revisions and source knowledge hashes. Automatic recovery never refreshes configuration.
- Manual requests may explicitly extend the action-round, total-token or execution-time limit. Limits can increase within their existing validation bounds; the required note and previous/new policy are audited. Already-used action rounds, consumption and execution time are cumulative and never reset. Completion checks the most recent dispatch with real accepted targets, even when a later stop or clarification decision exists, and still requires all linked work to be terminal. `active-windows-v1` merges the actual supervisor/child execution intervals, so parallel work is not added twice; scheduled recovery backoff counts, while idle time after a stopped/failed execution does not. `createdAt` remains the original wall-clock creation time. Legacy timestamps supply the intervals without rewriting old snapshots, and the first recovery records the meter migration. A new native execution receives only the remaining reported token allowance and remaining execution time.
- The GWI token meter uses the shared `budgetTokens` helper over reported `Usage`; raw counts and the native goal meter remain distinct. Missing usage remains unavailable and is not described as an exact zero or a monetary cost.
- A non-capacity native `blocked` result or clarification is a handoff, not an instruction to cancel delegated work. Existing workflows keep their state and may finish deployment observation, review or manual delivery. Explicit stop/cancel, exhausted execution bounds, capacity failure and failed native cleanup still stop delegated work. The reconciliation tick continues to enforce the shared bounds during a handoff but never starts a replacement supervisor automatically. After the existing actions finish, the user may explicitly continue through a fresh native execution for final acceptance; old attempts and cancelled historical runs are not rewritten or revived.

## Automatic recovery

`IntakePolicy.recovery` is optional. Defaults are automatic retry off, two automatic recovery attempts, a 30-second backoff and an empty fallback-model pool. `maxAttempts` bounds automatic fresh executions across the same GWI goal; manual recovery does not reset that counter or the goal's other limits.

Only a native capacity code or a precise native capacity message can schedule an automatic recovery. The message `Selected model is at capacity. Please try a different model.` is recognized. Generic rate limits, a task's `blocked` result, permissions, budget limits, cancellation and unknown cleanup are not capacity failures.

The first automatic recovery retries the known current model. Later attempts can use only the explicitly allowed fallback pool. Every selected model is validated against the current actual catalog before starting. There is no implicit model upgrade, price inference, configuration refresh or budget extension.

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

Synthetic tests must cover capacity-only classification; default-off behavior; same-goal manual recovery with preserved evidence and cumulative limits; actual-catalog validation; optional future-basis refresh; explicit policy audit; duplicate-start protection; unknown-cleanup and active-child rejection; finite scheduled backoff and fallback allowlist; restart interruption; remaining-budget/time forwarding; and a blocked supervisor handing off to existing manual/deployment work before an explicit final continuation. Stop/cancel, capacity and execution bounds must still clean up that work. No paid model call is required for these checks. Root integration must separately verify the local API/UI and any actual provider recovery; synthetic checks do not establish a successful website repair.
