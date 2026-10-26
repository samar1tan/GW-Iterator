# GW-Iterator

GW-Iterator (GWI) is a local workbench for advancing project work through configurable teams, pipelines and feedback loops. It uses [Multica](https://github.com/multica-ai/multica) for agent execution and keeps project context, dependencies, review, limits and delivery evidence in one interface.

Choose a project, describe an outcome or run a saved pipeline, then follow the work on its stage canvas. Inspect actual changes and artifacts, return a finding to its owner, and accept delivery from evidence. The interface supports English and Simplified Chinese.

## Run locally

Use Node.js 24–26, Git, curl, Docker with Compose, and an authenticated local Codex installation. GitHub operations also need a signed-in `gh` CLI. macOS is the verified native execution platform; other hosts must pass the setup checks.

```sh
npm ci --ignore-scripts
node scripts/setup-multica.mjs
npm run build
npm start
```

Open [the local app](http://127.0.0.1:4318). Connect an existing project through its local workspace. Codex-assisted adoption can propose project guidance and knowledge sources for review. Real project settings and account connections are private local state; this repository contains no populated project configuration.

The [setup guide](docs/multica-setup.md) covers prerequisites, native permission probes, private state and recovery. Use `npm run dev` for frontend development and `npm test` for automated checks.

## Work in a project

- **Workbench** shows current outcomes, pending decisions and delivered artifacts. A general request can coordinate several saved workflows.
- **Pipelines** contains reusable definitions and executions. The visual editor supports dependencies, conditions, human gates, child pipelines and bounded return paths. A focused change starts with implementation, independent QA and delivery review.
- **Team** connects role contracts to actual agents, skills, MCP tools and runtimes. Role changes create revisions; older runs keep their basis.
- **Knowledge** indexes selected documents, artifacts, memory sections and verified lessons with provenance.
- **Settings** holds project bindings and deliberate configuration changes.

GWI waits for human and CI results without repeatedly invoking the model. Execution and outcome completion remain separate. A prepared change does not establish publication: a delivery step must perform and record the required integration or release.

Agent work uses isolated checkouts of committed source. Dirty files, ignored state and installed dependencies are not copied. Inspect the recorded source revision, diff and artifact previews before accepting work. The original working directory is not silently overwritten.

State, credentials, knowledge, transcripts and captures stay under ignored `.local/` directories by default. Services bind to loopback. Codex and GitHub manage their own authentication. Multica is a separately installed dependency with its [own license conditions](THIRD_PARTY_NOTICES.md).

Start with the [pipeline quickstart](docs/pipeline-quickstart.md). See the [operating guide](docs/operating-guide.md), [API reference](docs/API.md), [product requirements](docs/PRD.md) and [integration architecture](docs/architecture/multica-reuse.md).
