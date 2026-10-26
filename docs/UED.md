# Project and workflow supervision

## Project entry

The landing page is the project list. Each card shows project identity, active/waiting work and knowledge/source counts. GW and GWI are peers. Create project is a real setup form for its local workspace and repository binding. A project card enters its workspace; the header always provides Projects as a return target.

## Project workspace

The left rail holds project identity and three primary destinations: Pipelines, Knowledge and Configuration. A role filter narrows the current surface; roles are not global projects. Keep active project and selected role visible while inspecting a run or a knowledge entry.

Pipelines shows available definitions, start action and actual runs. Start asks for a purpose, baseline and bounded run options, with the pipeline's relevant role configuration available. Definition editing is explicit and shows validation or revision conflicts. Dependency stages and linked runs show why work can or cannot proceed.

A selected run uses the main canvas for stages and dependencies, and the right/context area for the selected stage's attempts, output, evidence, review decision and live Codex control. The event trail records chronological changes. A running process stays visible as running; empty states identify the useful next action without invented activity.

Review has an outcome and a note. Accept releases dependents; request revision records the finding and returns work to its owner within limits. Steering sends input to the actual active turn; interrupt requests a stop and waits for authoritative completion. Configuration changes do not rewrite its frozen run basis.

## Knowledge

Knowledge has source controls, search/role/type filters and an entry list. Selecting an entry opens content and provenance. Source registration asks for an explicit local path, source kind and relevant roles; shared memory can name a section. Synchronize reports changed, unchanged, failed and missing sources. Source paths and contents are private.

The entry's source identity, content hash and sync time are available in context; version metadata is secondary to its title and content. Run context identifies the knowledge revisions actually supplied to the agent. A run lesson can be retained as a project knowledge entry with a link back to its source event.

## Configuration

Configuration groups project bindings, role profiles and execution settings. Roles expose instructions, model/effort, selected discovered skills, allowed GWI tools and sandbox policy. A JSON editor is available for complete pipeline definitions alongside readable stage summaries. Save reports its new version; conflicts preserve input and require refresh/reconciliation.

The first version uses near-black/gray surfaces with blue selection, restrained status colors and system fonts. Labels and empty/error states support English and Simplified Chinese from separate locale resources. Inspect the implemented project → pipeline → run/review → knowledge → configuration → project return journey. Use focused desktop and narrow-width checks; this is a working supervisor, not a full visual-polish milestone.

## Goal supervision

The project Pipelines workspace starts with a natural-language goal entry. The user need not choose a role or workflow. Submitting shows the actual Codex supervision turn; subsequent rounds show observations, the recorded action, concise rationale, expected benefit and links to each delegated run. Several workflows can contribute to one goal. Local DAGs remain inside the run inspector.

Goals retain their history when refreshed. Show completion only from the recorded acceptance state. Expose reported usage with unavailable/partial states and a compact, collapsible execution boundary. A stop action records a reason and stops only this goal's owned work. Role and pipeline configuration stay available as resources, without becoming a mandatory entry form.
