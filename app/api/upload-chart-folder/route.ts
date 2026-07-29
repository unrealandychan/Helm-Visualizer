import { NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { renderChart } from "@/lib/chartRenderer";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB, matches upload-chart

export async function POST(request: Request) {
  const tmpDir = path.join("/tmp", `helm-folder-${randomUUID()}`);

  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Request must be multipart/form-data" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Folder too large. Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
        { status: 413 }
      );
    }

    await mkdir(tmpDir, { recursive: true });
    const normalizedTmpDir = path.normalize(tmpDir);

    for (const file of files) {
      // The browser's folder picker sends each file's name as its path relative to the
      // selected folder (e.g. "my-chart/templates/deployment.yaml"). Strip the first
      // segment (the selected folder's own name) so the chart root lands at tmpDir,
      // mirroring the `strip: 1` behavior upload-chart applies to .tgz archives.
      const relPath = file.name.split("/").slice(1).join("/");
      if (!relPath || relPath.split("/").some((seg) => seg === "." || seg === "..")) {
        continue;
      }

      const destPath = path.resolve(normalizedTmpDir, relPath);
      if (!destPath.startsWith(normalizedTmpDir + path.sep)) {
        continue; // path traversal guard
      }

      await mkdir(path.dirname(destPath), { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(destPath, buffer);
    }

    return await renderChart(tmpDir);
  } catch (err) {
    console.error("[upload-chart-folder] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
