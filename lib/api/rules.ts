/**
 * API functions for Rules.
 *
 * CUSTOMIZE: Add filtering, pagination, or rule-evaluation helpers.
 */

import type { Rule } from "@/lib/types";
import { getAllRules, getRuleById as _getRuleById } from "@/lib/db";

export async function listRules(): Promise<Rule[]> {
  return getAllRules();
}

export async function getRuleById(id: string): Promise<Rule | undefined> {
  return _getRuleById(id);
}
