"use client";

import { useRouter } from "next/navigation";
import { KognitosAutomationPickerDialog } from "@/components/kognitos/kognitos-automation-picker-dialog";

export default function KognitosOnboardingPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6">
      <KognitosAutomationPickerDialog
        mode="onboarding"
        open
        blocking
        title="Register Kognitos automations"
        onCompleted={() => {
          router.replace("/");
          router.refresh();
        }}
      />
      <p className="mt-8 max-w-md text-center text-sm text-muted-foreground">
        Select which workspace automations this app should sync and display. This
        step is required once before using Kognitos data.
      </p>
    </div>
  );
}
