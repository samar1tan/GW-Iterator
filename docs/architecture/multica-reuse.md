# Multica integration

GWI connects to the real [Multica](https://github.com/multica-ai/multica) backend and daemon at source revision `a097f592be73067d56908ca50ece557fa2af1293`. The integration uses the pinned App API; it is not only a source assessment or a frontend mock. The [local setup command](../multica-setup.md) builds the separate dependency and verifies native permissions without a model turn.

The [reviewed execution adaptation](../../scripts/patches/README.md) is applied only in a separate build checkout. Its explicit opt-in disables model silence deadlines while GWI removes task time/token/count quotas. The original upstream defaults, licensing, sandbox and approval policy remain distinct. Each dispatch verifies live daemon identity, patch hash and the actual disabled task/idle/tool clocks. Provider resource queuing, transport deadlines, cancellation proof and project scope remain boundaries. Legacy runtime profiles require a verified update rather than an edited capability label.

| Authority | Responsibility |
| --- | --- |
| Multica | Projects, agents, skills, MCP connections, queued tasks, native execution, task messages and actual provider results. |
| GWI | Project knowledge, frozen workflow/role bases, dependencies, supervised decisions, review/rework, progress verification and accepted outcomes. |
| GitHub | Repository, pull request, CI and publication facts observed through the connected CLI. |
| Supervising owner | Consequential scope decisions and acceptance of actual delivery evidence. |

A GWI stage has one execution authority. The adapter persists an assignment intent before creating a task-bearing issue. A lost response is not permission to repeat a mutation. Reconciliation requires matching project, assignment, agent, runtime and task identities. Preparing an agent or a connection is distinct from dispatching model work.

Each bounded goal decision ends before GWI waits for child work or a person. A stage DAG describes local dependencies; successive decisions, review returns and scoped retries form the larger iteration loop. Earlier accepted work, attempts and reported consumption remain inspectable. Legacy native-goal records and the native adoption/discovery adapter remain distinct compatibility paths.

Workers use standalone committed-source checkouts. Generated role agents are immutable revisions; project custom agents and shared templates have explicit copy/binding behavior. Task-scoped MCP capabilities expose selected GWI tools without the owner token. Native sandbox behavior is tested separately from role instructions. Network access is enabled for local service communication and is not claimed to be restricted to localhost; filesystem read isolation is not claimed.

Provider completion, valid structured output, independent verification and accepted delivery are different facts. Metadata synchronization cannot establish product acceptance or authorize another model execution. Exact references and unknown states are retained rather than replaced by invented success or cost data.

Multica remains separately installed and licensed. Its complete license includes additional conditions beyond the incorporated Apache text. Read [the pinned license](https://github.com/multica-ai/multica/blob/a097f592be73067d56908ca50ece557fa2af1293/LICENSE), the setup guide and [third-party notices](../../THIRD_PARTY_NOTICES.md). GWI does not relicense upstream source or include private runtime settings.

Primary integration references: [self-hosting](https://github.com/multica-ai/multica/blob/a097f592be73067d56908ca50ece557fa2af1293/SELF_HOSTING.md), [App routes](https://github.com/multica-ai/multica/blob/a097f592be73067d56908ca50ece557fa2af1293/server/cmd/server/router.go), and [workflow documentation](https://multica.ai/docs/workflows). Runtime observations and synthetic protocol tests are separate from product acceptance.
