#!/usr/bin/env node
// @ts-check
/**
 * splunk-q — turn plain English into Splunk SPL using an OpenAI-compatible chat API.
 *
 * Usage: node splunk-q.mjs [options] "describe the search you want"
 *
 * No runtime dependencies. Types live in ./types.d.ts and are checked with `npm run typecheck`.
 */

/** @import { ChatCompletionRequest, ChatCompletionResponse, ApiErrorBody, ChatMessage, CliOptions, Config, ParsedAnswer } from "./types.js" */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = join(ROOT, "prompts", "system.md");
const DEFAULT_CONTEXT_PATH = join(ROOT, "context.md");

const HELP = `splunk-q — generate Splunk SPL from plain English

Usage:
  node splunk-q.mjs [options] "<request>"
  echo "<request>" | node splunk-q.mjs [options]

Options:
  -e, --explain          Also print the model's explanation (to stderr)
  -c, --context <file>   Extra context file (indexes, fields, etc). Repeatable.
                         ./context.md is loaded automatically if it exists.
      --raw              Print the full, unparsed model response
      --json             Print {query, explanation, model, usage} as JSON
  -v, --verbose          Print request details and token usage to stderr
  -h, --help             Show this help

Environment (or .env next to this script):
  SPLUNK_Q_API_BASE_URL      e.g. https://host/v1           (required)
  SPLUNK_Q_MODEL             e.g. gpt-oss-120b              (required)
  SPLUNK_Q_API_KEY           bearer token                   (optional)
  SPLUNK_Q_TEMPERATURE       default 0.1
  SPLUNK_Q_MAX_TOKENS        default: server default
  SPLUNK_Q_REASONING_EFFORT  low | medium | high (gpt-oss only)
  SPLUNK_Q_TIMEOUT_MS        default 120000
`;

class UsageError extends Error {}

/** @returns {Promise<CliOptions>} */
async function parseCli() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      explain: { type: "boolean", short: "e", default: false },
      context: { type: "string", short: "c", multiple: true, default: [] },
      raw: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  let request = positionals.join(" ").trim();
  if (!request && !process.stdin.isTTY) request = (await readStdin()).trim();
  if (!request) throw new UsageError("No request given.\n\n" + HELP);

  return {
    request,
    explain: values.explain,
    raw: values.raw,
    json: values.json,
    contextFiles: values.context,
    verbose: values.verbose,
  };
}

