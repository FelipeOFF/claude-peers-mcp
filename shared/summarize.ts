/**
 * Generate a 1-2 sentence summary of what a Claude Code instance is likely
 * working on, based on its working directory and git context.
 *
 * Provider-agnostic: pick the backend via CLAUDE_PEERS_SUMMARY_PROVIDER.
 *   - "none"              → disabled (default; Claude sets its own via set_summary)
 *   - "anthropic"         → Anthropic Messages API (default model: claude-haiku-4-5)
 *   - "openai"            → OpenAI / Azure / any OpenAI Chat Completions endpoint
 *   - "openai-compatible" → alias of "openai" (Groq, Together, custom base URL, ...)
 *   - "openrouter"        → OpenRouter (https://openrouter.ai/api/v1)
 *   - "claude-cli"        → spawn `claude -p` headless (uses claude.ai login, no API key)
 *
 * Backward compatibility: if CLAUDE_PEERS_SUMMARY_PROVIDER is unset but
 * OPENAI_API_KEY is present, behaves as the original OpenAI path.
 *
 * Falls back gracefully (returns null) whenever a backend is unavailable.
 */

const SYSTEM_PROMPT =
  "You generate brief summaries of what a developer is working on based on " +
  "their project context. Respond with exactly 1-2 sentences, no more. Be " +
  "specific about the project name and likely task.";

function buildContext(context: {
  cwd: string;
  git_root: string | null;
  git_branch?: string | null;
  recent_files?: string[];
}): string {
  const parts = [`Working directory: ${context.cwd}`];
  if (context.git_root) parts.push(`Git repo root: ${context.git_root}`);
  if (context.git_branch) parts.push(`Branch: ${context.git_branch}`);
  if (context.recent_files && context.recent_files.length > 0) {
    parts.push(`Recently modified files: ${context.recent_files.join(", ")}`);
  }
  return parts.join("\n");
}

function resolveProvider():
  | "none"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "claude-cli" {
  const explicit = (process.env.CLAUDE_PEERS_SUMMARY_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "openai-compatible") return "openai";
  if (
    explicit === "none" ||
    explicit === "anthropic" ||
    explicit === "openai" ||
    explicit === "openrouter" ||
    explicit === "claude-cli"
  ) {
    return explicit;
  }
  // Backward compatibility: unset + OPENAI_API_KEY present → original behavior.
  if (!explicit && process.env.OPENAI_API_KEY) return "openai";
  return "none";
}

export async function generateSummary(context: {
  cwd: string;
  git_root: string | null;
  git_branch?: string | null;
  recent_files?: string[];
}): Promise<string | null> {
  const provider = resolveProvider();
  if (provider === "none") return null;

  const userPrompt = `Based on this context, what is this developer likely working on?\n\n${buildContext(
    context
  )}`;

  try {
    switch (provider) {
      case "anthropic":
        return await summarizeAnthropic(userPrompt);
      case "openai":
        return await summarizeOpenAI(userPrompt);
      case "openrouter":
        return await summarizeOpenRouter(userPrompt);
      case "claude-cli":
        return await summarizeClaudeCli(userPrompt);
    }
  } catch {
    return null;
  }
  return null;
}

/** Anthropic Messages API — defaults to Claude Haiku 4.5. */
async function summarizeAnthropic(userPrompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  return text || null;
}

/** OpenAI Chat Completions — also covers OpenRouter/Groq/Azure via OPENAI_BASE_URL. */
async function summarizeOpenAI(userPrompt: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_MODEL ?? "gpt-5.4-nano";
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 100,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

/** OpenRouter — OpenAI-compatible Chat Completions at openrouter.ai. */
async function summarizeOpenRouter(userPrompt: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5";
  const baseUrl =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  // Optional OpenRouter attribution headers.
  if (process.env.OPENROUTER_REFERER)
    headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER;
  if (process.env.OPENROUTER_TITLE)
    headers["X-Title"] = process.env.OPENROUTER_TITLE;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 100,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

/**
 * Spawn `claude -p` headless. Uses the local claude.ai login (no API key),
 * isolated so it does not load claude-peers (or any MCP) recursively.
 */
async function summarizeClaudeCli(userPrompt: string): Promise<string | null> {
  const bin = process.env.CLAUDE_PEERS_CLAUDE_BIN ?? "claude";
  const model = process.env.CLAUDE_PEERS_CLI_MODEL ?? "haiku";

  const proc = Bun.spawn(
    [
      bin,
      "-p",
      `${SYSTEM_PROMPT}\n\n${userPrompt}`,
      "--model",
      model,
      // Isolate: no MCP servers (prevents recursive claude-peers registration).
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
    ],
    { stdout: "pipe", stderr: "ignore" }
  );

  const timeout = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // already exited
    }
  }, 20000);

  try {
    const text = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    return text.trim() || null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get the current git branch name for a directory.
 */
export async function getGitBranch(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code === 0) {
      return text.trim();
    }
  } catch {
    // not a git repo
  }
  return null;
}

/**
 * Get recently modified tracked files in the git repo.
 */
export async function getRecentFiles(
  cwd: string,
  limit = 10
): Promise<string[]> {
  try {
    // Get modified/staged files first
    const diffProc = Bun.spawn(["git", "diff", "--name-only", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const diffText = await new Response(diffProc.stdout).text();
    await diffProc.exited;

    const files = diffText
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    if (files.length >= limit) {
      return files.slice(0, limit);
    }

    // Also get recently committed files
    const logProc = Bun.spawn(
      ["git", "log", "--oneline", "--name-only", "-5", "--format="],
      {
        cwd,
        stdout: "pipe",
        stderr: "ignore",
      }
    );
    const logText = await new Response(logProc.stdout).text();
    await logProc.exited;

    const logFiles = logText
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    const allFiles = [...new Set([...files, ...logFiles])];
    return allFiles.slice(0, limit);
  } catch {
    return [];
  }
}
