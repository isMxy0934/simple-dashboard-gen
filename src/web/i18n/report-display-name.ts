export function formatReportDisplayName(name: string): string {
  return name.replace(/\bDashboard\b/gi, "Report");
}
