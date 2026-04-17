"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { format, formatDistanceStrict } from "date-fns";
import {
  ArrowLeft,
  FileText,
  Upload,
  Download,
  Send,
  UserPlus,
  AlertTriangle,
  XCircle,
  CheckCircle,
  Play,
  CircleDot,
  ChevronDown,
  ChevronUp,
  Cpu,
  Zap,
} from "lucide-react";

import {
  getRequestById,
  getUserById,
  getDocumentsForRequest,
  getCommentsForRequest,
  getAuditEventsForRequest,
  getRun,
  getRunEvents,
} from "@/lib/api";
import { DOMAIN } from "@/lib/domain.config";
import { useAuth } from "@/lib/auth-context";
import { canPerformAction } from "@/lib/role-permissions";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { StatusBadge } from "@/components/domain/status-badge";
import { PriorityBadge } from "@/components/domain/priority-badge";
import { TimelineEvent } from "@/components/domain/timeline-event";

import type {
  Request,
  User,
  Document,
  Comment,
  AuditEvent,
  KognitosRun,
  KognitosRunEvent,
} from "@/lib/types";

// ── Helpers ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* CUSTOMIZE: Map statuses to recommended next actions for your workflow. */
function nextAction(status: string): string {
  const actions: Record<string, string> = {
    draft: "Complete and submit the request for review",
    submitted: "Awaiting reviewer assignment",
    under_review: "Reviewer is evaluating — check back for updates",
    approved: "Request approved — proceed with fulfillment",
    rejected: "Request rejected — review feedback and resubmit or close",
    closed: "No further action needed",
  };
  return actions[status] ?? "No action needed";
}

// ── SOP Run Trace Event ─────────────────────────────────────────

