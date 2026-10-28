# Stage supervision without execution quotas

The [product contract](../stage-execution-prd.md) removes GWI numeric execution quotas while preserving project scope, native permissions, actual account availability, human decisions, authoritative termination checks and owner control. Historical execution policy values remain readable without constraining new or continued work.

## Source and protocol verification

The local complete suite reported 773 tests: 772 passed, one existing optional protected-runtime probe skipped, and no failures. Typecheck and the production build passed with the existing dependency directive and bundle-size warnings. These are engineering results, not complete-product or provider acceptance.

Focused coverage includes work beyond the former concurrency, attempt, iteration, action-round, time and token ceilings; direct and supervised entry; legacy policies; restart and continuation; account exhaustion and exact owner permits; review/source protection; Stop races; unknown cleanup; task-scoped capability revocation; and immutable earlier attempts.

No-progress cases cover repeated and alternating revision/loop outputs, capacity errors with changing request IDs, repeated failed dispatch/retry, unrelated successful command output, empty native turns and different underlying failures sharing a generic provider error code. Useful new owner guidance remains actionable. Rejected retries do not leave a partial decision or audit record.

The pinned Multica adaptation was applied in a separate clean build checkout. Synthetic Go checks passed for silent model work with the opt-in both disabled and enabled, upstream inactivity behavior, and daemon health identity. HTTP tests reject stale or mismatched process/patch/deadline proof, allow concurrent active work, and cover complete paginated pending-task checks before a stopped runtime can be refreshed. CI also applies the exact patch and runs the focused Go checks.

## Operational checks

A separate loopback instance served the production frontend and API with an independently authored synthetic Git project and a controlled native RPC executable. It made no model, external CI or publication calls.

- English and Simplified Chinese authoring retained responsibility, actions, checks, dependencies and review controls without quota inputs. Legacy values appeared only as explicitly non-enforcing history.
- The JSON editor accepted an old-format definition, normalized the editable policy to an empty object, and saved its new revision. Invalid JSON retained the draft and required correction before saving.
- Saved-pipeline launch required a concrete outcome and displayed actual controlled account windows without quota setup. A failed stage accepted owner guidance, retried only that step and retained both the failed and successful attempts, without an extension approval.
- A run whose frozen legacy policy specified five seconds and 100 tokens was still running after 44 seconds despite a synthetic reported total of 9,001,000 tokens. The owner then stopped it through the ordinary interface, and the recorded run converged to cancelled. Those usage numbers are deliberately synthetic protocol evidence, not actual provider consumption.

The runtime update is an installation prerequisite. Existing production daemons and private project bindings were not restarted or rewritten by these checks. An old or unverifiable runtime must follow the [documented update path](../multica-setup.md#supervised-execution-and-existing-runtimes); a policy label alone cannot establish the new behavior. Actual provider execution after that update and complete-product acceptance remain separate evidence.
