"use client";

import { useEffect, useState } from "react";

/**
 * Rotating "still working — fact: …" insights when the agent goes silent
 * for an extended period. Mirrors `useBuilderProgress` +
 * `INSIGHT_TICKER_MESSAGES` constants verbatim from
 * `/tmp/bumblebee/src/modules/automation-run/constants/builder-progress-messages.ts`
 * (10s silence threshold, 6s rotation, 30s deepen interval).
 */

const INSIGHT_TICKER_MESSAGES: readonly string[] = [
  "Reviewing the exception details so the next step is grounded in the run context.",
  "Cross-referencing the run inputs against the resolution playbook.",
  "Checking if any related document fields are missing or ambiguous.",
  "Comparing the requested action with prior successful resolutions.",
  "Validating field types and constraints before drafting a response.",
  "Considering whether to ask a clarifying question or propose a fix.",
  "Looking for the most efficient path that does not interrupt downstream automation.",
  "Drafting a guidance candidate; refining tone and concrete instructions.",
];

export const BUILDER_PROGRESS_SILENCE_MS = 10_000;
export const BUILDER_PROGRESS_ROTATION_MS = 6_000;

export type BuilderProgressArgs = {
  /** Whether the agent is actively processing — when `false`, the hook is dormant. */
  isActive: boolean;
  /**
   * Timestamp (in ms) of the last "real" event (text/thinking/tool). When this
   * value advances, the silence window restarts.
   */
  lastEventAt: number;
};

export type BuilderProgressState = {
  /** Insight string to render, or `null` while we're inside the silence window. */
  insight: string | null;
};

export function useBuilderProgress(args: BuilderProgressArgs): BuilderProgressState {
  const { isActive, lastEventAt } = args;
  const [now, setNow] = useState(() => Date.now());
  const [tickerIndex, setTickerIndex] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const t = window.setInterval(
      () =>
        setTickerIndex(
          (i) => (i + 1) % INSIGHT_TICKER_MESSAGES.length,
        ),
      BUILDER_PROGRESS_ROTATION_MS,
    );
    return () => window.clearInterval(t);
  }, [isActive]);

  if (!isActive) return { insight: null };
  if (now - lastEventAt < BUILDER_PROGRESS_SILENCE_MS) return { insight: null };
  return { insight: INSIGHT_TICKER_MESSAGES[tickerIndex] ?? null };
}