function RunTraceEvent({
  event,
  isUpdate,
}: {
  event: KognitosRunEvent;
  isUpdate: boolean;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const hasDetails = event.details && Object.keys(event.details).length > 0;

  return (
    <div className="relative flex gap-3 py-2 pl-0">
      <div className="relative z-10 flex shrink-0 items-center justify-center">
        {isUpdate ? (
          <div className="flex size-[30px] items-center justify-center rounded-full border-2 border-primary bg-background">
            <CircleDot className="size-3.5 text-primary" />
          </div>
        ) : (
          <div className="flex size-[30px] items-center justify-center rounded-full border bg-muted">
            <Play className="size-3 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-sm ${isUpdate ? "font-semibold" : "font-medium"}`}
          >
            {event.description}
          </span>
          <Badge variant="outline" className="text-[10px] capitalize">
            {event.type === "runUpdate" ? "milestone" : "step"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {format(new Date(event.timestamp), "h:mm:ss a")}
        </p>

        {hasDetails && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setDetailOpen((prev) => !prev)}
          >
            {detailOpen ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
            {detailOpen ? "Hide details" : "Show details"}
          </button>
        )}
        {detailOpen && hasDetails && (
          <pre className="mt-1 max-h-48 overflow-auto rounded-md border bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(event.details, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────

export default function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const { user } = useAuth();
  const userRole = user?.role ?? "requester";

  // All hooks declared before any early returns
  const [request, setRequest] = useState<Request | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [requester, setRequester] = useState<User | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [commentAuthors, setCommentAuthors] = useState<Map<string, User>>(
    new Map(),
  );
  const [run, setRun] = useState<KognitosRun | null>(null);
  const [runEvents, setRunEvents] = useState<KognitosRunEvent[]>([]);
  const [traceExpanded, setTraceExpanded] = useState(true);

  function refreshRequest() {
    getRequestById(id).then((r) => {
      if (!r) {
        setNotFound(true);
        return;
      }
      setRequest(r);
      getUserById(r.requester_id).then((u) => setRequester(u ?? null));
      if (r.kognitos_run_id) {
        getRun(r.kognitos_run_id).then((run) => setRun(run ?? null));
        getRunEvents(r.kognitos_run_id).then((res) =>
          setRunEvents(res.runEvents),
        );
      }
    });
    getDocumentsForRequest(id).then(setDocuments);
    getCommentsForRequest(id).then(setComments);
    getAuditEventsForRequest(id).then(setAuditEvents);
  }

  useEffect(() => {
    refreshRequest();
  }, [id]);

  useEffect(() => {
    const handler = () => refreshRequest();
    window.addEventListener("chat-data-changed", handler);
    return () => window.removeEventListener("chat-data-changed", handler);
  }, [id]);

  useEffect(() => {
    if (comments.length === 0) return;
    const uniqueAuthorIds = [...new Set(comments.map((c) => c.author_id))];
    Promise.all(uniqueAuthorIds.map((uid) => getUserById(uid))).then(
      (users) => {
        const map = new Map<string, User>();
        users.forEach((u, i) => {
          if (u) map.set(uniqueAuthorIds[i], u);
        });
        setCommentAuthors(map);
      },
    );
  }, [comments]);

  // ── Early returns ───────────────────────────────────────────

  if (notFound) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <h2 className="text-2xl font-semibold">
          {DOMAIN.entity.singular} not found
        </h2>
        <p className="text-muted-foreground">
          No {DOMAIN.entity.singular.toLowerCase()} exists with ID &ldquo;{id}
          &rdquo;.
        </p>
        <Button asChild variant="outline">
          <Link href="/">
            <ArrowLeft className="size-4" />
            Back to Worklist
          </Link>
        </Button>
      </div>
    );
  }

  if (!request) return null;

  const isTerminal = (
    DOMAIN.terminalStatuses as readonly string[]
  ).includes(request.status);

  const currencyFmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/">
          <ArrowLeft className="size-4" />
          All {DOMAIN.entity.plural}
        </Link>
      </Button>

      <div className="flex flex-col gap-6 xl:flex-row">
        {/* ── Left: Header + Tabs ────────────────────── */}
        <div className="min-w-0 flex-1 space-y-6">
          {/* HEADER CARD */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-xl">{request.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {DOMAIN.entity.singular} {request.id}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={request.status} />
                  <PriorityBadge priority={request.priority} />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Requester */}
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Requester
                  </p>
                  <p className="text-sm font-medium">
                    {requester?.full_name ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {requester?.email}
                  </p>
                </div>

                {/* Category */}
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Category
                  </p>
                  <p className="text-sm font-medium">{request.category}</p>
                </div>

                {/* Estimated Value */}
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Estimated Value
                  </p>
                  <p className="text-sm font-medium">
                    {currencyFmt.format(request.estimated_value)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── TABS ────────────────────────────────── */}
          <Tabs defaultValue="overview">
            <TabsList
              variant="line"
              className="w-full justify-start overflow-x-auto"
            >
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              {request.kognitos_run_id && (
                <TabsTrigger value="sop-run" className="gap-1.5">
                  <Cpu className="size-3.5" />
                  SOP Run
                </TabsTrigger>
              )}
            </TabsList>

            {/* ─── Overview ─── */}
            <TabsContent value="overview" className="mt-4 space-y-6">
              <Card>
                <CardHeader className="pb-0">
                  <CardTitle className="text-base">
                    Recommended Next Action
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {nextAction(request.status)}
                  </p>
                </CardContent>
              </Card>

              {/* CUSTOMIZE: Request details section */}
              <Card>
                <CardHeader className="pb-0">
                  <CardTitle className="text-base">
                    {DOMAIN.entity.singular} Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Description
                      </p>
                      <p className="text-sm">
                        {request.description || "No description provided."}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Category
                      </p>
                      <p className="text-sm">{request.category}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Created
                      </p>
                      <p className="text-sm">
                        {format(
                          new Date(request.created_at),
                          "MMM d, yyyy 'at' h:mm a",
                        )}
                      </p>
                    </div>
                    {request.submitted_at && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Submitted
                        </p>
                        <p className="text-sm">
                          {format(
                            new Date(request.submitted_at),
                            "MMM d, yyyy 'at' h:mm a",
                          )}
                        </p>
                      </div>
                    )}
                    {request.decided_at && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Decided
                        </p>
                        <p className="text-sm">
                          {format(
                            new Date(request.decided_at),
                            "MMM d, yyyy 'at' h:mm a",
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ─── Documents ─── */}
            <TabsContent value="documents" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Documents ({documents.length})
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    alert(
                      "Upload document (mock) — in a real app, this would open a file picker.",
                    )
                  }
                >
                  <Upload className="size-4" />
                  Upload Document
                </Button>
              </div>

              {documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No documents attached.
                </p>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3"
                    >
                      <FileText className="size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {doc.file_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(doc.created_at), "MMM d, yyyy")}{" "}
                          &middot; {formatBytes(doc.size_bytes)}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {doc.document_type.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {doc.source}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ─── Comments ─── */}
            <TabsContent value="comments" className="mt-4 space-y-4">
              <h3 className="text-sm font-semibold">
                Comments ({comments.length})
              </h3>
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No comments yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {[...comments]
                    .sort(
                      (a, b) =>
                        new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime(),
                    )
                    .map((c) => {
                      const author = commentAuthors.get(c.author_id);
                      return (
                        <Card key={c.id}>
                          <CardContent className="space-y-2 pt-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">
                                {author?.full_name ?? c.author_id}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {format(
                                  new Date(c.created_at),
                                  "MMM d, yyyy 'at' h:mm a",
                                )}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {c.content}
                            </p>
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              )}
            </TabsContent>

            {/* ─── Timeline ─── */}
            <TabsContent value="timeline" className="mt-4 space-y-4">
              <h3 className="text-sm font-semibold">
                Audit Timeline ({auditEvents.length})
              </h3>
              {auditEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No events recorded.
                </p>
              ) : (
                <div className="pl-1">
                  {[...auditEvents]
                    .sort(
                      (a, b) =>
                        new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime(),
                    )
                    .map((event) => (
                      <TimelineEvent key={event.id} event={event} />
                    ))}
                </div>
              )}
            </TabsContent>

            {/* ─── SOP Run ─── */}
            {request.kognitos_run_id && (
              <TabsContent value="sop-run" className="mt-4 space-y-6">
                {!run ? (
                  <p className="text-sm text-muted-foreground">
                    Loading run data…
                  </p>
                ) : (
                  <>
                    {/* Run Summary */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Play className="size-4 text-primary" />
                          Run Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="space-y-1">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                              Status
                            </p>
                            <Badge
                              variant={
                                run.state.completed
                                  ? "default"
                                  : run.state.failed
                                    ? "destructive"
                                    : run.state.awaitingGuidance
                                      ? "warning"
                                      : "secondary"
                              }
                            >
                              {run.state.completed
                                ? "Completed"
                                : run.state.failed
                                  ? "Failed"
                                  : run.state.awaitingGuidance
                                    ? "Awaiting Guidance"
                                    : "Executing"}
                            </Badge>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                              Duration
                            </p>
                            <p className="text-sm font-medium">
                              {formatDistanceStrict(
                                new Date(run.updateTime),
                                new Date(run.createTime),
                              )}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                              Stage Version
                            </p>
                            <p className="font-mono text-sm font-medium">
                              {run.stageVersion}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                              Run ID
                            </p>
                            <p className="truncate font-mono text-sm text-muted-foreground">
                              {run.name.split("/").pop()}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                          <span>
                            Started{" "}
                            {format(
                              new Date(run.createTime),
                              "MMM d, yyyy h:mm a",
                            )}
                          </span>
                          <span>
                            Last updated{" "}
                            {format(
                              new Date(run.updateTime),
                              "MMM d, yyyy h:mm a",
                            )}
                          </span>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Inputs */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Upload className="size-4 text-blue-500" />
                          Inputs
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {Object.entries(run.userInputs).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="flex items-start gap-3 rounded-lg border p-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                    {key.replace(/_/g, " ")}
                                  </p>
                                  <p className="mt-0.5 font-mono text-sm font-medium">
                                    {String(value)}
                                  </p>
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Outputs */}
                    {run.state.completed?.outputs && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Download className="size-4 text-emerald-500" />
                            Outputs
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {Object.entries(
                              run.state.completed.outputs,
                            ).map(([key, value]) => (
                              <div
                                key={key}
                                className="rounded-lg border bg-muted/30 p-2.5"
                              >
                                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                  {key.replace(/_/g, " ")}
                                </p>
                                <p className="mt-0.5 font-mono text-sm font-medium">
                                  {String(value ?? "—")}
                                </p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Execution Trace */}
                    <Card>
                      <CardHeader className="pb-2">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between"
                          onClick={() => setTraceExpanded((prev) => !prev)}
                        >
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Zap className="size-4 text-amber-500" />
                            Execution Trace ({runEvents.length} events)
                          </CardTitle>
                          {traceExpanded ? (
                            <ChevronUp className="size-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="size-4 text-muted-foreground" />
                          )}
                        </button>
                      </CardHeader>
                      {traceExpanded && (
                        <CardContent>
                          {runEvents.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No execution events recorded.
                            </p>
                          ) : (
                            <div className="relative space-y-0">
                              <div className="absolute bottom-2 left-[15px] top-2 w-px bg-border" />
                              {[...runEvents]
                                .sort(
                                  (a, b) =>
                                    new Date(a.timestamp).getTime() -
                                    new Date(b.timestamp).getTime(),
                                )
                                .map((event, idx) => (
                                  <RunTraceEvent
                                    key={`${event.runId}-${event.type}-${idx}`}
                                    event={event}
                                    isUpdate={event.type === "runUpdate"}
                                  />
                                ))}
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  </>
                )}
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* ── Right: Action Sidebar ────────────────── */}
        <div className="w-full shrink-0 xl:w-64">
          <Card className="sticky top-20">
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* CUSTOMIZE: Adjust actions to match your workflow. */}
              {canPerformAction(userRole, "approve") && (
                <Button
                  className="w-full justify-start"
                  disabled={isTerminal}
                  onClick={() => {
                    const now = new Date().toISOString();
                    setRequest({
                      ...request,
                      status: "approved",
                      decided_at: now,
                    });
                    alert(`${DOMAIN.entity.singular} approved`);
                  }}
                >
                  <CheckCircle className="size-4" />
                  Approve
                </Button>
              )}
              {canPerformAction(userRole, "reject") && (
                <Button
                  variant="destructive"
                  className="w-full justify-start"
                  disabled={isTerminal}
                  onClick={() => {
                    const now = new Date().toISOString();
                    setRequest({
                      ...request,
                      status: "rejected",
                      decided_at: now,
                    });
                    alert(`${DOMAIN.entity.singular} rejected`);
                  }}
                >
                  <XCircle className="size-4" />
                  Reject
                </Button>
              )}
              {canPerformAction(userRole, "submit") && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  disabled={isTerminal || request.status !== "draft"}
                  onClick={() => {
                    const now = new Date().toISOString();
                    setRequest({
                      ...request,
                      status: "submitted",
                      submitted_at: now,
                    });
                    alert(`${DOMAIN.entity.singular} submitted for review`);
                  }}
                >
                  <Send className="size-4" />
                  Submit
                </Button>
              )}
              {canPerformAction(userRole, "assign") && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  disabled={isTerminal}
                  onClick={() => {
                    const assignee = window.prompt(
                      "Enter user ID to assign:",
                      request.assigned_to ?? "",
                    );
                    if (assignee != null && assignee.trim()) {
                      setRequest({ ...request, assigned_to: assignee.trim() });
                      alert(`Assigned to ${assignee.trim()}`);
                    }
                  }}
                >
                  <UserPlus className="size-4" />
                  Assign
                </Button>
              )}
              {canPerformAction(userRole, "escalate") && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  disabled={isTerminal}
                  onClick={() => {
                    setRequest({ ...request, priority: "urgent" });
                    alert(`${DOMAIN.entity.singular} escalated to urgent`);
                  }}
                >
                  <AlertTriangle className="size-4" />
                  Escalate
                </Button>
              )}

              {/* Close */}
              {canPerformAction(userRole, "approve") && (
                <>
                  <Separator />
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-destructive hover:text-destructive"
                    disabled={isTerminal}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Are you sure you want to close this ${DOMAIN.entity.singular.toLowerCase()}?`,
                        )
                      ) {
                        const now = new Date().toISOString();
                        setRequest({
                          ...request,
                          status: "closed",
                          closed_at: now,
                        });
                        alert(`${DOMAIN.entity.singular} closed`);
                      }
                    }}
                  >
                    <XCircle className="size-4" />
                    Close
                  </Button>
                </>
              )}

              {/* Quick info */}
              <Separator />
              <div className="space-y-2 pt-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Created</span>
                  <span>
                    {format(new Date(request.created_at), "MMM d, yyyy")}
                  </span>
                </div>
                {request.submitted_at && (
                  <div className="flex justify-between">
                    <span>Submitted</span>
                    <span>
                      {format(new Date(request.submitted_at), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
                {request.decided_at && (
                  <div className="flex justify-between">
                    <span>Decided</span>
                    <span>
                      {format(new Date(request.decided_at), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Est. Value</span>
                  <span className="font-medium text-foreground">
                    {currencyFmt.format(request.estimated_value)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
