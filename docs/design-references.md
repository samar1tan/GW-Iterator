# Design inputs

- [Multica](https://github.com/multica-ai/multica), inspected at `e8fdcfd226d238e6f1f22d5d95245936a795d9fd`: use the separation of assigned work, execution history and reusable skills as a design reference. GWI adds project-specific configurable pipelines and knowledge provenance driven by GW's actual iteration problems. No Multica source or artwork is included.
- [Google SRE Workbook on releases](https://sre.google/workbook/canarying-releases/): small changes, reproducible inputs and observable rollout decisions inform frozen run configurations and focused verification. A local workflow replay is not a production canary experiment.
- [Codex app-server](https://learn.chatgpt.com/docs/app-server): the local stdio integration uses thread/turn lifecycle, streamed events and explicit skill input. The installed CLI schema is checked for protocol compatibility; experimental dynamic tools are labeled as such.
- GW v0.1's private five-role retrospective informs explicit run outcomes, preserved historical evidence, affected-artifact maintenance, cross-boundary regression and budget/stop rules. Private reports and conversation material are not republished.
