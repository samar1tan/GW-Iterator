# Third-party dependencies

The GWI mark in `public/brand/gwi-mark.svg` and the workflow illustration in `site/assets/workbench-example.svg` are original project assets, distributed under this repository's Apache-2.0 license. They contain no GitHub or Multica identity assets. GitHub's [Primer Product UI](https://primer.style/product/) informed the interface conventions; GWI does not claim affiliation with GitHub.

Original GW-Iterator source is licensed under Apache-2.0. Dependency licenses remain separate; this file does not relicense upstream code or authorize a deployment prohibited by its license.

## Multica

GWI connects to the separately installed [Multica](https://github.com/multica-ai/multica) backend and daemon for agents, skills, MCP connections and task execution. The integration is pinned to source revision `a097f592be73067d56908ca50ece557fa2af1293`; actual connection and runtime settings stay private.

Multica uses an Apache-based source-available license with additional conditions for hosting, commercial embedding and attribution. Read the [complete license at the pinned revision](https://github.com/multica-ai/multica/blob/a097f592be73067d56908ca50ece557fa2af1293/LICENSE) before using or redistributing that dependency. GWI does not relicense Multica source, binaries, branding assets or user data. The local setup keeps the complete upstream checkout and its license together outside public source. The separately maintained execution compatibility patch in `scripts/patches/` contains a small adaptation of that upstream source under its existing license conditions; it is not an original Apache-2.0 GWI implementation. The patch is opt-in, pinned to the exact dependency revision, built in a separate local checkout, and identified by its hash in generated runtime records. See [the patch contract](scripts/patches/README.md).

## Application packages

The npm lockfile pins direct and transitive packages. Installed packages retain their own license and notice files.

| Package | Version | License | Source |
| --- | --- | --- | --- |
| React / React DOM | 19.3.1 | MIT | [React](https://github.com/facebook/react) |
| React Flow | 12.12.0 | MIT | [xyflow](https://github.com/xyflow/xyflow) |
| Dagre | 3.1.3 | MIT | [dagre](https://github.com/dagrejs/dagre) |
| Model Context Protocol TypeScript SDK | 1.32.2 | MIT | [typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) |
| Playwright Core | 1.64.1 | Apache-2.0 | [Playwright](https://github.com/microsoft/playwright) |
| react-markdown | 10.1.0 | MIT | [react-markdown](https://github.com/remarkjs/react-markdown) |
| unified | 11.0.5 | MIT | [unified](https://github.com/unifiedjs/unified) |
| remark-parse | 11.0.0 | MIT | [remark](https://github.com/remarkjs/remark/tree/main/packages/remark-parse) |
| remark-gfm | 4.0.1 | MIT | [remark-gfm](https://github.com/remarkjs/remark-gfm) |
| rehype-slug | 6.0.0 | MIT | [rehype-slug](https://github.com/rehypejs/rehype-slug) |
| sharp | 0.35.5 | Apache-2.0 | [sharp](https://github.com/lovell/sharp) |
| @img/sharp-libvips platform binaries | 1.3.4 (libvips 8.18.7) | LGPL-3.0-or-later; bundled libraries retain their individual notices | [sharp-libvips](https://github.com/lovell/sharp-libvips) |

The MCP SDK implements the control-tool transport. It does not grant additional project or filesystem permissions.

Playwright Core provides the maintained host-browser API. Its package license and notices remain with the installed dependency. GWI does not bundle or relicense Google Chrome; hosted browser verification uses a separately installed browser in a private isolated session.

Sharp decodes signature-matched private PNG/JPEG/GIF/WebP input into inert thumbnails. Its optional platform packages and libvips are separate dependencies, not original GWI source. Preserve the installed sharp license and each selected `@img/sharp-libvips-*` package's README licensing table when redistributing binaries. That table covers libvips and its bundled libraries, including LGPL, MPL and permissive components; the GWI Apache-2.0 license does not replace those terms. No dependency binaries or private image material are committed here.
