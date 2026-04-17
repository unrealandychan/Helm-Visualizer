"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import React from "react";
import { MessageCircle, X, Send, Bot, User, Loader2, AlertCircle, Copy, Check } from "lucide-react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";
import type { ChartRenderResult } from "@/types/helm";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

interface ChatBotProps {
  chartContext: ChartRenderResult | null;
  activeEnv: string;
}

export function ChatBot({ chartContext, activeEnv }: ChatBotProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom whenever messages change or streaming updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    // Build a minimal context — strip large fields (spec, labels, annotations, raw values)
    // to keep request payload small and avoid hitting server/LLM limits.
    // The entry cap here must match PROMPT_ENTRY_LIMIT in app/api/chat/route.ts.
    const PAYLOAD_ENTRY_LIMIT = 200;
    const minimalContext = chartContext
      ? {
          chartMeta: chartContext.chartMeta,
          environments: chartContext.environments.map((env) => ({
            env: env.env,
            renderError: env.renderError,
            resources: env.resources.map((r) => ({
              apiVersion: r.apiVersion,
              kind: r.kind,
              metadata: { name: r.metadata?.name, namespace: r.metadata?.namespace },
            })),
            valuesTree: { entries: env.valuesTree.entries.slice(0, PAYLOAD_ENTRY_LIMIT) },
          })),
        }
      : null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          chartContext: minimalContext,
          activeEnv,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: json.error ?? "An error occurred.", error: true }
              : m
          )
        );
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body.");

      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const { done: readDone, value } = await reader.read();
        if (readDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(data);
            const delta: string = parsed.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + delta } : m
                )
              );
            }
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: err instanceof Error ? err.message : "An unexpected error occurred.",
                error: true,
              }
            : m
        )
      );
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, messages, chartContext, activeEnv]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleClose() {
    abortRef.current?.abort();
    setOpen(false);
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "fixed bottom-6 right-6 z-40 flex items-center justify-center w-12 h-12 rounded-full shadow-lg transition-colors",
          open
            ? "bg-zinc-700 hover:bg-zinc-600"
            : "bg-blue-600 hover:bg-blue-500"
        )}
        title={open ? "Close chat" : "Ask about this chart"}
      >
        {open ? (
          <X className="w-5 h-5 text-white" />
        ) : (
          <MessageCircle className="w-5 h-5 text-white" />
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-[88px] right-6 z-40 w-[360px] max-h-[520px] flex flex-col rounded-2xl shadow-2xl border border-zinc-700 bg-zinc-900 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 bg-zinc-800 border-b border-zinc-700 shrink-0">
            <Bot className="w-4 h-4 text-blue-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold leading-none">Chart Assistant</p>
              {chartContext ? (
                <p className="text-zinc-400 text-[10px] mt-0.5 truncate">
                  {chartContext.chartMeta.name} · {activeEnv}
                </p>
              ) : (
                <p className="text-zinc-500 text-[10px] mt-0.5">No chart loaded</p>
              )}
            </div>
            <button
              onClick={handleClose}
              className="text-zinc-500 hover:text-white p-1 rounded hover:bg-zinc-700 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-500 py-8">
                <MessageCircle className="w-8 h-8 opacity-40" />
                <p className="text-xs text-center max-w-[200px]">
                  {chartContext
                    ? "Ask anything about your Helm chart — resources, values, best practices…"
                    : "Load a chart first, then ask questions about it."}
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {streaming && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && (
              <div className="flex items-center gap-1.5 text-zinc-500 text-xs pl-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-zinc-700 p-3 flex gap-2 items-end bg-zinc-900">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this chart…"
              rows={1}
              className="flex-1 resize-none rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm placeholder-zinc-500 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[36px] max-h-[120px] overflow-y-auto leading-5"
              style={{ height: "auto" }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streaming}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              title="Send"
            >
              {streaming ? (
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              ) : (
                <Send className="w-4 h-4 text-white" />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const codeRef = useRef<HTMLElement>(null);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetCopyStateLater() {
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
    }

    copyResetTimeoutRef.current = setTimeout(() => {
      setCopyState("idle");
      copyResetTimeoutRef.current = null;
    }, 2000);
  }

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  function handleCopy() {
    const text = codeRef.current?.textContent ?? "";
    navigator.clipboard.writeText(text).then(() => {
      setCopyState("copied");
      resetCopyStateLater();
    }).catch(() => {
      setCopyState("error");
      resetCopyStateLater();
    });
  }

  return (
    <div className="relative group my-2">
      <pre className="rounded-lg bg-zinc-950 overflow-x-auto text-xs leading-relaxed">
        <code ref={codeRef} className={className}>{children}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
        title={copyState === "error" ? "Copy failed" : "Copy code"}
        type="button"
      >
        {copyState === "copied" ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : copyState === "error" ? (
          <X className="w-3 h-3 text-red-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}

interface CodeElementProps {
  className?: string;
  children?: React.ReactNode;
}

function extractCodeProps(children: React.ReactNode): CodeElementProps | null {
  const codeEl = Array.isArray(children) ? children[0] : children;
  if (React.isValidElement<CodeElementProps>(codeEl)) {
    const { className, children: codeChildren } = codeEl.props;
    return { className, children: codeChildren };
  }
  return null;
}

const markdownComponents: Components = {
  pre({ children }) {
    const codeProps = extractCodeProps(children);
    if (codeProps) {
      return <CodeBlock className={codeProps.className}>{codeProps.children}</CodeBlock>;
    }
    return (
      <div className="relative group my-2">
        <pre className="rounded-lg bg-zinc-950 overflow-x-auto text-xs leading-relaxed">{children}</pre>
      </div>
    );
  },
  code({ className, children, ...props }) {
    // Inline code (no language class means it's not inside a fenced block handled by pre)
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="bg-zinc-700 text-zinc-200 px-1 py-0.5 rounded text-[11px] font-mono"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  p({ children }) {
    return <p className="mb-1 last:mb-0">{children}</p>;
  },
  ul({ children }) {
    return <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>;
  },
  li({ children }) {
    return <li>{children}</li>;
  },
  strong({ children }) {
    return <strong className="font-semibold">{children}</strong>;
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 underline hover:text-blue-300"
      >
        {children}
      </a>
    );
  },
};

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={clsx("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-blue-900 border border-blue-700 flex items-center justify-center shrink-0 mt-0.5">
          {message.error ? (
            <AlertCircle className="w-3 h-3 text-red-400" />
          ) : (
            <Bot className="w-3 h-3 text-blue-400" />
          )}
        </div>
      )}
      <div
        className={clsx(
          "max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed break-words",
          isUser
            ? "bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap"
            : message.error
            ? "bg-red-950/60 border border-red-800/50 text-red-300 rounded-bl-sm whitespace-pre-wrap"
            : "bg-zinc-800 text-zinc-200 rounded-bl-sm"
        )}
      >
        {isUser || message.error ? (
          message.content || <span className="opacity-0 select-none">​</span>
        ) : (
          message.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          ) : (
            <span className="opacity-0 select-none">​</span>
          )
        )}
      </div>
      {isUser && (
        <div className="w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-3 h-3 text-zinc-300" />
        </div>
      )}
    </div>
  );
}
