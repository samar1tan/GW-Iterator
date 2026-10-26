# GW-Iterator

GW-Iterator (GWI) is a local interface for explaining and supervising Codex goals. Submit an outcome in a project; Codex chooses available workflows, waits for their results, and decides the next useful action. GWI records the decisions, execution references, evidence and reported usage.

Roles, pipelines and project knowledge provide resources for a goal. Initial templates let you begin without designing a workflow first. The interface supports English and Simplified Chinese.

## Run locally

Use Node.js 24–26 and npm. Install Codex on your `PATH` and sign in through Codex itself. You can select an executable with `GWI_CODEX_BIN` or the private runtime settings described in the [operating guide](docs/operating-guide.md#select-the-codex-executable). GitHub actions need an installed, signed-in `gh` CLI. Native goal entry requires Codex app-server support for goals.

```sh
npm ci --ignore-scripts
npm run build
npm start
```

Open [the local app](http://127.0.0.1:4318). Use **Adopt existing project** to review a Codex setup proposal, or **Create project** for manual setup. Then use **Set a goal** on the project's Pipelines page. Add a repository binding when work needs GitHub. The project list reflects your private local state; populated project configurations are not included in this repository.

For frontend development, use `npm run dev`. Run `npm test` for the automated checks.

## What to expect

- Goals show concise reasons, expected gains and linked actions. Native Codex status and GWI's accepted result are shown separately.
- Pipeline runs expose dependencies, attempts, human tasks, review, steering and cancellation. Configuration and knowledge revisions are captured for each run.
- Knowledge uses explicitly registered local sources and retained lessons, with role filters and provenance.

Starting an action does not establish that a goal is complete. A prepared change does not establish publication or deployment; inspect the recorded review and evidence. Execution budgets count uncached input plus output when reported, otherwise the gross token total. Raw usage and the native goal's meter remain inspectable; reports can be incomplete or delayed.

Application state stays in `.local/state` by default. Keep that directory, tokens, project settings, knowledge, transcripts and captures out of publication. GWI uses Codex and GitHub's existing authentication; it does not import their credential files. The HTTP server binds to loopback.

Read the [operating guide](docs/operating-guide.md) for controls and private API/CLI use, the [API reference](docs/API.md) for request formats, and the [goal recovery contract](docs/goal-recovery-prd.md) for restart and continuation rules. [Multica headless reuse](docs/architecture/multica-reuse.md) has been assessed from source; it is not a deployed integration. The current execution adapter talks directly to Codex.
