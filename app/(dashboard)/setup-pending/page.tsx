"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SetupPendingPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>Setup required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            This app has not been connected to Kognitos automations yet. An
            organization admin must sign in and complete the one-time automation
            registration.
          </p>
          <p>
            Ask your admin to open the app and finish onboarding. You can leave
            this page and try again later.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
