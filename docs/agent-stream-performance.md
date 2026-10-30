# Agent stream performance

How assistant text gets from a provider to the screen, and why it is paced on the way. Read this before changing `packages/server/src/server/agent/agent-stream-coalescer.ts`, the reducer queue in `packages/app/src/timeline/session-stream-reducers.ts`, or the reveal in `packages/app/src/hooks/use-revealed-text.ts`.

For terminal output, which is a separate pipeline with separate budgets, see [terminal-performance.md](terminal-performance.md).

## The pipeline

```
provider deltas (every provider streams incrementally)
  → AgentStreamCoalescer (daemon, leading + trailing, ≤1 message per 60ms per agent)
  → recordTimeline: one canonical row per flushed item
  → agent_stream ws message
  → reducer queue (app, one commit per frame) → session store
  → source-item plugin transforms → Markdown presentation / tool grouping
  → paced reveal (app, per displayed item) → paint
```

Every provider delivers incremental text, so there is no provider that needs special handling: Claude via `includePartialMessages`, Codex via `agent_message_delta`, ACP agents via `agent_message_chunk`, Pi and OMP via `text_delta`.

## Session metrics in the context details

The context meter shows **TPS (5m active)** and **Cache hit (session)** when the host advertises `agentSessionMetrics`. Keep these measurements per agent runtime session. Do not persist or backfill them, combine agents, or use account quota reports as token counters. A new runtime session starts a new ledger.

TPS follows OpenCode’s active-request calculation: sum output tokens and divide by the sum of model-response durations. Include each complete response that finished in the last five minutes. A response crossing the window boundary contributes its full count and duration; do not spread its tokens across time. Idle gaps and local tool settlement are excluded. Native request duration can include prompt processing, network delay, internal retries or provider-hosted tools, so this is an approximation of generation throughput. Do not infer duration from chunk arrival gaps, daemon coalescing, app reveal or a whole agent turn.

Pi supplies per-response `durationMs`; Oh My Pi supplies `duration`; OpenCode v2 pairs request dispatch with its separate response-stream end; Muse supplies per-completion `durationMs`. Count reasoning once: Pi/OMP output already includes it, while OpenCode reports it separately. Keep TPS **Unavailable** when a recent response has missing or invalid native timing/counts. Replace duplicate/corrected response samples by their stable identity. Expire samples during idle time so an open context display stays current. Cache availability is independent of TPS availability.

