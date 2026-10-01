# splunk-q

Plain English → Splunk SPL, using any OpenAI-compatible chat API. No runtime dependencies (Node ≥ 20.12).

```sh
cp .env.example .env            # fill in API URL / key / model
cp context.example.md context.md   # optional but strongly recommended: describe your indexes & fields

node splunk-q.mjs "failed logins by user in the last 4 hours, top 20"
node splunk-q.mjs -e "hosts that stopped sending logs"      # + explanation
node splunk-q.mjs --json "5xx rate per endpoint"            # machine-readable
node splunk-q.mjs -c extra/firewall.md "blocked outbound by dest port"
```

The query goes to stdout and everything else to stderr, so you can pipe it, e.g. `node splunk-q.mjs "..." | clip`.

## Files

| File | Purpose |
| --- | --- |
| `splunk-q.mjs` | CLI. Plain JS with JSDoc types, so `node` runs it directly. |
| `types.d.ts` | API and config types. |
| `prompts/system.md` | System prompt: output contract, SPL syntax guide, command and function reference, worked examples, pitfalls. Edit this to tune behavior. |
| `context.md` | Your environment (indexes, sourcetypes, fields, lookups, macros, conventions). Loaded automatically if it's there. |

## Type checking

```sh
npm install        # dev-only: typescript, @types/node
npm run typecheck
```
