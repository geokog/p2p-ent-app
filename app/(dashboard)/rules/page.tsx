"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listRules } from "@/lib/api";
import { queryRuleMetrics } from "@/lib/queries";
import type { Rule } from "@/lib/types";

type RuleMetrics = { hit_rate: number; approval_rate: number };

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [metricsMap, setMetricsMap] = useState<Record<string, RuleMetrics>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    listRules().then(setRules);
  }, []);

  useEffect(() => {
    if (rules.length === 0) return;
    Promise.all(
      rules.map((r) =>
        queryRuleMetrics(r.id).then((m) => [r.id, m] as const),
      ),
    ).then((entries) => {
      setMetricsMap(Object.fromEntries(entries));
    });
  }, [rules]);

  /* CUSTOMIZE: Adjust search/filter fields to match your Rule model. */
  const filtered = useMemo(() => {
    if (!search.trim()) return rules;
    const q = search.toLowerCase();
    return rules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [rules, search]);

  /* CUSTOMIZE: Adjust grouping to match your domain (e.g. by category). */
  const grouped = useMemo(() => {
    const map = new Map<string, Rule[]>();
    for (const rule of filtered) {
      const key = rule.category || "Uncategorized";
      const existing = map.get(key) ?? [];
      existing.push(rule);
      map.set(key, existing);
    }
    return map;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rules</h1>
        <p className="text-muted-foreground">
          Browse and manage business rules for your workflow
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search rules..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Rules grouped by category */}
      {Array.from(grouped.entries()).map(([category, categoryRules]) => (
        <div key={category} className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <BookOpen className="size-4" />
            {category}{" "}
            <Badge variant="secondary" className="text-xs">
              {categoryRules.length}
            </Badge>
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {categoryRules.map((rule) => (
              <Link key={rule.id} href={`/rules/${rule.id}`}>
                <Card className="cursor-pointer transition-shadow hover:shadow-md">
                  <CardContent className="space-y-3 px-5 py-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{rule.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {rule.description}
                        </p>
                      </div>
                      <Badge
                        variant={rule.is_active ? "default" : "secondary"}
                      >
                        {rule.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Category: {rule.category}</span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      {metricsMap[rule.id] && (
                        <>
                          <span className="text-emerald-600">
                            {Math.round(
                              metricsMap[rule.id].approval_rate * 100,
                            )}
                            % approval
                          </span>
                          <span className="text-blue-600">
                            {Math.round(metricsMap[rule.id].hit_rate * 100)}%
                            hit rate
                          </span>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <BookOpen className="mb-3 h-10 w-10" />
          <p className="text-sm">No rules found</p>
        </div>
      )}
    </div>
  );
}
