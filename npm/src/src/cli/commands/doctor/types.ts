export interface DiagnosticResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: string;
}
