import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { renderHelmChartJS } from "./helmTemplateRenderer";

const execFileAsync = promisify(execFile);

// Maximum wait time per helm invocation (ms)
const HELM_TIMEOUT_MS = 30_000;

// How long (ms) to keep a cached helm-availability result before re-checking.
// A negative result (helm not found) is also re-verified after this period so
// that installing helm while the process is running is picked up automatically.
const HELM_AVAILABLE_CACHE_TTL_MS = 60_000;

let _helmAvailableCache: boolean | null = null;
let _helmAvailableCachedAt: number = 0;

function helmBin(): string {
  return "helm";
}

/**
 * Validate that a chart directory looks like a valid helm chart (has Chart.yaml).
 * Throws if not.
 */
function assertValidChartDir(chartDir: string): void {
  if (!existsSync(`${chartDir}/Chart.yaml`)) {
    throw new Error(`Not a valid Helm chart directory: ${chartDir} (missing Chart.yaml)`);
  }
}

/**
 * Run `helm template` on a chart directory with optional values file overrides.
 * Automatically falls back to the pure-JS renderer if `helm` is not installed.
 *
 * @param chartDir   Absolute path to the unpacked chart directory
 * @param releaseName  Release name passed to helm template
 * @param valuesFiles  Paths to values YAML files (-f flags)
 * @param extraArgs    Any extra args (only used when CLI is available)
 * @returns Multi-document YAML string
 */
export async function runHelmTemplate(
  chartDir: string,
  releaseName = "release",
  valuesFiles: string[] = [],
  extraArgs: string[] = []
): Promise<string> {
  assertValidChartDir(chartDir);

  // Try CLI first; fall back to JS renderer if unavailable
  const cliAvailable = await isHelmAvailable();

  if (cliAvailable) {
    const args: string[] = ["template", releaseName, chartDir];
    for (const vf of valuesFiles) {
      args.push("-f", vf);
    }
    args.push(...extraArgs);

    let stdout: string;
    let stderr: string;
    try {
      ({ stdout, stderr } = await execFileAsync(helmBin(), args, {
        timeout: HELM_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
      }));
    } catch (err) {
      const helmErr = err as { stderr?: string; message?: string; code?: number | string };
      const errStderr = helmErr.stderr?.trim();
      if (errStderr) {
        throw new Error(`helm template failed:\n${errStderr}`);
      }
      throw err;
    }

    if (stderr && stderr.trim()) {
      console.warn("[helmRunner] helm template stderr:", stderr.trim());
    }
    return stdout;
  }

  // JS fallback
  console.info("[helmRunner] helm CLI not found — using built-in JS renderer");
  return renderHelmChartJS(chartDir, releaseName, valuesFiles);
}

/**
 * Run `helm show values` on a chart directory or .tgz file.
 * Returns the YAML string of the default values.
 */
export async function runHelmShowValues(chartPath: string): Promise<string> {
  const { stdout } = await execFileAsync(helmBin(), ["show", "values", chartPath], {
    timeout: HELM_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Pull a chart from a Helm repository as a .tgz into destDir.
 *
 * @param repoUrl    e.g. "https://charts.bitnami.com/bitnami"
 * @param chartName  e.g. "nginx"
 * @param version    optional, e.g. "1.2.3"
 * @param destDir    Absolute directory to download into
 * @returns path to the downloaded .tgz file
 */
export async function runHelmPull(
  repoUrl: string,
  chartName: string,
  destDir: string,
  version?: string
): Promise<string> {
  const args: string[] = [
    "pull",
    "--repo",
    repoUrl,
    chartName,
    "--destination",
    destDir,
  ];

  if (version) {
    args.push("--version", version);
  }

  const { stderr } = await execFileAsync(helmBin(), args, {
    timeout: HELM_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
  });

  if (stderr && stderr.trim()) {
    console.warn("[helmRunner] helm pull stderr:", stderr.trim());
  }

  // Find the downloaded file
  const { readdir } = await import("fs/promises");
  const files = await readdir(destDir);
  const tgz = files.find((f) => f.endsWith(".tgz"));
  if (!tgz) {
    throw new Error(`helm pull did not produce a .tgz in ${destDir}`);
  }

  return `${destDir}/${tgz}`;
}

/**
 * Check if the `helm` binary is available in PATH.
 * Result is cached with a TTL of {@link HELM_AVAILABLE_CACHE_TTL_MS} so that
 * helm becoming available (or unavailable) after process start is detected on
 * the next check after the cache expires.
 */
export async function isHelmAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_helmAvailableCache !== null && now - _helmAvailableCachedAt < HELM_AVAILABLE_CACHE_TTL_MS) {
    return _helmAvailableCache;
  }
  try {
    await execFileAsync(helmBin(), ["version", "--short"], { timeout: 5000 });
    _helmAvailableCache = true;
  } catch {
    _helmAvailableCache = false;
  }
  _helmAvailableCachedAt = now;
  return _helmAvailableCache;
}
