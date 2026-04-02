import { NextResponse } from "next/server";
import { searchArtifactHub } from "@/lib/artifactHub";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters." }, { status: 400 });
  }

  try {
    const packages = await searchArtifactHub(query.trim());
    return NextResponse.json({ packages });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 502 }
    );
  }
}
