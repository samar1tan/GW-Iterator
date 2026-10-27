# Account-aware execution allowance

This iteration replaces raw token budgets as the ordinary user's execution allowance. It supersedes token-increment recommendations in the [human workbench](human-workbench-prd.md); previous attempts, configuration snapshots and consumption remain historical evidence.

## Outcome

A person can decide whether to start, continue, wait or reduce the scope using the connected Codex account's remaining allowance and recent comparable executions. They do not estimate a token count or repeatedly refill a software-defined quota. GWI balances Codex's flexible approach with bounded attempts, time, verified external state and delivery checks.

## Sources and interpretation

- Read `account/rateLimits/read` through the installed local Codex app-server and its existing authentication. No credential-file reads, model turns, reset redemption, credit purchase or notification messages are part of this feature.
- Prefer `rateLimitsByLimitId` when present. Preserve the identity and duration of each returned bucket/window and its actual reset timestamp. Do not assume `primary` means five hours or that a missing window is unused. Never convert tokens to subscription percentages, credit balances or fees.
- Account observations are private local state. Return only sanitized allowance windows and timestamps to the owner interface. Account identity is hashed for history separation; never publish account observations, fingerprints or real execution samples.
- Account allowance is shared with other projects and Codex sessions. A before/after change is an observed account change, not proven task-specific consumption. Resets, account changes, stale readings, overlapping GWI executions and missing windows invalidate a comparable delta. External activity cannot be excluded and remains an explicit uncertainty.
- Learn from actual execution attempts, grouped by task/stage, executor, model and reasoning effort. Show sample count, observed range and recent direction; do not invent a trend for zero samples or treat rounded zero change as free execution. A range is an estimate, not a guaranteed number of remaining tasks.

## Behavior

1. Normal starts and continuations use account-aware allowance. Show the current limiting account window, reset time, observation age and applicable execution trend. An explicit historical token cap remains readable as technical history; it must not force the normal user to top up arbitrary numbers.
2. Check allowance again before a paid dispatch. Known exhausted windows stop new model work and offer refresh/wait with the provider's reset time. Manual work and unchanged human/CI waits do not require model allowance.
3. Healthy allowance with insufficient comparable history can fund one already-requested bounded execution and collect evidence. Do not fabricate a task-count prediction. Close-to-exhaustion trends request a concrete one-step continuation decision or suggest waiting/reducing scope; display the evidence and uncertainty first.
4. Missing/unsupported/stale account data is explicitly unavailable. It cannot silently authorize an automatic loop or be rendered as zero usage/unlimited capacity. Permit a deliberate bounded owner continuation when the external task is known ended; preserve attempts/time bounds and record that the account check was unavailable.
5. Technical token counters remain diagnostics and finite executor safeguards. They are not the user-facing allowance unit or a subscription-cost exchange rate. Preserve legacy APIs and explicit expert token caps; newly authorized ordinary work uses an auditable account-aware policy instead of repeatedly raising those values.
6. Decisions and one-step approvals are tied to current account observation, execution generation and recovery identity. Stop, changed account/window, another continuation or unresolved external execution invalidates a stale approval. Parallel work shares the account view; do not promise the same estimated remainder independently to each worker.
7. Refresh without paid work and cache ordinary reads. Record before/after observations around real GWI executions. Continue collecting task duration/outcome and diagnostic usage when account deltas are unavailable. Do not run paid probes merely to manufacture initial history.

## Human interface

- Present an account allowance summary near start/continue: remaining percentage for actual windows, reset time and a useful readiness assessment. Keep the shared-account meaning visible.
- Present an execution trend beside the task: actual sample count, comparable model/effort and broad observed range/direction when supported. Use an honest sample-collection state otherwise.
- Normal decisions are continue one step, refresh, wait or reduce scope. Keep attempts/time and diagnostic counters in their relevant details; remove raw token inputs and token-increment proposals from ordinary launch/recovery.
- Preserve the GitHub-inspired visual system, stable stage/activity locations, English/Simplified Chinese and fixed English effort names. New controls require actual rendered and operational checks.

## Acceptance

- Native account reads work without a model call and expose no credentials, contact details, credit/reset records or raw provider payloads.
- Focused tests cover missing/malformed/multi-bucket windows, reset/account changes, stale data, shared/overlapping samples, rounded zero change, insufficient history, trend changes and account exhaustion.
- Exercise start/continue readiness, changed-state rejection, manual-only bypass and token-history compatibility through production APIs and the interface. Do not turn model-capacity errors into account-exhaustion errors.
- Verify real local account display and both locales without executing a paid task. Replay independently authored samples for trend behavior; label synthetic evidence and do not install sample history into the user's project.

The account schema is documented in the official [Codex app-server reference](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt). It does not establish a token-to-allowance conversion or task-specific attribution.
