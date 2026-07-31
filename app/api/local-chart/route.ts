import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import path from "path";
import { renderChart } from "@/lib/chartRenderer";

export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json();
    const body = rawBody !== null && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as { path?: string })
      : ({} as { path?: string });

    if (!body.path?.trim()) {
      return NextResponse.json(
        { error: "Provide a local directory path, e.g. /path/to/my-chart" },
        { status: 400 }
      );
    }

    const resolvedPath = path.resolve(body.path.trim());

    if (!existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: `Directory not found: ${resolvedPath}` },
        { status: 404 }
      );
    }

    if (!statSync(resolvedPath).isDirectory()) {
      return NextResponse.json(
        { error: `Not a directory: ${resolvedPath}` },
        { status: 400 }
      );
    }

    return await renderChart(resolvedPath);
  } catch (err) {
    console.error("[local-chart] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
