# Global workbench

## User outcome

A person can supervise ordinary work across connected projects from the top-level Projects page. They can see what is progressing or needs their input, submit work, inspect a result, reply or review, and continue without entering a project's dedicated workspace.

The implemented [goal attachment increment](goal-attachments-prd.md) applies to the global request, follow-up, clarification and recovery entries. Files follow the explicitly selected target and existing project boundaries. See the [bounded verification record](acceptance/human-journey-review.md#goal-attachment-inputs) for evidence and remaining delivery work.

## Scope and relationships

- Projects remains the top-level destination and includes the global workbench. Keep project workspaces as optional focused destinations.
- Aggregate current outcomes, direct executions, human decisions and recent results from authoritative local state. Do not count a coordinating outcome and its owned executions as separate top-level work.
- Every work item and action has a visible project. A request submitted here targets one explicitly selected project and uses its ordinary coordinator, workflows, configuration, source/account admission and execution boundaries. Selecting a project is not entering its workspace.
- This increment does not add a privileged cross-project coordinator, automatic multi-project fan-out, global role inheritance, knowledge lifecycle policy or new model settings. The page observes multiple projects; existing execution remains project-scoped.

## Ordinary journey

1. Open Projects and see current work, needed decisions and recent results across projects. Filter by project without changing navigation level.
2. Select a target beside the request composer, write a question or desired change, and submit using the ordinary request path. Retain unsent text per project and use the existing idempotency/account behavior.
3. Open the receipt or another work item in the global detail area. Keep the project identity and global return path visible. Read live execution feedback and evidence with the same components as the project workspace.
4. Reply to a clarification, submit a related follow-up, complete a manual handoff, review changes or control an execution here. Preserve previous/child relationships and return to the global view.
5. Enter the dedicated project workspace only when choosing to manage its team, library, knowledge or settings.

## Observation and durability

The global summary is a lightweight read projection with no model work and no duplicated project configuration or knowledge payload. Project-scoped agent credentials cannot use it to enumerate another project. Active work and actionable decisions are never hidden behind the recent-history limit. Recent history has explicit expansion rather than silently dropping older entries.

Use project-qualified identities throughout. Preserve authoritative creation/continuation receipts when a refresh fails or an older observation arrives. A late mutation must not move a person away from a newer selection. A failed summary/detail read retains the last usable data with stale feedback, and never reports provider liveness from polling success alone. Changing filters or detail selection does not dispatch work.

## Global connection status

The upper-right header shows Multica connection health even before any project exists. Observe the existing sanitized `GET /api/platform` response after the local session is ready; project filters, request targets and selected work do not supply this status. Keep this observation independent from overview, summary, project-detail and team reads. It performs no task creation, model execution, team preparation or configuration changes.

Distinguish checking, not configured, connected, connection failure, authentication failure and observation failure. A failed or malformed read must replace any earlier connected indication with an unknown/read-failed state. A later successful observation restores the actual state. Observe periodically while visible and on returning to the page, with no overlapping requests; cancel outstanding observation on teardown. Background refresh does not flash a checking state over a completed observation.

Connection health means service availability and authentication only. It is not evidence of a working model, running task or accepted result. Use localized explanatory text rather than rendering raw backend errors or connection configuration. Keep the existing compact status style and accessible text at narrow widths. In the global shell the indicator is read-only and preserves the current selection; in a project it retains the existing Team navigation.

The Team page keeps its independent observation and error recovery. A failed team read is labeled unavailable, not proof that the global service disconnected.

## Interface contract

Keep one clear request area, a compact project filter, and work/attention/result sections. Omit redundant empty panels and prose. Surface the current outcome, stage or requested decision; raw audit events remain inside execution details. Reuse existing state-driven execution feedback and motion rules. Provide English and Simplified Chinese, keyboard operation, long-title wrapping and narrow-screen containment.

## Acceptance

- From the global page, create a question, read its result, ask a follow-up and answer a clarification without entering a project route.
- Observe work in two independent projects and complete a real manual decision through the global detail surface. Controls operate on the intended project/run/stage only.
- Verify active and attention items, owned-run deduplication, completed answers, failed/stopped states and expandable older results.
- Verify project-scoped summary authorization, invalid/cross-project selection, stale observations, failed refresh after an acknowledged start, late receipts and draft preservation.
- Exercise the rendered journey in both locales at desktop and narrow widths. Controlled/model-free execution is labeled separately from paid provider verification.
- Verify the header with no projects, existing projects, global filters/details and project/global round trips. Exercise checking, unconfigured, connection/authentication failure, read failure after connected and recovery. Confirm connection observation issues only reads and keeps project Team navigation.
- Preserve real project configuration, work and permissions. Keep fixtures, private configuration and captures local. Record independent findings and unresolved checks.
