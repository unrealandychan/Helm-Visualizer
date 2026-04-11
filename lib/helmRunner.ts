import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { readFile, mkdtemp, rm, readdir } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { extract } from "tar";
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
 * Validate that a chart name contains only safe characters to prevent argument injection.
 * Throws if invalid.
 */
function assertValidChartName(chartName: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(chartName)) {
    throw new Error(
      `Invalid chart name "${chartName}". Chart names must only contain letters, digits, hyphens, and underscores.`
    );
  }
}

/**
 * Validate that a chart version string contains only safe characters.
 * Throws if invalid.
 */
function assertValidChartVersion(version: string): void {
  if (!/^[a-zA-Z0-9._+:-]+$/.test(version)) {
    throw new Error(
      `Invalid version "${version}". Versions must only contain letters, digits, dots, hyphens, underscores, plus signs, and colons.`
    );
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
 * Pure-JS fallback for `runHelmShowValues`.
 * Reads `values.yaml` directly from a chart directory or a `.tgz` archive.
 */
async function readHelmShowValuesJS(chartPath: string): Promise<string> {
  if (!chartPath.endsWith(".tgz")) {
    // Directory: read values.yaml directly
    const valuesPath = path.join(chartPath, "values.yaml");
    if (existsSync(valuesPath)) {
      return readFile(valuesPath, "utf-8");
    }
    return "";
  }

  // .tgz archive: extract only values.yaml into a temp dir
  const tmpDir = await mkdtemp(path.join(tmpdir(), "helm-values-"));
  try {
    await extract({
      file: chartPath,
      cwd: tmpDir,
      strip: 1,
      filter: (p: string) =>
        path.basename(p) === "values.yaml" && !p.includes("/charts/"),
    });
    const valuesPath = path.join(tmpDir, "values.yaml");
    if (existsSync(valuesPath)) {
      return readFile(valuesPath, "utf-8");
    }
    return "";
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch((e) => {
      console.warn("[helmRunner] failed to remove temp dir:", e);
    });
  }
}

/**
 * Run `helm show values` on a chart directory or .tgz file.
 * Returns the YAML string of the default values.
 * Automatically falls back to reading values.yaml directly if `helm` is not installed.
 */
export async function runHelmShowValues(chartPath: string): Promise<string> {
  const cliAvailable = await isHelmAvailable();

  if (cliAvailable) {
    let stdout: string;
    let stderr: string;
    try {
      ({ stdout, stderr } = await execFileAsync(helmBin(), ["show", "values", chartPath], {
        timeout: HELM_TIMEOUT_MS,
        maxBuffer: 5 * 1024 * 1024,
      }));
    } catch (err) {
      const helmErr = err as { stderr?: string; message?: string; code?: number | string };
      const errStderr = helmErr.stderr?.trim();
      if (errStderr) {
        throw new Error(`helm show values failed:\n${errStderr}`);
      }
      throw err;
    }

    if (stderr && stderr.trim()) {
      console.warn("[helmRunner] helm show values stderr:", stderr.trim());
    }
    return stdout;
  }

  // JS fallback
  console.info("[helmRunner] helm CLI not found — reading values.yaml directly");
  return readHelmShowValuesJS(chartPath);
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
  assertValidChartName(chartName);
  if (version !== undefined) {
    assertValidChartVersion(version);
  }

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
