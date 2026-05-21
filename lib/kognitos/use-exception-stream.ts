"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  mapStreamEventLine,
  type ExceptionEventDto,
} from "./exception-view-model";

/**
 * Real streaming for the exception resolution thread.
 *
 * Mirrors the bumblebee `useStreamingStreamEvents` + `useQuillThreadMessages`
 * pattern (`/tmp/bumblebee/src/shared/hooks/useRunChat.tsx`):
 *   - Fetches `/api/kognitos/exceptions/[id]/stream` as NDJSON.
 *   - Parses each line into an `ExceptionEventDto` and buffers them in a
 *     ref; a `requestAnimationFrame` callback flushes the buffer to the
 *     subscriber so React re-renders at most once per frame.
 *   - On stream failure, retries with exponential backoff (600ms × 2^n) up
 *     to `STREAM_RETRY_MAX_ATTEMPTS` and reports the final state to the
 *     caller, which can fall back to its existing polling implementation.
 *   - `start(id)` and `stop()` are idempotent and safe to call from React
 *     handlers (the hook guards re-entrancy via a monotonically increasing
 *     run id).
 *
 * Per-turn auto-close (opt-in via `closeOnCompletion`):
 *   Kognitos `StreamEvents` keeps the HTTP body open for the entire chat
 *   session, not per agent turn. To free the upstream socket after each turn
 *   (and stay clear of Vercel function timeouts on idle threads), the hook
 *   can watch for a `completion_response` event with `STATE_COMPLETE` and
 *   then close the stream after a brief grace window. Trailing events
 *   (e.g. `<related_outputs>` snapshots, late `tool_call_result` pairings,
 *   guide-entry creates) reset the grace timer so we don't drop them. Before
 *   actually closing, the hook checks the caller-supplied `isClosable()`
 *   predicate so messages stuck in `STATE_STREAMING` or unmatched tool calls
 *   keep the stream alive.
 */

const STREAM_RETRY_MAX_ATTEMPTS = 3;
const STREAM_RETRY_BASE_MS = 600;
const DEFAULT_CLOSE_GRACE_MS = 4000;
/** Recheck cadence when grace fires but `isClosable()` returns false. */
const CLOSE_RECHECK_INTERVAL_MS = 1000;

export type ExceptionStreamStatus =
  | "idle"
  | "connecting"
  | "open"
  | "retrying"
  | "fallback"
  | "closed";

export type ExceptionStreamStartOptions = {
  /**
   * Event ids the caller already has from the snapshot/poll bundle. The hook
   * uses these to distinguish history-replay events (re-emitted by Kognitos
   * on every connect) from genuinely new events for the auto-close machine.
   * Without this seed the close machine would arm on the prior turn's
   * STATE_COMPLETE replayed during connect and shut the stream down before
   * the agent's next reply could arrive.
   */
  seedEventIds?: Iterable<string>;
};

export type ExceptionStreamHook = {
  status: ExceptionStreamStatus;
  /** Last stream error message, when in `retrying` or `fallback` state. */
  error: string | null;
  /** Current Kognitos agent id (set when the stream connects successfully). */
  agentId: string | null;
  /** Begin streaming for `exceptionId`. Cancels any in-flight stream first. */
  start: (exceptionId: string, options?: ExceptionStreamStartOptions) => void;
  /** Stop streaming and reset to `idle`. */
  stop: () => void;
};

export type UseExceptionStreamArgs = {
  /** Called for each event parsed from the NDJSON stream (RAF-batched). */
  onEvents: (events: ExceptionEventDto[]) => void;
  /** Called when the stream closes cleanly (no further events expected). */
  onClose?: () => void;
  /** Called when all retry attempts fail; caller should switch to polling. */
  onFallback?: (lastError: string) => void;
  /**
   * When true, auto-close the stream after a `STATE_COMPLETE` completion
   * event, once `isClosable()` returns true and the grace window has elapsed
   * without further events. The next call to `start()` will reopen.
   */
  closeOnCompletion?: boolean;
  /**
   * Predicate consulted before auto-closing. Should return true only when no
   * streaming work remains client-side (no `STATE_STREAMING` messages, no
   * unmatched tool-call requests). Re-evaluated each grace tick when the
   * stream is candidate for close. Must be cheap to call.
   */
  isClosable?: () => boolean;
  /**
   * Quiescence window after a completion before we attempt to close (ms).
   * Any event arriving during this window resets the timer. Defaults to
   * {@link DEFAULT_CLOSE_GRACE_MS}.
   */
  closeGraceMs?: number;
};

