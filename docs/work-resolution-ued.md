# Actionable waiting and failure

Keep the existing workbench and inspectors. The current-work card identifies the waiting reason. The next action appears before checks, result history and technical details.

| State | Primary action | Secondary interaction |
| --- | --- | --- |
| Failed step / healthy account hold | Retry step / Continue step | Optional note; Stop |
| External cleanup unconfirmed | Retry step performs the check first | Check again or open external task if confirmation fails |
| Real account uncertainty or near-limit risk | Approve one bounded step | Refresh; optional note; Stop |
| Account exhausted | Refresh, with reset time | Stop |
| New attempt/time boundary | Approve the displayed finite continuation | Optional note; Stop |
| Manual result or review | Record result / Accept or request changes | Existing result/review form |
| Dependency | Open named dependency | Stop |
| Paused | Resume | Stop |

A requested continuation changes its button to Checking execution, then Continuing step. No fictional progress is shown. When a check cannot complete, the same section explains what remains unknown and offers Check again. Keep the note, selection and confirmed receipt through refresh failure.

A compact account meter shows the last available reading. Its observation timestamp remains available in details. Normal refresh and expiry do not announce warnings or disable the primary request action: submission checks fresh authoritative state. Genuine exhaustion/approval requirements remain distinct and visible. Background polling cannot repeatedly cancel a pending decision read.
