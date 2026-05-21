# Kognitos API Integration Notes

Use this checklist when adding or debugging Kognitos API calls in this app.

## Start From OpenAPI

Before constructing a Kognitos URL, check `lib/kognitos/openapi.yaml` and identify:

- The documented endpoint path.
- Every required path parameter.
- The source of each parameter in this app.

Do not use undocumented endpoint shapes as the primary path unless live diagnostics confirm that the deployed Kognitos API supports them.

## Agent Event APIs

Kognitos event conversation APIs are agent-scoped in the OpenAPI:

```text
GET  /automations/{automation_id}/runs/{run_id}/agents/{agent_id}/events
POST /automations/{automation_id}/runs/{run_id}/agents/{agent_id}/events
```

That means exception guidance features require a reliable `agent_id`.

For this app, configure it explicitly:

```env
KOGNITOS_EXCEPTION_AGENT_ID=astral
```

Do not assume `assignee`, `resolver`, or `exceptionId` is the same as `agent_id`. If the payload does not reliably provide `agent_id`, treat it as app configuration.

## 403 Debugging

A Kognitos `403` is not always a bad credential. Validate these before changing auth behavior:

- The endpoint path matches OpenAPI or a confirmed live API path.
- All path parameters are sourced from the correct raw fields.
- The call is using the expected org, workspace, automation, run, and agent ids.
- The credential has permission for that specific resource scope.

Dev diagnostics may log id sources and credential type (`PAT` vs `API_KEY`), but must never log credential values.

## Adapter Boundary

Keep Kognitos URL construction and credential behavior inside `lib/kognitos/**`. UI routes should call those adapters rather than building Kognitos URLs directly.

## Chat / Streaming Pitfalls

These bit us on the v2 exception page and cost real debugging time. See
`.cursor/rules/kognitos-chat-integration.mdc` for code-level patterns.

### SSE is best-effort — always pair with post-reply polling

`GET /events:stream` is fast but lossy. After `POST /reply`, do not assume
the agent's reply will arrive on the open stream — sometimes it does, often
it doesn't (especially in dev / under load / after auto-close).

A single `setTimeout(loadDetail, 1500)` is **not enough**. Kognitos agents
typically respond 5–15s after the reply, well after that single reload.

Use a polling loop on the bundle that:

- Warms up ~1.5s.
- Re-fetches `/exceptions/{id}` every ~2.5s.
- Stops 8s after the bundle stops changing (settled), or after 50s (cap).
- Is cancellable via a monotonic run-id ref so row switches and unmounts
  don't keep refetching.

Reference implementation: `app/(dashboard)/exception-handling/page.tsx`
(`GUIDANCE_POST_REPLY_*` constants and the loop in `sendReplyMessage`).

### `useExceptionStream` needs a real `isClosable` predicate

The hook's `closeOnCompletion: true` mode auto-closes after the first new
`completion` event + a grace window. If you pass `isClosable: () => true`,
the SSE socket will be aborted while the agent's text reply is still being
delivered through `onEvents`. The bundle has it; your `streamMessages`
won't.

Defer close while client-side merge work is still pending:

```ts
isClosable: () => {
  const ms = chatMessagesRef.current; // sync from `messages` useMemo via useEffect
  return !ms.some((m) =>
    m.isStreaming || (m.kind === "tool-call" && m.result === undefined),
  );
}
```

Read from a `ref`, not closed-over state — the predicate fires from a
`setTimeout` and would otherwise see stale data.

### Document widgets need an href fallback

`ChatDocumentPreviewData.url` is rarely populated by `collectDocumentWidgets`
in `lib/kognitos/chat-event-reducer.ts` — Kognitos attachments arrive as
`fileId`. If the UI only renders `<a href={data.url}>`, the card is dead.

Always compute href as `data.url ?? /api/kognitos/files/{encodeURIComponent(data.fileId)}`,
and (for popup-style UX) prefer `window.open(href, "_blank", "popup=yes,width=...")`
over `<a target="_blank">` so users get a sized window with a fallback to
a regular new tab when popups are blocked.
