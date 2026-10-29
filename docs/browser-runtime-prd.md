# Browser verification in protected executions

## Required behavior

A role authorized to verify a local web journey must be able to operate Chrome without launching the macOS application from its restricted command runner. GWI hosts an independent Playwright browser session and exposes a narrow `browser.use` tool through the existing execution-scoped, authenticated MCP lease. Native code permissions and approval policy remain unchanged.

The owner enables the tool on a project role and supplies exact local HTTP origins in `role.browser.origins`. These choices are part of the frozen role revision. Existing roles, runs and attempts gain no capability automatically. Missing browser configuration or an unavailable host browser is an actionable prerequisite failure, never a successful verification. A separate follow-up execution may verify earlier prepared work; it must retain the earlier attempt and its unverified checks.

## Authority and lifecycle

- Each browser belongs to one project, run, stage, attempt and execution workspace. The model cannot select another identity, browser profile, executable or output directory.
- Allow only configured loopback HTTP origins. Reject credentials, non-HTTP navigation, redirects and requests outside that set. Always exclude the serving GWI, connected Multica and runtime control origins. Browser page content is untrusted task material.
- Provide navigation, accessibility snapshots, click, fill, key, viewport, file upload/drop/paste, screenshot and close operations. Do not expose host JavaScript evaluation, shell commands, arbitrary downloads, unrestricted files or the user's browser profile.
- Uploads read ordinary files inside the authorized execution workspace. Reject hidden paths, source-control internals, symlink escapes and non-regular files; transfer bytes from an inspected open handle instead of passing a mutable path to Chrome. Screenshots use server-selected names under private local attempt storage.
- An authenticated per-session HTTP proxy validates destinations before forwarding and preserves streaming responses. Block all HTTP redirects, WebSockets, service workers and downloads; navigate explicitly to an authorized destination. Chrome's WebRTC IP policy disables direct UDP and QUIC is disabled. These controls do not change the native runner's separately documented network policy or claim operating-system network isolation of a compromised browser.
- Serialize operations within a session. Cancellation, execution completion, revoked MCP authority and service shutdown close the session, including an in-flight launch. An expired request must not recreate a session. A failed browser session remains failed until a new explicit execution; do not repeatedly launch an unchanged failure.
- Retain actual browser observations, operation receipts and cleanup status with the execution. Technical launch/action/cleanup deadlines do not impose model duration, token, round or concurrency quotas.

## Interaction and verification

The role editor shows a browser tool choice and an adjacent list of allowed local test origins. Explain that changes apply to future runs. Invalid origins remain an editable error; saving a role does not claim the browser has passed a runtime check. English and Simplified Chinese expose the same capability and boundaries. Reusable role templates carry the tool requirement, while project-specific origins remain a local binding.

Verification includes authenticated MCP calls, frozen-role forwarding, isolation between attempts/projects, restricted requests/files, cancellation/launch races and cleanup. File drop/paste operations dispatch synthetic browser events and must not be described as operating the system clipboard. A real protected Codex command must call the hosted tool to navigate and click a synthetic local page while sibling writes remain denied. Provider/model execution, source review, browser checks, CI and publication are separate evidence. Do not replay the original product workflow merely to test browser startup.
