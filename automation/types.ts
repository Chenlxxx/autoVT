export type LoginMode = "none" | "storageState";

export type StepType =
  | "goto"
  | "checkAuth"
  | "click"
  | "input"
  | "drag"
  | "waitForText"
  | "waitForUrl"
  | "waitForIdle"
  | "screenshot"
  | "extractText"
  | "assertVisible"
  | "cozeCreateWorkflow"
  | "cozeAddAndRunLLM";

export interface LocatorHint {
  testId?: string;
  role?: "button" | "link" | "textbox" | "menuitem" | "tab";
  name?: string;
  text?: string;
  placeholder?: string;
  selectors?: string[];
}

export interface StepConfig {
  id: string;
  name: string;
  type: StepType;
  description?: string;
  target?: LocatorHint;
  source?: LocatorHint;
  destination?: LocatorHint;
  value?: string;
  url?: string;
  timeout?: number;
  continueOnError?: boolean;
  screenshot?: boolean;
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  targetUrl: string;
  loginMode: LoginMode;
  authStatePath?: string;
  tags: string[];
  tutorial?: string;
  objective?: string;
  steps: StepConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface StepEvidence {
  screenshot?: string;
  extractedText?: string;
  diagnostics?: string[];
  recoveryActions?: string[];
  pageState?: Record<string, unknown>;
  needsHumanInput?: {
    reason: string;
    question: string;
    suggestions: string[];
  };
}

export interface TestStepResult {
  id: string;
  name: string;
  type: StepType;
  status: "pass" | "fail" | "skipped";
  duration: number;
  error?: string;
  evidence?: StepEvidence;
}

export interface TestResult {
  taskId: string;
  caseId: string;
  caseName: string;
  startTime: string;
  endTime?: string;
  targetUrl: string;
  status: "success" | "failure" | "running" | "auth_required" | "auth_expired";
  message?: string;
  steps: TestStepResult[];
  screenshots: string[];
  consoleErrors: string[];
  networkFailures: string[];
  finalOutput?: string;
  aiSummary?: string;
  traceFile?: string;
  diagnostics?: string[];
}

export interface GeneratedCaseRequest {
  targetUrl: string;
  objective: string;
  tutorial?: string;
  loginMode?: LoginMode;
}
