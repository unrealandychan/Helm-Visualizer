import { NextResponse } from "next/server";
import type { ChartRenderResult } from "@/types/helm";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  chartContext: ChartRenderResult | null;
  activeEnv: string;
}

function buildSystemPrompt(chartContext: ChartRenderResult | null, activeEnv: string): string {
  if (!chartContext) {
    return [
      "You are a helpful Helm chart assistant.",
      "No chart is currently loaded. Answer general questions about Helm and Kubernetes.",
    ].join("\n");
  }

  const { chartMeta, environments } = chartContext;
  const envResult = environments.find((e) => e.env === activeEnv) ?? environments[0];

  const lines: string[] = [
    "You are an expert Helm and Kubernetes assistant embedded in the Helm Chart Visualizer application.",
    "The user is viewing a Helm chart and may ask questions about its resources, values, or configuration.",
    "",
    "## Chart metadata",
    `- Name: ${chartMeta.name}`,
    `- Version: ${chartMeta.version}`,
    `- App version: ${chartMeta.appVersion}`,
    `- Description: ${chartMeta.description}`,
    `- API version: ${chartMeta.apiVersion}`,
    "",
    `## Active environment: ${envResult?.env ?? activeEnv}`,
  ];

  if (envResult) {
    if (envResult.renderError) {
      lines.push("", "## Render error", envResult.renderError);
    } else {
      lines.push(
        "",
        "## Rendered Kubernetes resources",
        ...envResult.resources.map((r) => {
          const name = r.metadata?.name ?? "(unnamed)";
          const ns = r.metadata?.namespace ? ` (namespace: ${r.metadata.namespace})` : "";
          return `- ${r.kind}/${name}${ns} [apiVersion: ${r.apiVersion}]`;
        }),
        "",
        "## Values (dot-notation keys)",
        // Cap at 200 entries to stay within the LLM context window
        ...envResult.valuesTree.entries.slice(0, 200).map(
          (e) => `- ${e.key}: ${JSON.stringify(e.value)} (${e.type})`
        ),
      );
    }

    const otherEnvs = environments.filter((e) => e.env !== envResult.env);
    if (otherEnvs.length > 0) {
      lines.push(
        "",
        "## Other available environments",
        ...otherEnvs.map((e) => `- ${e.env} (${e.resources.length} resources)`),
      );
    }
  }

  lines.push(
    "",
    "Answer concisely and accurately. If you reference a specific resource or value, name it explicitly.",
    "When the user asks for improvements or best practices, focus on the chart that is loaded.",
  );

  return lines.join("\n");
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { messages, chartContext, activeEnv } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required." }, { status: 400 });
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const systemPrompt = buildSystemPrompt(chartContext, activeEnv);

  const openaiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: openaiMessages, stream: true }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach LLM API: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `LLM API error ${upstream.status}: ${text}` },
      { status: upstream.status }
    );
  }

  // Stream the SSE response straight through to the client
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          const chunk = decoder.decode(value, { stream: true });
          if (chunk.includes("data: [DONE]")) break;
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
