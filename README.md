# Workspace plugins

Widget plugins for FINOS Workspace and BQ Workspace, one folder each. Every folder builds its own
package, `dist/<plugin id>/<version>/`, which a deployment places in its plugins directory.

| Folder | Plugin | Widget types |
|---|---|---|
| [`ag-grid/`](ag-grid/README.md) | AgGrid | `aggrid-table`, `aggrid-ssrm`, `aggrid-infinite`, `aggrid-streaming`, `aggrid-sql`: AG Grid Enterprise with integrated charts |

## Shared tooling

| Path | What it does |
|---|---|
| `scripts/verify.mjs` | `npm run verify` in a plugin folder: checks the built package as Workspace's discovery does, and prints the version digest. |
| `scripts/install.mjs` | `npm run install:workspace` in a plugin folder: copies the package into a local plugins directory. |
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