/** @returns {Promise<string>} */
async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(/** @type {Buffer} */ (chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** @returns {Config} */
function loadConfig() {
  const envFile = join(ROOT, ".env");
  // Existing environment variables are not overridden by .env.
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const env = process.env;
  const baseUrl = env.SPLUNK_Q_API_BASE_URL?.trim();
  const model = env.SPLUNK_Q_MODEL?.trim();
  if (!baseUrl) throw new UsageError("SPLUNK_Q_API_BASE_URL is not set (see .env.example).");
  if (!model) throw new UsageError("SPLUNK_Q_MODEL is not set (see .env.example).");

  const effort = env.SPLUNK_Q_REASONING_EFFORT?.trim() || undefined;
  if (effort !== undefined && !isReasoningEffort(effort)) {
    throw new UsageError(`SPLUNK_Q_REASONING_EFFORT must be low, medium, or high (got "${effort}").`);
  }

  return {
    baseUrl,
    model,
    apiKey: env.SPLUNK_Q_API_KEY?.trim() || undefined,
    temperature: numberEnv("SPLUNK_Q_TEMPERATURE") ?? 0.1,
    maxTokens: numberEnv("SPLUNK_Q_MAX_TOKENS"),
    reasoningEffort: effort,
    timeoutMs: numberEnv("SPLUNK_Q_TIMEOUT_MS") ?? 120_000,
  };
}

/**
 * @param {string} value
 * @returns {value is NonNullable<Config["reasoningEffort"]>}
 */
function isReasoningEffort(value) {
  return value === "low" || value === "medium" || value === "high";
}

/**
 * @param {string} name
 * @returns {number | undefined}
 */
function numberEnv(name) {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new UsageError(`${name} must be a number (got "${raw}").`);
  return n;
}

/**
 * @param {string[]} extraContextFiles
 * @returns {string}
 */
function buildSystemPrompt(extraContextFiles) {
  let prompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8").trim();

  const files = existsSync(DEFAULT_CONTEXT_PATH) ? [DEFAULT_CONTEXT_PATH] : [];
  for (const f of extraContextFiles) {
    const p = resolve(f);
    if (!existsSync(p)) throw new UsageError(`Context file not found: ${f}`);
    files.push(p);
  }

  const contexts = files.map((f) => readFileSync(f, "utf8").trim()).filter(Boolean);
  if (contexts.length) {
    prompt +=
      "\n\n# Environment context (authoritative — prefer these names over generic ones)\n\n" +
      contexts.join("\n\n---\n\n");
  }
  return prompt;
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function completionsUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

/**
 * @param {Config} config
 * @param {ChatMessage[]} messages
 * @param {boolean} verbose
 * @returns {Promise<ChatCompletionResponse>}
 */
async function chat(config, messages, verbose) {
  /** @type {ChatCompletionRequest} */
  const body = {
    model: config.model,
    messages,
    temperature: config.temperature,
    stream: false,
  };
  if (config.maxTokens !== undefined) body.max_tokens = config.maxTokens;
  if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;

  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const url = completionsUrl(config.baseUrl);
  if (verbose) log(`POST ${url} (model=${config.model})`);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    const e = /** @type {Error} */ (err);
    if (e.name === "TimeoutError") throw new Error(`Request timed out after ${config.timeoutMs}ms`);
    throw new Error(`Request to ${url} failed: ${e.message}${e.cause ? ` (${String(e.cause)})` : ""}`);
  }

  const text = await res.text();
  if (!res.ok) {
    /** @type {string} */
    let detail = text;
    try {
      detail = /** @type {ApiErrorBody} */ (JSON.parse(text)).error?.message ?? text;
    } catch {}
    throw new Error(`API error ${res.status} ${res.statusText}: ${detail.slice(0, 2000)}`);
  }

  try {
    return /** @type {ChatCompletionResponse} */ (JSON.parse(text));
  } catch {
    throw new Error(`API returned non-JSON response: ${text.slice(0, 500)}`);
  }
}

/**
 * Pull the SPL code block and explanation out of the model's answer.
 * @param {string} content
 * @returns {ParsedAnswer | null}
 */
function parseAnswer(content) {
  // Some models inline their reasoning; drop it.
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const blocks = [...cleaned.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const block =
    blocks.find((m) => /^(spl|splunk)$/i.test(m[1] ?? "")) ??
    blocks.find((m) => !m[1]) ??
    blocks[0];
  if (!block) return null;

  const query = (block[2] ?? "").trim();
  const after = cleaned.slice((block.index ?? 0) + block[0].length);
  const explanation = after.replace(/^\s*\**Explanation:?\**\s*/i, "").trim();
  return { query, explanation };
}

/** @param {string} msg */
function log(msg) {
  process.stderr.write(`[splunk-q] ${msg}\n`);
}

async function main() {
  const opts = await parseCli();
  const config = loadConfig();
  const systemPrompt = buildSystemPrompt(opts.contextFiles);

  const res = await chat(
    config,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: opts.request },
    ],
    opts.verbose,
  );

  const choice = res.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (opts.verbose && res.usage) {
    log(`tokens: prompt=${res.usage.prompt_tokens} completion=${res.usage.completion_tokens}`);
  }
  if (choice?.finish_reason === "length") {
    log("warning: response hit max_tokens and may be truncated (raise SPLUNK_Q_MAX_TOKENS).");
  }
  if (!content.trim()) throw new Error("Model returned an empty response.");

  if (opts.raw) {
    process.stdout.write(content.trim() + "\n");
    return;
  }

  const parsed = parseAnswer(content);
  if (!parsed) {
    log("warning: no code block found in response; printing it as-is.");
    process.stdout.write(content.trim() + "\n");
    process.exitCode = 2;
    return;
  }

  if (opts.json) {
    const out = { ...parsed, model: res.model, usage: res.usage ?? null };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  process.stdout.write(parsed.query + "\n");
  if (opts.explain && parsed.explanation) process.stderr.write("\n" + parsed.explanation + "\n");
}

main().catch((err) => {
  if (err instanceof UsageError) {
    process.stderr.write(err.message + "\n");
    process.exit(64);
  }
  log(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
