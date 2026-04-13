export type StepType = 
  | "goto"
  | "waitForLogin"
  | "click"
  | "input"
  | "assertText"
  | "waitForUrl"
  | "screenshot"
  | "extractText";

export interface StepConfig {
  name: string;
  type: StepType;
  selectors?: string[];
  value?: string; // 用于 input 的值或 assertText 的预期文本
  url?: string;   // 用于 goto 或 waitForUrl
  timeout?: number;
  continueOnError?: boolean;
}

export interface FlowConfig {
  name: string;
  description?: string;
  baseUrl?: string;
  steps: StepConfig[];
}

export interface TestStepResult {
  name: string;
  status: "pass" | "fail";
  duration: number;
  error?: string;
}

export interface TestResult {
  taskId: string;
  startTime: string;
  endTime?: string;
  targetUrl: string;
  status: "success" | "failure" | "running" | "AUTH_REQUIRED" | "AUTH_EXPIRED";
  message?: string;
  steps: TestStepResult[];
  screenshots: string[];
  consoleErrors: string[];
  networkFailures: string[];
  finalOutput?: string;
  aiSummary?: string;
}
