import { NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { extract } from "tar";
import { renderChart } from "@/lib/chartRenderer";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(request: Request) {
  const tmpDir = path.join("/tmp", `helm-upload-${randomUUID()}`);

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".tgz") && !file.name.endsWith(".tar.gz")) {
      return NextResponse.json(
        { error: "Only .tgz / .tar.gz Helm chart archives are accepted." },
        { status: 400 }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
        { status: 413 }
      );
    }

    // Write to temp dir
    await mkdir(tmpDir, { recursive: true });
    const tgzPath = path.join(tmpDir, "chart.tgz");
    const extractDir = path.join(tmpDir, "extracted");
    await mkdir(extractDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tgzPath, buffer);

    // Extract (strip top-level chart dir)
    await extract({ file: tgzPath, cwd: extractDir, strip: 1 });

    return await renderChart(extractDir);
  } catch (err) {
    console.error("[upload-chart] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    // Always clean up temp files
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

