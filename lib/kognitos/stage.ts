/** Last path segment of a Kognitos run resource name (stable id for URLs and DB PK). */
export function runShortIdFromName(name: string): string {
  const parts = name.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? name;
}
