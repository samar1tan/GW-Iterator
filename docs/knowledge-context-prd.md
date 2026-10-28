# Task-relevant project knowledge

## User outcome and scope

When a person starts work, its coordinator and workers receive relevant project evidence and required guidance. They can inspect which sources were used, locate omitted material and report a knowledge problem. Source order must not decide what an agent knows.

This replaces the separate first-four/document-prefix paths in worker prompts, connected coordination and explicit knowledge search. Native coordination, connected coordination, worker execution and human inspection share one frozen-corpus contract. It introduces no embedding service, model credential, automatic translation promise or required launch form.

## Source capture and authority

- Before **new** work, capture only the project's already registered eligible sources through the existing bounded reader. This model-free operation is cancellable and checks project/source registration revisions before freezing. It does not write source files, discover additional roots or grant a worker capabilities. Record the capture interval and each document's exact hash. Detectable changes during capture discard the candidate or trigger a bounded recapture; this is not an atomic snapshot of unrelated mutable filesystems or external services.
- An explicitly refreshed configuration creates a new basis. Existing goal/run continuations retain their original corpus; live files are not substituted during search or positioned reads.
- Sources have a useful purpose: required project guidance or reference material. Owner selection is explicit; the project's own root `AGENTS.md` can receive the guidance default, while arbitrary external documents with that name or the word MUST cannot promote themselves. Role tags describe applicability, not a new security ACL.
- Required guidance is retained as complete material applicable to the role about to dispatch. Missing, owner-confirmed conflicted or oversized required guidance produces an actionable pre-dispatch preparation failure, rather than a paid attempt with omitted constraints. Agent conflict feedback alone cannot block work. Ordinary reference gaps remain visible and do not masquerade as fresh evidence.
- Accepted upstream results and prepared-source artifacts are task evidence, separate from frozen project guidance. Their lineage and current attempt matter; agent edits cannot upgrade sandbox/tool authority.

## Retrieval and selection

1. Index the frozen corpus into position-preserving passages. Retain entry/revision/hash, source path, heading ancestry and original line ranges. Keep paragraphs, lists and code boundaries useful; a long indivisible block is explicitly continued, never silently represented by its opening text alone.
2. Retrieve from the current request, current reply, stage goal/checks and relevant upstream artifact identifiers. Match titles, headings, paths and code identifiers as well as passage text. Generic role names are secondary context, not the sole query.
3. Use local ranked lexical retrieval with Unicode/CJK tokenization and exact path/symbol support. Corpus statistics are isolated to the frozen project basis. No match must not return arbitrary first documents as relevant.
   Distinguish body evidence from title/path/ancestor-heading discovery. Repeated metadata cannot fan out into every paragraph of a document. Prefer discriminating task terms and preserve distinct task facets; abstain from treating weak generic overlap as relevant evidence. The envelope is a ceiling, not a target to fill. Record omitted candidates and discovery-only coverage. Located reads provide useful bounded pages rather than one tiny request per paragraph.
   After a body passage qualifies, include its complete Markdown section when that section fits the 2,000-character passage bound. This preserves rules in neighboring paragraphs that contain no query word. Count the expansion in the serialized envelope and identify it as structural context, rather than claiming every line matched. Keep long sections as located passages; do not expand discovery-only metadata matches this way.
4. Assemble required guidance and relevant nonduplicate passages within a documented **character** envelope shared with dependency/feedback context. Count actual serialized payloads, including locators and JSON overhead. Preserve useful source diversity and locator metadata. Do not present estimated characters as provider tokens or task charges.
5. Retain selector/tokenizer/index versions, query facets, selected passages, source aliases, inclusion reasons, budget omissions, unavailable/conflicted sources and any coverage warning in a durable selection record. Record the exact outgoing selection, not a later reconstruction against current knowledge.

The default needs no extra model turn. Lexical matching supports multilingual text but does not translate semantic equivalents. During its ordinary execution, an agent can refine/translate a query and read a located passage through its existing scoped knowledge capability. Connected coordination must have the same read-only frozen-knowledge access as other execution paths. Low coverage is explicit and does not authorize fabricated evidence.

Search returns matching passages and their ranges, including deep sections. A positioned read validates entry identity/revision/hash against the frozen corpus and provides a bounded continuation when needed. It cannot accept a live filesystem path or switch projects/bases. Existing search clients retain a readable compatibility response without the old unrelated document prefix.

## Curation and learning

Knowledge used, knowledge retrieved and knowledge proven useful are different observations. Retain selection/tool-read records and allow evidence-linked feedback about relevance, obsolescence or conflict. Feedback does not become a relevance guarantee or silently alter a frozen run.

Owner-authored lessons can be retained directly. Agent-authored lessons enter a reviewable proposal state before new work consumes them; the original text, origin execution and actual permission to propose remain recorded. Owner review uses a lifecycle compare-and-swap to retain, revise or decline a proposal. Proposed or declined lessons cannot become current through archive/restore. Missing/error/archived/proposed/declined material is excluded from a newly frozen current corpus.

Explicit supersession or conflict relationships must name exact entries/revisions/hashes and retain evidence. Only unresolved owner-confirmed relationships still applicable to the dispatched guidance require resolution; ordinary conflicting references are inspectable with their disagreement preserved. Do not claim that a local lexical selector can detect or adjudicate every semantic contradiction. Relevance feedback is a review input, not automatic promotion or global policy modification.

## Human and agent interfaces

- Keep the existing request entry. Preparation identifies actual source work and offers the existing Knowledge destination for repair.
- Add a compact Sources used disclosure to the existing execution inspector: required guidance, selected evidence, reasons and coverage. A source action opens its frozen excerpt and location; current indexed content is separately identified.
- Knowledge remains the owner of registration, purpose, proposals, feedback and lifecycle. Ordinary reading does not require scoring sources or assigning weights.
- Read APIs and existing project-scoped knowledge tools expose the same selection and located-read semantics. A connected coordinator gets a task-scoped, revocable read lease, never the owner token or global template write access.

## Acceptance

Use independently authored corpus/expected-evidence fixtures. Capture actual outgoing prompts and tool replies for every adapter. The suite must cover relevant document six or later, deep evidence, source reordering, CJK/identifiers/normalization, complete guidance, no match, duplicated and conflicting sources, stale/proposed/archived exclusion, corpus isolation, total context bounds, positioned-read identity, cancellation and immutable/explicitly refreshed bases.

Evaluate required-evidence recall, irrelevant admitted text and locator correctness against declared case expectations. A snapshot that merely asserts a prefix length is not a relevance test. Verify the same cases through ordinary GUI/API paths and a bounded real task; retain failures without changing expected answers to match the selector.
