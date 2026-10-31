# Supervised stage execution without numeric quotas

## Product decision

A stage is a responsibility, its working context, expected result and verification/handoff contract. GWI lets the owner supervise, guide, pause and stop the work. It does not predict the difficulty of that work or Codex's variable throughput by assigning a fixed execution quota.

This revision supersedes numeric execution limits in earlier product, recovery and allowance documents. It removes GWI-enforced stage/pipeline concurrency quotas, attempt counts, iteration counts, action-round counts, model execution deadlines and token budgets. Supervising goals, entry flows and connected runtimes must not reintroduce those restrictions around the same work. Increasing a default, using a very large sentinel, or hiding a quota field does not implement this decision.

## Execution and observation

- Ready stages and independent delegated work can proceed when their dependencies and the actual runtime allow it. Resource availability may queue work; GWI must not present a fixed product concurrency quota as a prerequisite.
- An executing model task continues until its actual result, an owner action or an applicable boundary. Variable duration and token usage are observations, never automatic reasons to terminate it.
- Retry/rework and loop mode follow new evidence and the requested outcome. Preserve accepted work, prior attempts, revision identity and consumption history. Do not stop solely because an arbitrary attempt, round or iteration count was reached.
- Automatic recovery requires confirmed termination, a supported transient cause and evidence supporting a useful next action. An unchanged failure or repeated output requires attention rather than an automatic replay. This is a verified progress boundary, not a numeric retry allowance. Model fallback still requires an explicitly allowed model.
- Human and external-service waits use events or model-free observation. Transport requests, permission probes, cancellation confirmation, reconciliation and backoff may have technical deadlines; expiry reports an observation/recovery problem and must not pretend the model task ended or dispatch a replacement without termination proof.
- Preserve a failed provider task's actual error as the primary failure. Independently record source-integrity observations and cleanup; an unavailable integrity observation is not proof that source changed. A completed verifier with changed source is rejected, and a completed verifier whose integrity cannot be established remains unverified. Neither case supplies acceptance evidence. Provider refusal is a real boundary, not an instruction to retry unchanged or evade its safeguard.
- Keep untracked private scratch outside source evidence. A nested repository reported by Git as a directory inside excluded verification scratch is still private scratch, not an unsafe source entry. Tracked private input and unsafe included source remain rejected; never broaden the included manifest or read private fixture contents to make verification pass.
- Token, attempt, iteration and duration records remain truthful diagnostics. Real Codex account exhaustion and actual provider capacity remain external availability boundaries; account observation uncertainty retains the explicit owner decision. GWI cannot remove provider limits or promise unlimited resources.

## Boundaries retained

Preserve project/workspace scope, native permissions and approvals, source protection, private local state, credential handling, revision pinning, dependencies, human review and delivery gates, allowed models/tools, idempotency, authoritative external execution identity, explicit pause/stop/cancel, outcome verification and stagnation escalation. No permission or required check may be weakened to continue work.

Browser journeys use the explicit role capability and hosted session described in [Browser verification in protected executions](browser-runtime-prd.md). Host browser access is separate from native command permissions and must not be inferred from a passing command/filesystem probe.

## Historical and API compatibility

New definitions and starts do not require or emit numeric execution quotas. Existing stored policy values, approved extensions, counters and frozen snapshots remain readable historical evidence, but must not constrain newly dispatched or continued work, including work resumed after restart. Do not rewrite private project files or old attempts. Old API quota fields may be accepted as deprecated inert metadata with valid shapes; they must not enable enforcement. Remove quota-extension recommendations, approval gates and ordinary/advanced quota editors. A pending continuation based only on a removed quota can proceed after the remaining real boundaries are freshly checked.

## Acceptance

Use independently authored synthetic tests to cover long-running and high-usage work, more attempts/rounds/iterations and parallel work than the former limits, legacy snapshots and restart, both direct pipeline and goal entry, failed-step continuation, and native/Multica execution forwarding without hidden quotas. Verify stop races, source/permission protection, account exhaustion, human gates, unknown external termination and unchanged-failure escalation. Operate affected authoring, launch, history and recovery views in English and Simplified Chinese. Existing token/duration records remain available without quota inputs or refill prompts. These checks do not establish provider capacity, a paid task result or complete-product acceptance.
