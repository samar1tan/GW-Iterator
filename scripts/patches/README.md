# Multica execution compatibility

`multica-supervised-execution.patch` applies only to upstream revision `a097f592be73067d56908ca50ece557fa2af1293`. It is a separately maintained adaptation of Multica, subject to [Multica's pinned license](https://github.com/multica-ai/multica/blob/a097f592be73067d56908ca50ece557fa2af1293/LICENSE), not a relicensing of that dependency as original GWI source.

The opt-in `MULTICA_GWI_SUPERVISED_EXECUTION=1` passes a supervised-execution option to the Codex backend. Only that mode disables the model semantic-inactivity and first-turn silence clocks. Upstream defaults are unchanged when the option is absent. Startup RPC handshakes, cancellation confirmation, native permissions, task ownership and result verification keep their existing behavior. The patch adds an independently authored synthetic RPC test and reports the effective option and patch hash in daemon health.

The setup script verifies the original clean source and exact revision, creates a separate `upstream-gwi` build checkout, applies the hash-pinned patch, and requires its complete diff to match the reviewed patch. It never edits the original upstream checkout. Generated manifest/profile records and serving health distinguish the adaptation from the upstream build. The ordinary daemon has no GWI model deadline or inactivity cutoff; actual upstream resource availability may still queue independent tasks.

Existing services are not restarted by `--check`. An old execution profile cannot authorize new work under the revised contract. `--refresh-runtime` requires the dedicated daemon to have been stopped and all pending work reconciled; it rebuilds only that runtime and retains backend data and authentication. It refuses to kill a live process or replace uncertain work.
