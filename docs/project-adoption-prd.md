# Adopt an existing local project

## Outcome and scope

An owner can give GWI an existing project directory and ask installed Codex to prepare its initial project configuration. They review the evidence and proposed role instructions, knowledge sources and starting workflows before applying it. Manual project creation remains available. This is a small setup module; it does not execute project work, start a goal, run CI or publish files.

Owner: the project-adoption implementation agent. Independent reviewer: the root integrator. Implementation and live-model acceptance are separate evidence.

## Journey

1. Projects offers **Adopt existing project** beside manual creation. The owner supplies an absolute local workspace and may supply a name and `owner/repository` binding.
2. GWI collects a bounded, explicit snapshot of eligible README/AGENTS files, project documentation, package metadata and GitHub workflow descriptions. It records paths, hashes, transformations, omissions and retrieval time. Directory enumeration does not follow symlinks, enter nested repositories, read credentials, import configuration or search agent memory.
3. Installed Codex receives only this selected source snapshot in a read-only execution. It must record a structured proposal through `project.bootstrap`, then return an ordinary task result. Source prose and the final summary are never parsed as configuration. GWI restricts its own source collection; Codex still follows the installed native permissions. Read-only is not a read-isolation boundary, and the interface states that limitation before scanning.
4. A persistent adoption record shows scanning, proposed, applied or failed state, actual native references, observations and errors. Refreshing or reopening setup restores it. A proposal is a suggestion rather than an installed project.
5. Apply requires the exact adoption revision. GWI revalidates its source basis and uses normal Engine APIs to create a project and install reviewed customizations. Generic role identifiers and their existing execution permissions remain; the proposal can customize instructions, selected source files and bounded starting workflows. It cannot add permissions, models, skills, credentials, arbitrary role IDs or dispatch actions.
6. The resulting project opens in the existing Pipelines, Knowledge and Configuration workspace. Existing repository files remain untouched; the first goal is a separate owner action.

## Bounded source and execution policy

- Reject the filesystem root, the user's home and its ancestors as a workspace. Resolve the selected directory before scanning.
- Select a small, deterministic set of text sources inside that directory. Reject symlinks, nested repositories, private/credential/configuration paths, unsupported binaries and oversized inputs. Package metadata is projected to descriptive fields rather than importing arbitrary configuration.
- Keep source snapshots, proposals, native references and audit events in the private local Store. No project configuration, source snapshot or transcript is committed or published by this workflow.
- The scan has finite token/time limits, no selected skills and only `project.bootstrap` among GWI tools. Instructions prohibit project commands, network use, directory traversal and reading anything outside the supplied excerpts. The native read-only sandbox prevents repository writes, but installed Codex has no verified complete native tool allowlist; GWI does not claim to isolate native reads. Native approval expansion is prohibited. Restarted or interrupted scans are reported; they are not silently replayed.
- A structured proposal names only inspected, accepted source files. Suggested stages use generic project roles, `codex` or `manual` executors, valid acyclic dependencies and bounded policies. No GitHub dispatch or linked-pipeline reference is installed by adoption.
- Scanned setup evidence and registerable Knowledge sources are distinct. An AsciiDoc or extensionless README may inform the proposal, but Knowledge registration is limited to the existing Markdown, text and reStructuredText extensions or the explicit workflow-artifact exception below. Registration uses Knowledge's same read-only path eligibility, including its credential and runtime-configuration exclusions; a supported extension or scanned excerpt does not bypass those checks. The proposal prompt and correction feedback list only inspected, cited files eligible for ordinary Knowledge synchronization. Other excerpts and package metadata remain evidence only; applying a proposal does not expand supported formats or alter earlier project configurations.
- The inspected manifest includes each source's `document` or `artifact` kind. Knowledge registration derives its kind from that inspected source; an optional supplied kind must use the same supported enum. Invalid source proposals return their path/field and permitted source kinds, role IDs and paths. A scan permits the initial proposal call and one correction call, with explicit feedback before a final blocked result. It does not start another model execution or an unbounded repair loop.
- Registered workflow artifacts must remain usable through ordinary Knowledge synchronization after Apply. In addition to the existing Markdown/text/reStructuredText inputs, an explicitly selected `artifact` file directly under `.github/workflows/` with a `.yml` or `.yaml` extension is indexed as UTF-8 plain text. It is not parsed or executed. Its role tags, content hash, revision and provenance follow the ordinary knowledge contract. This exception does not expand directory discovery: recursive indexing keeps its existing text-extension allowlist and does not collect YAML/configuration files. Credential, realpath, binary and size checks continue to apply; other YAML files and non-artifact source kinds remain unsupported.
- Applying validates again before creation. A failed partial application retains its created project and workflow IDs for inspection and bounded retry instead of making duplicate projects or reporting success.

## Interfaces

Adoption types are exported from `src/adoption.ts`. Authenticated local routes use the existing Host/Origin/session policy:

| Route | Behavior |
| --- | --- |
| `POST /api/adoptions` | `{workspace,name?,repository?,idempotencyKey}` starts one bounded scan and returns an adoption record. Identical keys deduplicate; different inputs with the same key conflict. |
| `GET /api/adoptions` | Returns `{adoptions}` for the local owner. |
| `GET /api/adoptions/:id` | Returns the current adoption record. |
| `POST /api/adoptions/:id/apply` | `{expectedRevision}` applies a proposed revision and returns its project. |

`AdoptionService(engine)` owns scan records, validation, recovery and application. Server integration creates one service, calls `recover()` on startup and `close()` before closing the Engine. Browser code imports its types only, so server source and private snapshots are not browser assets.

## Focused acceptance

- Synthetic adapter tests verify read-only bounded inputs, structured-tool-only proposals, real-reference persistence and no project creation before Apply.
- Reject out-of-bound sources, arbitrary roles/permissions, malformed or cyclic workflows, stale source hashes and stale adoption revisions. Repeated scan/apply requests do not create duplicate work.
- Verify restart interruption, adapter failure and source omission reporting without a paid model.
- Verify that an explicitly registered workflow artifact synchronizes with its adopted role tags and content hash, while ordinary runtime/credential YAML and YAML encountered by directory discovery are not imported.
- The root integrator exercises an actual installed-Codex scan of an existing project, reviews its evidence, applies it and opens a usable project. A successful synthetic test or build is not this live-model acceptance.
- Inspect English and Simplified Chinese setup, source/proposal review, Apply and error/recovery states. No broader UI redesign or unrelated project work is required.

## Implementation evidence

The implementation includes a 24-file, 48,000-byte excerpt boundary, a 128 KiB input-file limit and one active scan at a time. Scans use a 300-second/160,000-new-token native task limit. Fifteen focused synthetic adoption checks (including nested validation cases) and the complete TypeScript/Vite build passed. These checks cover application through ordinary Engine APIs without starting project runs or CI. Knowledge sources are registered; synchronization remains the existing explicit Knowledge action.

An initial installed-Codex scan reached the proposal tool but used an unsupported knowledge-source kind and did not produce an applied configuration. The source manifest and validation feedback now make that contract explicit and permit one correction. A fresh live proposal, application and resulting-project browser journey still require the root integrator's independent verification; the synthetic checks do not establish those outcomes.
