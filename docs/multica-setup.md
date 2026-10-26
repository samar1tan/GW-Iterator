# Local Multica runtime

GWI uses the real [Multica backend and daemon](https://github.com/multica-ai/multica) for projects, agents, skills, tool bindings and task execution. The setup command builds the dependency at commit `a097f592be73067d56908ca50ece557fa2af1293`; it does not substitute a mock or depend on a mutable `latest` backend image.

## Start and check

From the GWI checkout:

```sh
node scripts/setup-multica.mjs
node scripts/setup-multica.mjs --check
```

The prerequisites are Node.js 24–26, a running Docker engine with Compose, Git, `/usr/bin/curl`, and an installed, authenticated Codex CLI. macOS is the verified native execution platform. Linux hosts must pass the same native permission probes; Windows is not claimed as supported by this setup. Docker is used for the backend, database and Go build toolchain. Go and Multica are not installed globally.

The first setup needs network access to the official Git repository, container registries and Go dependencies. It can take several minutes. Progress identifies the current step; detailed output stays in the private `setup.log`. No model turn is started by setup or check.

Optional advanced arguments are `--state-dir .local/name`, `--codex-bin PATH` and `--model MODEL`. The default model is `gpt-6.1-sol`; setup verifies that it exists in the selected CLI's actual catalog. There is no implicit fallback to another model or a premium service tier. On macOS, setup checks the installed desktop application's bundled Codex before the PATH fallback. It never installs or upgrades Codex.

## Created state

The default private instance directory is `.local/multica/`. A different directory beneath `.local/` creates a separate instance. Its deterministic Compose project name keeps containers and volumes separate from other installations.

- `connection.json` contains the local backend URL, workspace identity and bearer token. It is server-side configuration, not a browser response.
- `execution-profile.json` contains the actual runtime/daemon references, verified permission profiles, baseline and serving daemon identity.
- `authorized-roots.json` has the shape `{ "roots": ["absolute authorized directory"] }`. Initially it permits only the instance's task workspaces. GWI may add its controlled execution root after resolving it. Adding a working directory does not import the user's home or the main checkout into a task.
- `codex-home/` contains generated minimal configuration and a symlink to the existing native Codex authentication file. GWI never reads or copies that authentication file's contents. File-backed native authentication must already exist; keychain-only login is not automatically migrated.
- `daemon/` contains one named Multica profile. A dedicated symlink under `~/.multica/profiles/` points to it. The default Multica profile and global Codex configuration are not edited.
- Backend uploads and PostgreSQL state use this instance's named Docker volumes. Setup does not delete them to repair a failure.

The backend publishes only `127.0.0.1` on an available host port. PostgreSQL has no published host port. Backend deployment telemetry and PostHog are disabled. The local owner, workspace and expiring PAT are generated through Multica's real authentication and management APIs. No personal email, external email service or manually pasted provider token is needed.

## Effective native permissions

The runtime uses two generated, named Codex permission profiles:

| GWI mode | Native profile | Filesystem | Network |
| --- | --- | --- | --- |
| Read only | `gwi-readonly`, extending `:read-only` | Native read-only policy | Enabled |
| Workspace write | `gwi-workspace`, extending `:workspace` | Native workspace policy | Enabled |

Both inherit the native baseline protections. These are native policies, not instructions in a prompt. Network access permits the agent to communicate with the local Multica service; it is not restricted to localhost or a domain allowlist. GWI does not claim filesystem read isolation. Native temporary-directory access remains governed by Codex's profile.

The guard accepts only these profile names. It removes the pinned daemon's sandbox block from the task's owned configuration before launch, so legacy `sandbox_mode` settings do not silently override the named profiles. Other task configuration, including managed MCP entries, stays intact. Unknown mixed legacy settings fail closed. Explicit read-only selection is preserved. Approval is `never`, the default tier is standard, and the default reasoning effort is low.

The app-server process itself starts inside the authorized execution directory. Setting only a later RPC's `cwd` is insufficient: stateless commands can retain the server's original workspace roots. The guard rejects task launches from other directories. It also refuses unexpected native approval requests and checks the effective thread permission response before forwarding it to the daemon.

Setup and check run commands without a model turn. Workspace mode must write its probe file, reject a sibling write and reach backend health. Read-only mode must reject both writes and reach backend health. A dependency error that prevents every command from running does not count as successful confinement. The active native login and installed model catalog are also checked without exposing account details.

The named-profile contract is documented in the official [Codex permissions reference](https://learn.chatgpt.com/docs/permissions). The pinned CLI behavior and probe result remain the acceptance evidence; configuration labels alone are insufficient.

## Identity, restart and failures

A successful check verifies the backend, authentication, online runtime, both native permission modes, and the owned daemon's actual PID, profile, daemon ID and full build commit. `execution-profile.json` uses the same fields after setup and check:

```text
verified, runtimeId, daemonId, provider, version, baseline
permissions.readOnly / permissions.workspaceWrite: name, args, verified, network
scratchHome, authorizedRootsFile, guardBinary, approvalPolicy, serviceTier
network, readIsolation, daemon: healthUrl, pid, profile, daemonId, cliCommit, startedAt
```

`verified` describes runtime prerequisites and permission probes. It does not claim a paid model execution or a valid role deliverable. Model outputs still require the configured output validation, checks and review.

Rerunning a healthy instance checks it and reuses its services and account. An exclusive setup lock prevents concurrent duplication. A changed source checkout, unknown serving process, stale authentication, pending task or failed permission probe stops the operation with its step name. Read the private log, correct that prerequisite and rerun. Setup does not weaken the sandbox, delete the database, choose a different model or blindly restart pending work.

A cancelled backend task is not proof that the provider process has stopped. The daemon health identity can support conservative reconciliation: the same frozen PID, daemon ID and commit with `active_task_count` equal to zero has no claimed task lifecycles. A replacement process or unreachable health endpoint leaves cleanup unknown. Old run records must retain that uncertainty.

For manual shutdown, use the instance's named Multica profile and generated Compose file. `docker compose ... down` retains volumes unless the operator explicitly requests their removal. No automatic uninstall or volume deletion is performed by setup.

## License and validation

GWI's original source is separate from the Multica dependency. This product is built on Multica. The dependency's complete [Multica License](https://github.com/multica-ai/multica/blob/a097f592be73067d56908ca50ece557fa2af1293/LICENSE) and [NOTICE](https://github.com/multica-ai/multica/blob/a097f592be73067d56908ca50ece557fa2af1293/NOTICE) are retained in the generated backend image and source cache. Its incorporated Apache text and additional conditions form one license; it must not be described as unmodified Apache-2.0. Internal self-hosting, third-party hosting, commercial embedding, interface branding and non-interface attribution have different conditions.

Focused synthetic tests cover instance naming, private setup locking, permission mapping, exact upstream sandbox-block handling, probe rejection, serving identity checks and unexpected approval denial. The pinned backend/auth/API and native macOS permission modes were also exercised locally. Full bootstrap automation must be accepted by running the command and `--check` in an independent private profile; unit tests do not establish that installation result. Linux and Windows execution are not covered by the macOS evidence.
