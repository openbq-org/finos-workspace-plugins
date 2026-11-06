# Workspace plugins

Widget plugins for FINOS Workspace and BQ Workspace, one folder each. Every folder builds its own
package, `dist/<plugin id>/<version>/`, which a deployment places in its plugins directory.

| Folder | Plugin | Widget types |
|---|---|---|
| [`ag-grid/`](ag-grid/README.md) | AgGrid | `aggrid-table`, `aggrid-ssrm`, `aggrid-infinite`, `aggrid-streaming`, `aggrid-sql`: AG Grid Enterprise with integrated charts |
| [`mermaid/`](mermaid/README.md) | Mermaid | `mermaid`: flowcharts, sequence, class, state, ER, Gantt and the other Mermaid diagrams, with zoom, pan and SVG and PNG export; pies drawn as a donut |
| [`react-flow/`](react-flow/README.md) | React Flow | `reactflow`: editable flow diagrams of nodes and edges, laid out automatically, which the user rearranges and the AI agent reads and rewrites |

## Shared tooling

| Path | What it does |
|---|---|
| `scripts/verify.mjs` | `npm run verify` in a plugin folder: checks the built package as Workspace's discovery does, and prints the version digest. |
| `scripts/install.mjs` | `npm run install:workspace` in a plugin folder: copies the package into a local plugins directory. |
| `scripts/sync-dev.mjs` | `npm run dev:workspace` in a plugin folder: replaces the files of a development version, started with Patch, Minor or Major on a `MODE=local` stack, with the build. |
| `scripts/install-release.sh` | On a server: downloads one plugin's GitHub Release, checks it, and places it in the plugins directory. |
| `.github/workflows/<plugin>.yml` | Tests, builds and verifies a plugin when its folder changes. |
| `.github/workflows/release.yml` | Publishes one plugin's package for a tag `<plugin folder>-v<version>`. |

## Release a plugin

Raise `version` in the plugin's `package.json`, then push a tag:

```bash
git tag ag-grid-v3.0.0 && git push origin ag-grid-v3.0.0
```

On a server:

```bash
PLUGINS_DIR=/srv/workspace-plugins GITHUB_REPO=openbq-org/finos-workspace-plugins \
  scripts/install-release.sh ag-grid 3.0.0
```
