# Third-party dependencies

Original GW-Iterator source is licensed under Apache-2.0. Dependency licenses remain separate; this file does not relicense upstream code or authorize a deployment prohibited by its license.

## Multica

GWI connects to the separately installed [Multica](https://github.com/multica-ai/multica) backend and daemon for agents, skills, MCP connections and task execution. The integration is pinned to source revision `a097f592be73067d56908ca50ece557fa2af1293`; actual connection and runtime settings stay private.

Multica uses an Apache-based source-available license with additional conditions for hosting, commercial embedding and attribution. Read the [complete license at the pinned revision](https://github.com/multica-ai/multica/blob/a097f592be73067d56908ca50ece557fa2af1293/LICENSE) before using or redistributing that dependency. GWI does not include or relicense its source, binaries, branding assets or user data. The local setup keeps the upstream checkout and its license together outside public source.

## Application packages

The npm lockfile pins direct and transitive packages. Installed packages retain their own license and notice files.

| Package | Version | License | Source |
| --- | --- | --- | --- |
| React / React DOM | 19.3.1 | MIT | [React](https://github.com/facebook/react) |
| React Flow | 12.12.0 | MIT | [xyflow](https://github.com/xyflow/xyflow) |
| Dagre | 3.1.3 | MIT | [dagre](https://github.com/dagrejs/dagre) |
| Model Context Protocol TypeScript SDK | 1.32.2 | MIT | [typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) |

The MCP SDK implements the control-tool transport. It does not grant additional project or filesystem permissions.
