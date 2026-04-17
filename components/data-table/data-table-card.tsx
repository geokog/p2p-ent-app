"use client";

import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type DataTableCardProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

/** Card shell for filterable, paginated tables. */
export function DataTableCard({
  title,
  description,
  children,
  className,
}: DataTableCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? (
          <CardDescription>{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
