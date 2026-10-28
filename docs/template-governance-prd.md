# Reusable roles and workflows

## User outcome

A person can understand where a workflow came from and when to use it, reuse a reviewed role/workflow across projects, and apply an update without losing project choices or changing earlier execution. Routine work still starts with one request or an existing pipeline.

The maintained relationship is: **local template revision → project binding and overrides → frozen execution**. A generated immutable Multica agent is an execution artifact, not a live global role template.

## Definitions and provenance

- A local template has a stable identity, role/pipeline kind, immutable content revisions/hashes, purpose, use/avoid guidance, change summary and optional supporting execution/proposal references. Retirement stops new selection without erasing pinned versions.
- Record actual definition origins: built-in, owner creation, adoption, explicit import, template or reviewed proposal. Unknown old origins stay unknown. Never infer lineage from a familiar name or rewrite old private configuration automatically.
- Origin, binding and preview keys are server-owned metadata. Legacy PUT/JSON imports cannot assert trusted lineage or reuse another object's binding. A duplicate has a new identity and a truthful copy origin, without silently sharing the original binding.
- A project binding records the target object, exact template revision/hash, portable materialization baseline, role/external-target mappings and project-owned field paths. Effective values remain in the project definition. Do not duplicate live override values into another configuration system.
- Portable role content includes responsibility, instructions, inputs, outputs, checks and optional model/effort defaults. Missing model means no template opinion; null keeps its existing inherited-default meaning. Explicit project choices remain project owned, including a value that happens to equal a template value.
- Native runtime/agent/MCP identities, local skill paths, workspace/repository bindings and credentials remain project/host bindings. Templates may declare capability requirements, but installing/updating one never silently grants tools or widens a sandbox.
- A newly installed role starts with the maintained minimal-capability new-role baseline. Unmet requirements lead to an explicit owner change in Team before installation; source-role permissions are not copied as grants.
- Portable workflows declare logical role and external-target slots. Exact existing compatible bindings can be reused; missing roles, child pipelines or GitHub targets require a meaningful mapping before application. The editor must not present raw UUIDs as the ordinary authoring interface.

## Creation and controlled updates

The owner can save an exact current project role/workflow as a local template and revise portable content using the maintained editor. Existing project objects are not silently bound just because a similar template exists. New built-in definitions retain truthful template lineage.

An install/update preview compares template base, current project and requested upstream revision. It shows resulting behavior, preserved project choices, semantic changes and unresolved conflicts. Ordinary arrays are atomic; workflow stages use stable IDs so independent edits are not discarded with a whole-array replacement.

Conflicts include both sides editing the same field, removing a locally changed stage, incompatible dependencies/return paths and missing capability/target mappings. Choices are constrained server-side; the client cannot submit an arbitrary patch as a conflict resolution. Project-owned paths stay owned even when their value later coincides with an upstream default. Returning a field to template management is explicit.

Apply validates the reviewed immutable target, project/object bases, mappings, requirements and preview key. It returns a durable idempotent receipt. Failed preparation or stale input leaves the project unchanged; any cached remote preparation is not a started task. GET failure retries observation, not application. Restore/rollback creates a new project/object revision and retains old evidence. Retirement blocks new installations and upgrades but preserves exact historical reads and existing pinned executions.

Updates affect newly frozen work only. Active runs, retries and already frozen Intake bases retain their definitions, knowledge and agent references.

## Selection and process evolution

Keep origin, applicability and this-run selection reason separate. A manual choice, shortcut ordering and coordinator decision have different recorded methods. Reasons are concise public summaries tied to the actual pipeline revision and evidence, not hidden reasoning or an after-the-fact model explanation.

Retain process improvement proposals with source executions and baseline revisions. A project worker may propose changes within its existing permission. Promoting a project improvement to a reusable global template remains an owner action; template reuse does not confer cross-project access or global write authority.

## Interaction and compatibility

Projects gains one reusable-template entry. Team and Pipelines continue to own project editors and display a compact source/version/local-change row with an update action. Reuse the existing definition editor and proposal-style review surface for template content and semantic previews. Do not add template questions to ordinary launches or another permanent project navigation destination.

Legacy role/pipeline APIs and unbound definitions remain valid. Adopted/built-in/manual new definitions record their origin at creation. The old default factory is not described as automatic live inheritance. Actual project configurations and reusable private templates stay local.

## Acceptance

Verify new and legacy origins; immutable revisions and retirement; explicit empty/inherited/unknown values; controlled v1→v2 upgrades; independent stage changes; deletion conflicts; missing role/target mappings; stale preview and duplicate Apply; failed observation after confirmed Apply; project ownership of local bindings/capabilities; frozen old work and source-protected verification. Inspect English and Simplified Chinese ordinary creation/update journeys without mandatory JSON editing or permission changes.
