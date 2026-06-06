import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import type { K8sResource } from "@/types/helm";
import { diffResources } from "@/lib/clusterDiffer";

const execFileAsync = promisify(execFile);

interface DiffRequest {
  resources: K8sResource[];
  namespace: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DiffRequest;
    const { resources, namespace = "default" } = body;

    if (!resources || !Array.isArray(resources)) {
      return NextResponse.json({ error: "Missing or invalid resources list." }, { status: 400 });
    }

    // 1. Verify kubectl is available
    try {
      await execFileAsync("kubectl", ["version", "--client"], { timeout: 3000 });
    } catch {
      return NextResponse.json(
        { error: "kubectl is not installed or not in the system PATH on the server." },
        { status: 503 }
      );
    }

    // 2. Fetch live resources in parallel
    const diffs = await Promise.all(
      resources.map(async (r) => {
        const kind = r.kind;
        const name = r.metadata?.name;
        if (!kind || !name) return null;

        const ns = r.metadata?.namespace || namespace;

        try {
          // Fetch live resource as JSON
          const { stdout } = await execFileAsync(
            "kubectl",
            ["get", kind, name, "-n", ns, "-o", "json"],
            { timeout: 5000 }
          );

          const liveJson = JSON.parse(stdout) as Record<string, unknown>;
          return diffResources(r, liveJson);
        } catch {
          // If NotFound, diffResources handles null as local-only
          return diffResources(r, null);
        }
      })
    );

    const validDiffs = diffs.filter((d) => d !== null);

    return NextResponse.json({ diffs: validDiffs });
  } catch (err) {
    console.error("[cluster-diff] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
