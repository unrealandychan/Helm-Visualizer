# helm viz — Helm CLI Plugin

[![GitHub](https://img.shields.io/badge/GitHub-unrealandychan%2FHelm--Visualizer-blue?logo=github)](https://github.com/unrealandychan/Helm-Visualizer)

A Helm CLI plugin that launches the **Helm Chart Visualizer** web UI directly from your terminal — pass a chart directory, get an interactive graph in your browser.

---

## Features

- **One command** — `helm viz ./my-chart` starts the server and opens the browser
- **Chart directory argument** — point at any local Helm chart directory
- **Port control** — choose a custom port with `--port`
- **Smart server detection** — if the Visualizer is already running, the plugin reuses it

---

## Requirements

- [Helm](https://helm.sh/docs/intro/install/) ≥ 3.x
- [Node.js](https://nodejs.org/) ≥ 18 and npm ≥ 9
- [curl](https://curl.se/) (for server health-checks)
- The [Helm Visualizer](https://github.com/unrealandychan/Helm-Visualizer) app (see install below)

---

## Install

### Option A — from the cloned repository (recommended)

```bash
git clone https://github.com/unrealandychan/Helm-Visualizer
cd Helm-Visualizer
npm install
helm plugin install ./helm-plugin
```

The plugin is symlinked into Helm's plugin directory, so the app is found automatically.

### Option B — from GitHub (no local clone)

```bash
helm plugin install https://github.com/unrealandychan/Helm-Visualizer \
  --version main
```

Then tell the plugin where the app lives:

```bash
git clone https://github.com/unrealandychan/Helm-Visualizer ~/helm-visualizer
cd ~/helm-visualizer && npm install

export HELM_VISUALIZER_DIR=~/helm-visualizer
# Add the export to your shell profile to make it permanent.
```

### Uninstall

```bash
helm plugin remove viz
```

---

## Usage

```
helm viz [CHART_DIR] [flags]
```

### Arguments

| Argument     | Description                                              |
|--------------|----------------------------------------------------------|
| `CHART_DIR`  | Path to the Helm chart directory (default: current dir)  |

### Flags

| Flag                | Description                                                   |
|---------------------|---------------------------------------------------------------|
| `-f, --values FILE` | Additional values YAML file to merge on top of `values.yaml` |
| `-p, --port PORT`   | Port for the local web server (default: `3000`)               |
| `--url URL`         | Connect to an already-running Visualizer (skip server start)  |
| `--no-open`         | Do not open the browser automatically                         |
| `-h, --help`        | Show help                                                     |

### Environment variables

| Variable              | Description                                                   |
|-----------------------|---------------------------------------------------------------|
| `HELM_VISUALIZER_DIR` | Path to the Helm Visualizer app root (auto-detected if plugin is installed from the repo) |
| `HELM_VIZ_PORT`       | Default port (same as `--port`, default: `3000`)              |

---

## Examples

```bash
# Visualize the chart in ./my-chart
helm viz ./my-chart

# Use an extra values file
helm viz ./my-chart -f ./my-chart/values.prod.yaml

# Use a custom port
helm viz --port 8080 ./my-chart

# Connect to a Visualizer that is already running
helm viz --url http://localhost:3000 ./my-chart

# Start without opening the browser
helm viz --no-open ./my-chart
```

---

## How It Works

1. **Validates** the chart directory (checks for `Chart.yaml`).
2. **Checks** whether the Visualizer server is already running on the target port.
   - If yes → opens the browser and exits.
3. **Locates** the Helm Visualizer Next.js app:
   - `HELM_VISUALIZER_DIR` environment variable
   - Relative to the plugin directory (auto when installed from the repo)
   - Common install paths (`~/Helm-Visualizer`, etc.)
4. **Starts** `npm run dev` in the app directory with `HELM_CHART_DIR` set to the
   provided chart path.  The Next.js server reads this variable and serves the
   specified chart instead of the default `helm/` workspace chart.
5. **Waits** up to 30 seconds for the server to respond, then **opens** the browser.
6. **Keeps running** — press `Ctrl+C` to stop the server.

---

## Troubleshooting

### "Could not find the Helm Visualizer application"

The plugin could not auto-detect the app directory.  Set `HELM_VISUALIZER_DIR`:

```bash
export HELM_VISUALIZER_DIR=/path/to/Helm-Visualizer
```

Or install from the cloned repo (Option A above).

### "does not appear to be a Helm chart (missing Chart.yaml)"

The supplied directory is not a valid Helm chart. Make sure `Chart.yaml` exists:

```bash
ls ./my-chart/Chart.yaml
```

### Server takes too long to start

On first run, `npm install` may need to download dependencies. Run `npm install` in the
app directory manually before using the plugin for faster start-up.

### Port already in use

Use `--port` to pick a different port:

```bash
helm viz --port 8081 ./my-chart
```

---

## License

Apache 2.0 — see [LICENSE](../LICENSE).
