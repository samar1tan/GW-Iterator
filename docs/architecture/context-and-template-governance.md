# Context and template governance decisions

## 1. One frozen retrieval service

Use one local corpus/selection/search/read implementation for every execution adapter. Index only the frozen, eligible project basis; an unrelated project's document frequency cannot change ranking. Retain source locations and actual outgoing selections. Do not join a live global index and then pretend a project filter isolates corpus statistics.

SQLite FTS5 provides local ranked retrieval and avoids a new hosted dependency. Pre-tokenize multilingual text and code/path identifiers consistently; raw unicode61 does not establish Chinese word matching. Search passages rather than truncating a matched document's beginning. The SQLite [FTS5 documentation](https://www.sqlite.org/fts5.html) describes ranking, tokenization and snippets; [BM25](https://nlp.stanford.edu/IR-book/pdf/11prob.pdf) supplies a lexical baseline, not a claim of semantic understanding. Validate the chosen tokenizer and ranking against held-out passage cases.

A lexical-only selector cannot translate an English concept from an unrelated Chinese phrase. Preserve that limitation. A model can refine or translate a query through a scoped tool during its ordinary task; do not add a hidden paid retrieval-planning turn or fabricate aliases for a benchmark. Required guidance and role/task instructions remain separate from retrieved evidence.

Ranked matching is candidate generation, not permission to fill the context envelope. Body support, discriminating terms and distinct task facets govern initial selection. Metadata-only candidates are bounded discovery anchors with a continuation. Measure irrelevant admitted characters as well as required-evidence recall; a deep hit accompanied by every unrelated paragraph is a failure. Keep original corpus bytes and versioned source locations stable across restart; a future parser/index change must preserve existing located reads rather than silently rebuilding their identities with incompatible boundaries.

The v5 selector adds structural materialization after the existing body gate; it does not change lexical ranking, tokenization or FTS/AST index boundaries. When the nearest complete Markdown section fits 2,000 characters, include that section around the qualifying body passage. This keeps a function declaration together with later uniqueness, precedence or other rules that contain no query term. Do not apply this closure to metadata-only discovery, and retain focused AST passages for long sections. Deduplicate identical materialized ranges and count the full expanded payload in the shared serialized envelope. If the section cannot fit, omit the complete section with a budget record rather than silently reverting to its opening paragraph.

Record `SECTION_CONTEXT` and the outgoing `structuralContext` marker to distinguish included structure from direct lexical support. Candidate omissions describe selection as primaries; they do not prove that the corresponding text was absent from a structurally included section or a later tool read. The stored initial context and exact evidence ranges remain the authority for what was supplied. This is bounded structural context, not semantic verification that every neighboring sentence is relevant or correct.

Indexes are derived private caches keyed by corpus content and algorithm versions. They are rebuildable; original source bytes and immutable basis metadata are authoritative. Cap and release caches explicitly. Shared parse/query statistics must not create cross-project data or ranking influence.

## 2. Frozen capture and tools

Prepare new owner work through bounded registered-source capture, then commit the checked project/corpus basis together. Record per-document hashes and the capture interval; this is not an atomic snapshot of unrelated mutable filesystems. Internal child work, including scoped worker starts, reuses its caller's frozen basis and captured relationships. Explicit configuration refresh makes a new basis. Owner HTTP entry and internal delegation follow this same preparation-versus-reuse contract; direct internal tests are not proof of public entry coverage.

Connected coordination receives frozen-context read/search access through the existing task-scoped capability mechanism. Revocation, expiry and exact project/run identity retain their existing authority. The connected planner continues to return one validated decision; its read-only lease does not include `intake.route` or an owner token. Role tags control default applicability rather than acting as an additional ACL within the frozen project corpus.

Positioned reads use entry/revision/hash, source lines and entry-relative string offsets from the frozen corpus, never an arbitrary file path. Coalesced reads return up to 4,000 body characters of contiguous material, with complete reply metadata bounded to 7,000 serialized JSON characters and a continuation when needed. Metadata overflow is explicit. These reading pages can be wider than the initial selection: the source viewer identifies both ranges rather than implying that all displayed neighbors were supplied to the model. Owner viewing records no agent lookup and changes no initial selection. Existing v4 locators and historical outgoing records retain their identities and bytes. Feedback/proposals retain origin work; they cannot promote permissions or rewrite snapshot contents.

## 3. Versioned templates and project-owned bindings

Store immutable local template revisions separately from project materializations and run snapshots. Binding records carry their portable baseline and sticky project-owned paths. Three-way semantic merge produces a reviewed candidate, not an automatic mutation. Stable workflow stage IDs permit independent changes; role and external-resource mappings remain validated project bindings.

Keep runtime/agent/MCP/native-path identities out of portable definitions. Capability declarations are requirements, not grants. Optional model/effort defaults can update only fields still under template management. Existing explicit choices remain owned even when values coincide.

A preview pins exact immutable target content and checked project/object input. Apply is CAS-checked and idempotent, with durable receipt metadata committed with the local definition/binding. Remote immutable-agent preparation may cache an unused revision but starts no model work. Its failure cannot leave a half-updated project. Preserve existing proposal permission and review boundaries.

## 4. Efficient reads without stale authority

Measure synchronous full-table decoding/aggregation before optimizing it. Reuse one coherent indexed read model within a logical observation instead of repeatedly parsing all runs for every goal/family/attempt. Do not share mutable decoded objects across unrelated operations or indefinitely cache account/termination state.

Read-model freshness is bounded by the logical observation. New writes invalidate or bypass it; Stop, cancellation, confirmation and account admission retain their authoritative checks. Test active and terminal work, different projects and overlapping reads. Retained hidden tabs suspend redundant polling; visibility restoration observes current state.

## 5. Evidence boundaries

Local retrieval evaluation, model-free protocol faults, real provider executions and production delivery are separate evidence. Use the same baseline, model/effort, source access and external checks for a small direct-Codex/GWI comparison. Record all dispatches/retries, useful output, wall/wait time, interventions and provider usage; account deltas remain shared observations. A small pilot cannot establish general cost or speed superiority.

Use finite live validation limits and existing native policies. Real Stop/termination confirmation and exact-scope recovery can be exercised without manufacturing a provider capacity outage. If a capacity failure does not occur, do not label its live behavior verified. No reset redemption, model purchase, permission broadening or revival of the parked replication exercise is implicit.
