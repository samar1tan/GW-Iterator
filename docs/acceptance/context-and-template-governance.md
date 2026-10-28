# Context and template governance: validation record

This increment replaces document-order context selection, adds reviewed local template updates, and reduces repeated historical-state decoding. Requirements and interaction decisions were written before implementation: [knowledge](../knowledge-context-prd.md), [templates](../template-governance-prd.md), [UED](../platform-governance-ued.md), [architecture](../architecture/context-and-template-governance.md).

## Knowledge selection

Workers and both coordinator adapters now share a frozen-corpus selector and positioned search/read tools. Applicable required guidance is complete. Optional evidence is selected from task terms, identifiers, stage checks and upstream findings; irrelevant first documents are not a fallback. Body matches can include their complete short Markdown section, with structural inclusion identified separately from lexical matching.

Independent, fixed expected-evidence cases covered deep evidence after the first five documents, irrelevant-source reordering, Unicode/CJK identifiers, multiple task facets, metadata-only discovery, duplicates, conflicting guidance, lifecycle exclusion, isolation, serialized bounds and old located reads. The v5 lexical/section revision passed **141/141** and **27/27** assertions. After an equivalent linear-time section-boundary refactor, the final source separately passed **17/17** short-section assertions; the larger held-out sets were not rerun after that refactor. The short-section case preserves a neighboring rule paragraph with no query term. A section that cannot fit is omitted with a location, rather than supplied as an incomplete contract.

Earlier recall-only checks missed excess irrelevant text. Additional precision cases exposed that failure; expected source material was retained while ranking and evidence admission were corrected. Retrieval is lexical, not automatic semantic translation, and selection does not prove a claim true or a source useful.

## Human configuration and knowledge

An ordinary local GUI journey created a project from its name and directory, registered its guidance and reference directory, and launched work without configuring retrieval weights, capabilities or token numbers. A role was saved as a template, installed, revised and updated through a semantic preview. The project's local responsibility and explicit Max choice survived the update. Successful Apply remained visible without relying on a subsequent GET.

The GUI also exercised lesson creation, rendered Markdown, exact-version feedback, archive and restore. Switching language exposed a success-message defect; retained receipts now store message keys and parameters and render in the current locale. Source inspection distinguishes the initially selected range from neighboring frozen text opened by a person. At a 1280×800 viewport, the source dialog exposed a stacking defect inside the sticky inspector. Shared dialogs now use a top-level portal; English and Simplified Chinese source reading and keyboard close were rechecked with the header, content and actions visible.

Automated checks separately cover proposal review, lifecycle CAS, conflicting updates, duplicate Apply, permission rejection, many-to-one/custom-slot mappings, preparation failure, stale observations and unchanged earlier execution bases. These checks do not substitute for a real provider execution.

## Observation performance

A model-free workload used 38 completed runs, 19 completed goals and approximately 6 MiB of synthetic run JSON. Before and after used the same polling workload. Request-scoped read views retain one coherent SQLite observation and do not persist account or termination authority between requests.

| Workload | Before | Integrated read view |
| --- | ---: | ---: |
| Workspace domain read, mean | 2,050 ms | 33 ms |
| One visible client, service CPU / one core | 87.6% | 5.9% |
| Four visible clients, session p95 | 19,009 ms | 502 ms |
| Four retained views, one visible, service CPU / one core | 89.6% | 5.4% |

This is a small local workload, not an SLO or a model-efficiency result. The small overview-only domain read was slower in the integrated sample (16 to 33 ms); not every endpoint became faster. The harness exercised the actual domain/read-view implementation through an isolated mirror handler, not the production service's complete bootstrap or browser rendering.

## Bounded provider comparison

Two independently authored pure-JavaScript maintenance tasks used equal committed starting files, recorded contracts beyond five irrelevant references, the same configured Codex model and Max effort, and the same external acceptance checks. External assertions were fixed before any model ran. No direct-route solution was supplied to GWI. The known-pipeline route and general-entry route used different tasks, so their relative timings cannot establish which entry is faster.

| Task and route | External checks | Provider dispatches | Model execution | Noncached input + output |
| --- | ---: | ---: | ---: | ---: |
| Heading IDs, direct | 9/9 | 1 | 112 s | 36,964 |
| Heading IDs, saved pipeline | 9/9 | 2 | 214 s | 92,810 |
| Failure classifier, direct | 9/9 | 1 | 91 s | 35,773 |
| Failure classifier, general entry | 9/9 | 4 | 427 s | 198,911 |

The configured model was `gpt-6.1-sol`, with Max effort and the default service tier. GWI added independent QA and an explicit human delivery decision; general entry also used initial and final coordination. Its coordinator performed actual frozen knowledge searches and located reads, selected Focused change, and reused the accepted result to finish without repeating implementation. Initial and worker v5 payloads included the complete deep contract. Provider counters are not fees or account-percentage charges. Human review wait is excluded from model execution time. Direct tasks performed their own tests but did not include a separately paid reviewer; this is a comparison of the actual default routes, not equalized verification staffing.

The heading trial used selector v4. Its initial payload found the correct paragraph but omitted a neighboring contract paragraph; the workers read the full repository contract and passed the fixed external checks. That observed gap led to v5's complete-short-section rule. Historical v4 locators still return identical frozen bytes. The trial was not rerun to manufacture a better comparison.

The complete pilot used **12 provider dispatches**: two direct baselines, two saved-pipeline steps, four general-entry steps, one cancelled execution, and three recovery/verification steps. No time, capability or account allowance was increased to finish it.

A live owner Stop was issued after the external task reported running. GWI showed pending termination, then retained an authoritative cancelled/cleanup-confirmed record; downstream QA and delivery never dispatched. A separate missing-document probe returned a blocked result. An ordinary retry with an owner note repeated only that step, preserved its earlier result, then passed independent QA and human review. The operator initially supplied an incorrect replacement filename and corrected it through in-app running guidance; that intervention remains in the record. External hashes confirmed the module, contract, package and README stayed unchanged. This demonstrates targeted continuation with human input, not an unattended automatic repair of a missing document.

Finite automatic-recovery behavior is covered by the existing model-free recovery tests. A natural provider-capacity outage was not observed and remains unverified live. The controlled missing-source and cancellation cases do not establish live capacity retry or model fallback.

## Evidence and delivery boundaries

Actual project settings, source corpora, full prompts, provider transcripts, run IDs, filesystem paths and captures remain private. Only original implementation, documentation and independently authored synthetic tests are publication candidates. This record distinguishes automated checks, ordinary GUI checks and provider work; it does not claim broad product acceptance or general speed/cost superiority.

The integrated local suite completed with **726 tests: 725 passed, 0 failed, 1 existing opt-in live runtime check skipped**. TypeScript/frontend build and the bilingual website build passed. Hosted CI and deployed-site observations are recorded on the associated pull request and delivery issue rather than inferred from these local results.
