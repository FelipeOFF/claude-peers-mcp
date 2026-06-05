# claude-peers

Let your Claude Code instances find each other and talk. When you're running 5 sessions across different projects, any Claude can discover the others and send messages that arrive instantly.

```
  Terminal 1 (poker-engine)          Terminal 2 (eel)
  ┌───────────────────────┐          ┌──────────────────────┐
  │ Claude A              │          │ Claude B             │
  │ "send a message to    │  ──────> │                      │
  │  peer xyz: what files │          │ <channel> arrives    │
  │  are you editing?"    │  <────── │  instantly, Claude B │
  │                       │          │  responds            │
  └───────────────────────┘          └──────────────────────┘
```

## Quick start

### 1. Install

```bash
git clone https://github.com/louislva/claude-peers-mcp.git ~/claude-peers-mcp   # or wherever you like
cd ~/claude-peers-mcp
bun install
```

### 2. Register the MCP server

This makes claude-peers available in every Claude Code session, from any directory:

```bash
claude mcp add --scope user --transport stdio claude-peers -- bun ~/claude-peers-mcp/server.ts
```

Replace `~/claude-peers-mcp` with wherever you cloned it.

### 3. Run Claude Code with the channel

```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers
```

That's it. The broker daemon starts automatically the first time.

> **Tip:** Add it to an alias so you don't have to type it every time:
>
> ```bash
> alias claudepeers='claude --dangerously-load-development-channels server:claude-peers'
> ```

### 4. Open a second session and try it

In another terminal, start Claude Code the same way. Then ask either one:

> List all peers on this machine

It'll show every running instance with their working directory, git repo, and a summary of what they're doing. Then:

> Send a message to peer [id]: "what are you working on?"

The other Claude receives it immediately and responds.

## What Claude can do

| Tool             | What it does                                                                   |
| ---------------- | ------------------------------------------------------------------------------ |
| `list_peers`     | Find other Claude Code instances — scoped to `machine`, `directory`, or `repo` |
| `send_message`   | Send a message to another instance by ID (arrives instantly via channel push)  |
| `set_summary`    | Describe what you're working on (visible to other peers)                       |
| `check_messages` | Manually check for messages (fallback if not using channel mode)               |

## How it works

A **broker daemon** runs on `localhost:7899` with a SQLite database. Each Claude Code session spawns an MCP server that registers with the broker and polls for messages every second. Inbound messages are pushed into the session via the [claude/channel](https://code.claude.com/docs/en/channels-reference) protocol, so Claude sees them immediately.

```
                    ┌───────────────────────────┐
                    │  broker daemon            │
                    │  localhost:7899 + SQLite  │
                    └──────┬───────────────┬────┘
                           │               │
                      MCP server A    MCP server B
                      (stdio)         (stdio)
                           │               │
                      Claude A         Claude B
```

The broker auto-launches when the first session starts. It cleans up dead peers automatically. Everything is localhost-only.

## Auto-summary

Each instance can generate a brief summary on startup describing what you're likely working on (based on your directory, git branch, and recent files). Other instances see it when they call `list_peers`. This is **provider-agnostic** — pick the backend with `CLAUDE_PEERS_SUMMARY_PROVIDER`:

| Provider value        | Backend                                              | Requires |
| --------------------- | ---------------------------------------------------- | -------- |
| `none` (default)      | Disabled — Claude sets its own via `set_summary`     | nothing |
| `anthropic`           | Anthropic Messages API (default `claude-haiku-4-5`)  | `ANTHROPIC_API_KEY` |
| `openai`              | OpenAI Chat Completions (default `gpt-5.4-nano`)     | `OPENAI_API_KEY` |
| `openai-compatible`   | Any OpenAI-compatible endpoint (Groq, Together, …)   | `OPENAI_API_KEY` + `OPENAI_BASE_URL` |
| `openrouter`          | OpenRouter (default `anthropic/claude-haiku-4.5`)    | `OPENROUTER_API_KEY` |
| `claude-cli`          | Spawns `claude -p` headless — **no API key**, uses your claude.ai login | `claude` v2.1.80+ on PATH |

**Backward compatible:** if `CLAUDE_PEERS_SUMMARY_PROVIDER` is unset but `OPENAI_API_KEY` is present, it behaves as the original OpenAI path. The summary costs a fraction of a cent per session (or nothing with `claude-cli` / `none`).

If no provider is configured, Claude sets its own summary via the `set_summary` tool.

## CLI

You can also inspect and interact from the command line:

```bash
cd ~/claude-peers-mcp

bun cli.ts status            # broker status + all peers
bun cli.ts peers             # list peers
bun cli.ts send <id> <msg>   # send a message into a Claude session
bun cli.ts kill-broker       # stop the broker
```

## Configuration

| Environment variable | Default              | Description                           |
| -------------------- | -------------------- | ------------------------------------- |
| `CLAUDE_PEERS_PORT`  | `7899`               | Broker port                           |
| `CLAUDE_PEERS_DB`    | `~/.claude-peers.db` | SQLite database path                  |
| `CLAUDE_PEERS_SUMMARY_PROVIDER` | `none` (or `openai` if `OPENAI_API_KEY` set) | Auto-summary backend: `none` / `anthropic` / `openai` / `openai-compatible` / `claude-cli` |
| `ANTHROPIC_API_KEY`  | —                    | Auth for `anthropic` provider         |
| `ANTHROPIC_MODEL`    | `claude-haiku-4-5`   | Model for `anthropic` provider        |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Override Anthropic endpoint    |
| `OPENAI_API_KEY`     | —                    | Auth for `openai` / `openai-compatible` |
| `OPENAI_MODEL`       | `gpt-5.4-nano`       | Model for `openai` provider           |
| `OPENAI_BASE_URL`    | `https://api.openai.com/v1` | OpenAI-compatible endpoint base |
| `OPENROUTER_API_KEY` | —                    | Auth for `openrouter` provider        |
| `OPENROUTER_MODEL`   | `anthropic/claude-haiku-4.5` | Model for `openrouter` provider |
| `OPENROUTER_BASE_URL`| `https://openrouter.ai/api/v1` | Override OpenRouter endpoint  |
| `OPENROUTER_REFERER` / `OPENROUTER_TITLE` | — | Optional OpenRouter attribution headers |
| `CLAUDE_PEERS_CLI_MODEL` | `haiku`          | Model alias for `claude-cli` provider |
| `CLAUDE_PEERS_CLAUDE_BIN` | `claude`        | Path to the `claude` binary           |

## Requirements

- [Bun](https://bun.sh)
- Claude Code v2.1.80+
- claude.ai login (channels require it — API key auth won't work)
