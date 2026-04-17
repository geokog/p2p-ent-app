"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  BarChart3,
  BookOpen,
  Bell,
  Settings,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { DOMAIN } from "@/lib/domain.config";
import { getDefaultPath } from "@/lib/role-permissions";
import type { UserRole } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ICON_MAP: Record<string, LucideIcon> = {
  ClipboardList,
  BarChart3,
  BookOpen,
  Bell,
  Settings,
  Layers,
};

const LogoIcon = ICON_MAP[DOMAIN.appLogo] ?? Layers;

export default function LoginPage() {
  const [selectedRole, setSelectedRole] = useState<string>("");
  const { login } = useAuth();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    login(selectedRole as UserRole);
    router.push(getDefaultPath(selectedRole));
  }

  return (
    <div className="w-full max-w-sm">
      <Card className="shadow-lg border-0 shadow-black/5">
        <CardHeader className="items-center pb-2 pt-8">
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-brand text-primary-foreground">
            <LogoIcon className="size-6" />
          </div>
          <CardTitle className="text-xl tracking-tight">
            {DOMAIN.appName}
          </CardTitle>
          <CardDescription className="text-center">
            Sign in to {DOMAIN.appDescription.toLowerCase()}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-6 pb-8 pt-4">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Select your role
              </label>
              <Select
                value={selectedRole}
                onValueChange={(v) => setSelectedRole(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a role…" />
                </SelectTrigger>
                <SelectContent>
                  {DOMAIN.roles.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={!selectedRole}
            >
              Sign In
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            Demo environment &mdash; no credentials required
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
