"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DOMAIN } from "@/lib/domain.config";
import { getNotificationsForUser } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Notification } from "@/lib/types";

export default function NotificationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user) return;

    function load() {
      getNotificationsForUser(user!.id).then((data) =>
        setItems(
          [...data].sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          ),
        ),
      );
    }

    load();

    const onDataChanged = () => load();
    window.addEventListener("chat-data-changed", onDataChanged);
    return () => window.removeEventListener("chat-data-changed", onDataChanged);
  }, [user]);

  const unreadCount = useMemo(
    () => items.filter((n) => !n.is_read).length,
    [items],
  );

  function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  function markRead(id: string) {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          {unreadCount > 0 && (
            <Badge className="bg-blue-600 text-white">
              {unreadCount} unread
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={markAllRead}
            className="gap-2"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all as read
          </Button>
        )}
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-2 pt-4">
          <NotificationList items={items} onMarkRead={markRead} />
        </TabsContent>

        <TabsContent value="unread" className="space-y-2 pt-4">
          <NotificationList
            items={items.filter((n) => !n.is_read)}
            onMarkRead={markRead}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NotificationList({
  items,
  onMarkRead,
}: {
  items: Notification[];
  onMarkRead: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Bell className="mb-3 h-10 w-10" />
        <p className="text-sm">No notifications</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((n) => (
        <Card
          key={n.id}
          className={`cursor-pointer transition-colors hover:bg-muted/50 ${!n.is_read ? "border-l-4 border-l-blue-500" : ""}`}
          onClick={() => onMarkRead(n.id)}
        >
          <CardContent className="flex items-start gap-4 px-5 py-4">
            <div
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${!n.is_read ? "bg-blue-500" : "bg-transparent"}`}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`text-sm ${!n.is_read ? "font-semibold" : "font-medium"}`}
                >
                  {n.message}
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(n.created_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
              {n.request_id && (
                <Link
                  href={`/${DOMAIN.entitySlug}/${n.request_id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  View {DOMAIN.entity.singular.toLowerCase()}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