/**
 * NDJSON line parser. Yields a parsed JSON object per `\n`-terminated line.
 * Holds a partial trailing chunk between calls.
 */
function createNdjsonParser(): {
  push: (chunk: string) => Record<string, unknown>[];
  flush: () => Record<string, unknown>[];
} {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      const out: Record<string, unknown>[] = [];
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            out.push(JSON.parse(line) as Record<string, unknown>);
          } catch {
            /* ignore malformed line */
          }
        }
        nl = buffer.indexOf("\n");
      }
      return out;
    },
    flush() {
      const trimmed = buffer.trim();
      buffer = "";
      if (!trimmed) return [];
      try {
        return [JSON.parse(trimmed) as Record<string, unknown>];
      } catch {
        return [];
      }
    },
  };
}

export function useExceptionStream(
  args: UseExceptionStreamArgs,
): ExceptionStreamHook {
  const {
    onEvents,
    onClose,
    onFallback,
    closeOnCompletion = false,
    isClosable,
    closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
  } = args;
  const onEventsRef = useRef(onEvents);
  const onCloseRef = useRef(onClose);
  const onFallbackRef = useRef(onFallback);
  const isClosableRef = useRef(isClosable);
  const closeOnCompletionRef = useRef(closeOnCompletion);
  const closeGraceMsRef = useRef(closeGraceMs);
  useEffect(() => {
    onEventsRef.current = onEvents;
  }, [onEvents]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);
  useEffect(() => {
    isClosableRef.current = isClosable;
  }, [isClosable]);
  useEffect(() => {
    closeOnCompletionRef.current = closeOnCompletion;
  }, [closeOnCompletion]);
  useEffect(() => {
    closeGraceMsRef.current = closeGraceMs;
  }, [closeGraceMs]);

  const [status, setStatus] = useState<ExceptionStreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);

  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<ExceptionEventDto[]>([]);
  const rafRef = useRef<number | null>(null);

  /**
   * Per-turn close machine state. Lives in refs so resetting/scheduling
   * timers from the hot stream-read path doesn't trigger React re-renders.
   *   - `sawCompletion`: true once we've seen a NEW STATE_COMPLETE completion
   *     (one whose id wasn't in the seed/seen set — see `seenIdsRef`).
   *   - `graceTimer`: setTimeout handle for the quiescence window.
   *   - `recheckTimer`: setTimeout handle for the post-grace `isClosable`
   *     re-check loop (used when grace fires but client work is still in
   *     flight, e.g. an unmatched tool_call_result).
   *   - `closeRunId`: the `runIdRef.current` value the timer was scheduled
   *     under, so a timer fired after `start()` reset everything is a no-op.
   */
  const closeStateRef = useRef<{
    sawCompletion: boolean;
    graceTimer: ReturnType<typeof setTimeout> | null;
    recheckTimer: ReturnType<typeof setTimeout> | null;
    closeRunId: number;
  }>({
    sawCompletion: false,
    graceTimer: null,
    recheckTimer: null,
    closeRunId: 0,
  });

  /**
   * Event ids we've already observed for this stream lifecycle. Seeded on
   * `start()` from the caller's bundle/snapshot so Kognitos's history replay
   * (which re-emits every event on every connect) doesn't trip the close
   * machine. Augmented with each new event id we see on the wire so a
   * trailing duplicate (e.g. an updated STATE_STREAMING → STATE_COMPLETE
   * pair using the same event id) is also classified correctly.
   */
  const seenIdsRef = useRef<Set<string>>(new Set());

  /**
   * The exception id of the most recent `start()` call. Used to decide
   * whether to clear `seenIdsRef` on the next `start()`: switching exceptions
   * means a fresh history; restarting the same exception (e.g. after the
   * close-machine fired) must keep the accumulated ids so the inevitable
   * history-replay isn't re-classified as new.
   */
  const lastStartIdRef = useRef<string | null>(null);

  const clearCloseTimers = useCallback(() => {
    const cs = closeStateRef.current;
    if (cs.graceTimer !== null) {
      clearTimeout(cs.graceTimer);
      cs.graceTimer = null;
    }
    if (cs.recheckTimer !== null) {
      clearTimeout(cs.recheckTimer);
      cs.recheckTimer = null;
    }
  }, []);

  const resetCloseState = useCallback(() => {
    clearCloseTimers();
    closeStateRef.current.sawCompletion = false;
    closeStateRef.current.closeRunId = runIdRef.current;
  }, [clearCloseTimers]);

  // Internal cleanup that does NOT touch the close-state ref. Used by
  // `maybeCloseAfterGrace` because the close-state was already advanced.
  // Defined early so the close-machine callbacks below can depend on it.
  const cleanupNoCloseReset = useCallback(() => {
    if (rafRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = [];
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        /* ignore */
      }
      abortRef.current = null;
    }
  }, []);

  const maybeCloseAfterGrace = useCallback(() => {
    const cs = closeStateRef.current;
    const closable = isClosableRef.current
      ? Boolean(isClosableRef.current())
      : true;
    if (!closable) {
      // Some client-side work still pending (e.g. tool_call_result
      // hasn't paired with its request yet). Recheck shortly; trailing
      // events arriving in the meantime will reset via observeBatchForClose.
      const myRun = cs.closeRunId;
      cs.recheckTimer = setTimeout(() => {
        if (myRun !== runIdRef.current) return;
        cs.recheckTimer = null;
        maybeCloseAfterGrace();
      }, CLOSE_RECHECK_INTERVAL_MS);
      return;
    }
    // Quiet enough to close.
    runIdRef.current += 1;
    cleanupNoCloseReset();
    setStatus("closed");
    onCloseRef.current?.();
  }, [cleanupNoCloseReset]);

  const armGraceTimer = useCallback(() => {
    const cs = closeStateRef.current;
    if (cs.graceTimer !== null) clearTimeout(cs.graceTimer);
    if (cs.recheckTimer !== null) {
      clearTimeout(cs.recheckTimer);
      cs.recheckTimer = null;
    }
    const myRun = cs.closeRunId;
    cs.graceTimer = setTimeout(() => {
      if (myRun !== runIdRef.current) return;
      cs.graceTimer = null;
      maybeCloseAfterGrace();
    }, closeGraceMsRef.current);
  }, [maybeCloseAfterGrace]);

  /**
   * Inspect a flushed batch to drive the auto-close machine.
   *
   * Critical: Kognitos's `events:stream` REPLAYS the entire event history
   * on every connect. Without filtering, the prior turn's STATE_COMPLETE
   * `completion_response` would re-arrive on each reconnect and trip the
   * close machine before any new agent activity happens. We therefore
   * dedup against `seenIdsRef`, seeded by the caller from the snapshot
   * (and augmented as live events flow). Only events that are NEW for
   * this hook lifecycle count toward close detection.
   *
   *   - First NEW STATE_COMPLETE `completion_response` → arm grace timer.
   *   - Any further NEW event during grace → reset grace timer.
   *   - Grace fires → call `isClosable()`; close on true, else recheck.
   *
   * STREAMING→COMPLETE event pairs (same id, two states) are handled by
   * adding ids to the seen set only when state is STATE_COMPLETE — so the
   * partial STATE_STREAMING does not poison the dedup against its eventual
   * STATE_COMPLETE companion.
   */
  const observeBatchForClose = useCallback(
    (batch: ExceptionEventDto[]) => {
      const cs = closeStateRef.current;
      const seen = seenIdsRef.current;

      let sawNewCompletion = false;
      let sawNewOther = false;
      for (const evt of batch) {
        const isReplay = !!evt.id && seen.has(evt.id);
        // Track the id only on COMPLETE so a STREAMING→COMPLETE pair using
        // the same id isn't misclassified (otherwise the STREAMING tick
        // would seed the id and the COMPLETE follow-up would look like a
        // replay).
        if (evt.id && evt.state === "STATE_COMPLETE") seen.add(evt.id);

        if (isReplay) continue;
        if (
          evt.kind === "completion" &&
          evt.state === "STATE_COMPLETE" &&
          !evt.completionError
        ) {
          sawNewCompletion = true;
        } else {
          sawNewOther = true;
        }
      }

      if (!cs.sawCompletion && !sawNewCompletion) return;

      if (sawNewCompletion) {
        cs.sawCompletion = true;
      }
      // Any NEW event (completion or trailing) extends the grace window.
      if (sawNewCompletion || sawNewOther) {
        cs.closeRunId = runIdRef.current;
        armGraceTimer();
      }
    },
    [armGraceTimer],
  );

  const flushPending = useCallback(() => {
    rafRef.current = null;
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    onEventsRef.current(batch);
    if (closeOnCompletionRef.current) {
      observeBatchForClose(batch);
    }
  }, [observeBatchForClose]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    if (typeof window === "undefined") {
      // SSR safety: flush synchronously
      flushPending();
      return;
    }
    rafRef.current = window.requestAnimationFrame(flushPending);
  }, [flushPending]);

  const cleanup = useCallback(() => {
    cleanupNoCloseReset();
    clearCloseTimers();
    closeStateRef.current.sawCompletion = false;
  }, [cleanupNoCloseReset, clearCloseTimers]);

  const stop = useCallback(() => {
    runIdRef.current += 1;
    cleanup();
    // Explicit user stop wipes dedup state too; the next `start()` will
    // re-seed from a fresh snapshot.
    seenIdsRef.current = new Set();
    lastStartIdRef.current = null;
    setStatus("closed");
  }, [cleanup]);

  const start = useCallback(
    (exceptionId: string, options?: ExceptionStreamStartOptions) => {
      cleanup();
      const myRun = ++runIdRef.current;
      // New stream → reset close machine so a stale grace timer from a prior
      // turn doesn't fire against this run.
      resetCloseState();
      const id = exceptionId.trim();
      // Switching exceptions wipes the dedup set — different conversation,
      // different event ids. Restarting the same exception (e.g. the close
      // machine just fired and we're reconnecting) keeps the set so the
      // imminent history-replay is correctly classified as already-seen.
      if (lastStartIdRef.current !== id) {
        seenIdsRef.current = new Set();
        lastStartIdRef.current = id || null;
      }
      // Always merge in the caller-provided seed ids (additive). The page
      // typically passes ids from `bundle.events`; passing more is safe and
      // strictly improves dedup.
      if (options?.seedEventIds) {
        for (const sid of options.seedEventIds) {
          if (sid) seenIdsRef.current.add(sid);
        }
      }
      if (!id) {
        setStatus("idle");
        return;
      }
      setError(null);
      setStatus("connecting");

      void (async () => {
        let attempt = 0;
        let lastErr = "";

        while (attempt < STREAM_RETRY_MAX_ATTEMPTS) {
          if (runIdRef.current !== myRun) return;

          const ctrl = new AbortController();
          abortRef.current = ctrl;
          try {
            const res = await fetch(
              `/api/kognitos/exceptions/${encodeURIComponent(id)}/stream`,
              {
                method: "GET",
                signal: ctrl.signal,
                cache: "no-store",
                headers: { Accept: "application/x-ndjson" },
              },
            );
            if (runIdRef.current !== myRun) return;
            if (!res.ok || !res.body) {
              lastErr = `stream_http_${res.status}`;
              attempt += 1;
              setStatus(attempt < STREAM_RETRY_MAX_ATTEMPTS ? "retrying" : "fallback");
              setError(lastErr);
              if (attempt >= STREAM_RETRY_MAX_ATTEMPTS) break;
              await delay(STREAM_RETRY_BASE_MS * 2 ** (attempt - 1));
              continue;
            }
            const headerAgent = res.headers.get("X-Kognitos-Agent-Id");
            if (headerAgent) setAgentId(headerAgent);
            setStatus("open");

            const parser = createNdjsonParser();
            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            try {
              while (true) {
                if (runIdRef.current !== myRun) return;
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                const objs = parser.push(chunk);
                if (objs.length) {
                  for (const obj of objs) {
                    const evt = mapStreamEventLine(obj);
                    if (evt) pendingRef.current.push(evt);
                  }
                  scheduleFlush();
                }
              }
              const tail = parser.flush();
              for (const obj of tail) {
                const evt = mapStreamEventLine(obj);
                if (evt) pendingRef.current.push(evt);
              }
              if (pendingRef.current.length) scheduleFlush();
            } finally {
              try {
                reader.releaseLock();
              } catch {
                /* ignore */
              }
            }
            // Stream ended cleanly.
            if (runIdRef.current !== myRun) return;
            setStatus("closed");
            onCloseRef.current?.();
            return;
          } catch (e) {
            if (runIdRef.current !== myRun) return;
            if (ctrl.signal.aborted) {
              setStatus("closed");
              return;
            }
            lastErr = e instanceof Error ? e.message : "stream_failed";
            attempt += 1;
            setStatus(attempt < STREAM_RETRY_MAX_ATTEMPTS ? "retrying" : "fallback");
            setError(lastErr);
            if (attempt >= STREAM_RETRY_MAX_ATTEMPTS) break;
            await delay(STREAM_RETRY_BASE_MS * 2 ** (attempt - 1));
          } finally {
            abortRef.current = null;
          }
        }

        if (runIdRef.current !== myRun) return;
        onFallbackRef.current?.(lastErr || "stream_failed");
      })();
    },
    [cleanup, resetCloseState, scheduleFlush],
  );

  // Stop the stream when the component unmounts.
  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      cleanup();
    };
  }, [cleanup]);

  return { status, error, agentId, start, stop };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