Codex and Claude use [CC Switch's session-log estimate](https://github.com/farion1231/cc-switch/blob/ee8ee25ebc63faa877e779f0831e29cf2b369604/src/components/usage/format.ts#L249-L292), shown with **≈**. Divide reported per-request output tokens by elapsed request seconds, including first-output wait. Use only responses with at least 200 output tokens and durations from one second through one hour; omit shorter or uncorrelated responses. Aggregate eligible requests with the same token/duration weighting and five-minute completion window. This estimate can be lower than decode speed because it includes prompt processing and network delay.

Use live provider-event receipt times, without reading private session logs. Following [CC Switch's request boundaries](https://github.com/farion1231/cc-switch/blob/ee8ee25ebc63faa877e779f0831e29cf2b369604/src-tauri/src/services/session_usage_codex.rs#L301-L440), freeze the preceding input/tool-result boundary when model output starts. Codex ends at the usage notification, or at the last model output when usage follows tool settlement. Claude pairs root `message_start`/`message_stop` and the final streamed output count, anchored at turn input or the preceding tool result. Exclude subagent frames, tool progress and tool-generated images. A decreasing Codex cumulative counter discards the ambiguous interval. Keep TPS **Unavailable** until an eligible response can be paired; unverified ACP/Antigravity counters remain unsupported. The native timing paths above are unchanged.

Cache hit is the token-weighted share of cache **reads** in all input tokens, including uncached input and cache writes. Cache writes are misses. An absent counter is unknown, not zero. Keep normalized samples separate from context occupancy and cost, and strip them before wire dispatch. Replace earlier snapshots of the same request or turn with its final result. A session-wide counter that decreases without a new epoch identity can mean a reset, retained-history shrinkage or a correction; leave the session percentage unavailable rather than adding overlapping totals.

Claude uses root requests and its authoritative per-turn result, excluding subagents. Codex, Pi and OMP report native session totals. Both OpenCode adapters use completed model-call counts and stable step identities, avoiding stale session snapshots during asynchronous reconciliation. Muse uses its counted-once per-completion prompt tokens and explicit cache-read count; its generic cached-token field varies by provider. Missing counters invalidate the last known percentage until a complete sample arrives. Antigravity's input convention is unverified, so its cache percentage is unavailable. Generic ACP usage has conflicting turn/session conventions ([upstream report](https://github.com/agentclientprotocol/agent-client-protocol/issues/1860)); leave unverified counters unavailable instead of guessing. Plugin providers can report [normalized usage samples](../public-docs/plugins/providers.md#report-session-usage).

## Why the reveal is paced

Arrival is lumpy and there is no fixing that at the source. A 60ms coalescing window carries however many characters the model produced in those 60ms, which swings by an order of magnitude within a single turn. Painting each delta as it lands makes the size of those lumps visible, and that is what reads as jagged.

So arrival sets a _target_ and the reveal rate is derived from the backlog instead. A burst makes the text catch up faster; it does not make the text jump. Shrinking the coalescing window does not fix this — it makes the lumps smaller and more frequent, at the cost of message rate on a daemon loop that already contends with terminal frames and per-message relay encryption.

## Invariants

- **The coalescer is leading + trailing.** The first delta after an idle window flushes synchronously; only the rest of the burst waits for the trailing timer. Reverting to trailing-only adds a full window to the first character of every turn. Same shape and the same reason as `TerminalOutputCoalescer`.
- **The leading flush adds a canonical row, and that is fine.** A burst's first chunk lands as its own timeline row. `mergeAssistantChunks` / `mergeReasoningChunks` in `timeline-projection.ts` join contiguous same-turn rows, and clients read the projected timeline, so history is unaffected. Tests that assert on raw rows have to account for the extra row; tests that assert on what a client sees do not.
- **The store holds the full text; only the rendered slice is paced.** Copy, selection, the chat outline, and scroll geometry all read the same string the user can see. Pacing the store instead would leave the bottom anchor chasing a content height that is ahead of the reveal.
- **One source assistant message is one display row.** Presentation projects plugin output and caches unchanged history. The shared [Markdown renderer](markdown-renderer.md) owns rendering on every platform. Chat paces the visible source and applies a 32,000-character render cap on web; native keeps the complete message. The native renderer keeps closed blocks in a stable head and sends the paced suffix to a separate tail view during streaming; completion reunites them for selection. This stays inside the renderer, without promoting blocks into timeline history.
- **Message identity survives completion.** Assistant row ids are source message ids. Plugin rows can replace a source, so find, scroll-to-message and history reveal still use `getStreamItemMessageId`. Width-specific measurements describe whole rendered messages.
- **First sight of a text is revealed whole.** Only growth is paced. This is what makes history hydration, timeline replay, a virtualized row remounting on scroll, and an already-finished message all render complete on first paint without a special case for each.
- **Leaving `phase: "streaming"` snaps the reveal.** A completed turn must never be left holding characters. `layoutStream` sets the phase, so anything outside the live head with an active turn is already complete.
- **The reducer queue commits on a frame, with a timer as the ceiling.** A frame callback never fires in a hidden tab, so a timer races it and wins when nothing is painting — the store has to keep advancing either way.
- **A history row re-renders only when its item or layout item identity changes.** The inverted
  FlatList hands every mounted cell a new `index` and `ref` whenever a row is prepended, so without a
  memo boundary each coalesced tick re-rendered every mounted row (about 50 on a phone, 100–250 ms of
  JS per tick). `layoutStream` keeps a layout item's identity when nothing about it changed,
  `useRevisedHistoryRows` hands a fresh item identity to rows whose tool-call group, expanded state,
  or breakpoint changed, and `StreamRow` memoizes on both. Every viewport runs its history
  through that hook; the web viewport once skipped it and history hosts of a live tool group went
  stale. A new field on `StreamLayoutItem` must be added to `areLayoutItemsEquivalent`, or sharing
  silently stops.
- **Streaming cost must not grow with revealed history.** Reading older messages must not
  make the next reply progressively more expensive to display. Reuse unchanged history work
  while text arrives, and release obsolete window caches as the reader reveals more history;
  window caches must stay bounded while their source timeline remains loaded.

## Native parsing cost

The native library reparses and measures its entire `markdown` prop on each update. During streaming, the renderer splits source at an mdast block boundary and memoizes the head, so per-frame updates parse only the tail. Boundary discovery runs when a source line completes, rather than on every reveal frame. The unfinished line and final parsed block stay in the tail, preserving list continuation, setext headings, tables and open fences. Reference-dependent source and HTML retain a larger tail because later source can change their meaning. A single long block therefore still carries its full parsing cost.

Completion restores one native text view per Mermaid-delimited segment, so selection crosses prose paragraphs again. The head retains its trailing block margin while split. JS reveal remains the pacing source; native opacity animation stays disabled.

## Measuring

- **Smoothness (user-perceived):** `packages/app/e2e/browser/agent-stream-smoothness.spec.ts`, gated behind `PASEO_AGENT_STREAM_PERF_E2E=1`. Drives the mock provider's `bursty-stream` model and reports coefficient of variation of characters painted per frame (smoothness) plus p95 gap between visible updates (stalls). Both numbers are needed: a stalled stream is perfectly smooth.
- **Reproducing bursty arrival:** the `bursty-stream` model in `mock-load-test-agent.ts` emits uneven runs of tokens separated by idle gaps. Burst sizes come from a seeded generator, so a run repeats exactly.
- **Rate policy in isolation:** `computeRevealStep` in `packages/app/src/agent-stream/text-reveal.ts` is pure; `text-reveal.test.ts` covers convergence and burst flattening without a renderer.
- **Per-delta cost on a long timeline:** `npx vitest bench --project unit src/agent-stream/stream-tick.bench.ts` from `packages/app` replays 200 deltas over a 2,000-item timeline through the pure model and layout pipeline, with the default mounted window and with history fully revealed. It measures the JS work per delta, not paint.

Healthy numbers (2026-08, Expo web against a local dev daemon, real Claude Haiku agent, ~8.5s samples during active streaming). Setting `TEXT_REVEAL_HORIZON_MS` to 0 makes the reveal paint on arrival, which is how the baseline column was taken:

|                                  | paint on arrival | paced |
| -------------------------------- | ---------------- | ----- |
| frames that advanced the text    | 6%               | 87%   |
| chars-per-frame CV               | 4.11             | 1.86  |
| gap between visible updates, p50 | 317ms            | 17ms  |
| gap between visible updates, p95 | 383ms            | 17ms  |

Total characters painted is roughly the same either way — the reveal changes when they land, not how many arrive.

Measure the **total** length across every `assistant-message` element, not the last one. A turn emits many assistant messages, so the tail element keeps changing identity and its length is not monotonic; sampling only the tail reads those handovers as resets and reports almost no growth. `sampleStreamFrames` does this correctly.
