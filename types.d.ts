// Type definitions for the OpenAI-compatible chat completions API.
// Only the fields splunk-q uses are modeled; servers may return more.

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: false;
  /** Supported by gpt-oss / o-series compatible servers (vLLM, Ollama, etc). */
  reasoning_effort?: "low" | "medium" | "high";
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    /** Some servers (vLLM, Ollama) surface gpt-oss reasoning here. */
    reasoning_content?: string | null;
    reasoning?: string | null;
  };
  finish_reason: "stop" | "length" | "content_filter" | string | null;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ApiErrorBody {
  error?: { message?: string; type?: string; code?: string | number | null };
}

export interface Config {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  temperature: number;
  maxTokens: number | undefined;
  reasoningEffort: ChatCompletionRequest["reasoning_effort"];
  timeoutMs: number;
}

export interface CliOptions {
  request: string;
  explain: boolean;
  raw: boolean;
  json: boolean;
  contextFiles: string[];
  verbose: boolean;
}

export interface ParsedAnswer {
  query: string;
  explanation: string;
}
