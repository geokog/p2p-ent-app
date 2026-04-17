"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type NonAdminKognitosVariant = "no_automation" | "needs_sync";

type Props = {
  variant: NonAdminKognitosVariant;
  onRecheck: () => void;
};

/**
 * Full-screen gate for non-admins until an admin finishes Kognitos setup or
 * initial sync (e.g. env automation without metadata).
 */
export function NonAdminKognitosSetupBlocking({ variant, onRecheck }: Props) {
  const { logout } = useAuth();
  const router = useRouter();

  function handleSignOut() {
    logout();
    router.push("/login");
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-lg border-border/80 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Setup required</CardTitle>
          <CardDescription>
            {variant === "needs_sync"
              ? "An administrator must connect this app to Kognitos and run a data refresh before you can continue."
              : "This app must be connected to Kognitos automations before you can use it."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          {variant === "needs_sync" ? (
            <>
              <p>
                An automation is configured on the server, but run data has not
                been imported yet. Please ask an organization admin to sign in and
                complete the refresh step, then try again.
              </p>
              <p>
                If you are an admin, sign out and log back in with an admin
                account.
              </p>
            </>
          ) : (
            <>
              <p>
                An organization admin must sign in once and register which
                workspace automations this app should use.
              </p>
              <p>
                Ask your admin to open the app and finish onboarding. You can
                check again after they have completed setup.
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onRecheck}>
              Check again
            </Button>
            <Button type="button" variant="default" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
