import { randomUUID } from "crypto";
import type { GeneratedCaseRequest, StepConfig, TestCase } from "./types.ts";

const COZE_WORKFLOW_TUTORIAL_HINT = `Coze workflow regression: open the resource or library page, create a workflow, add an LLM node, run the workflow, and verify that a result is visible.`;

function now() {
  return new Date().toISOString();
}

function step(input: Omit<StepConfig, "id">): StepConfig {
  return { id: randomUUID(), ...input };
}

export function createCozeWorkflowCase(targetUrl?: string): TestCase {
  const timestamp = now();
  return {
    id: "template-coze-workflow-smoke",
    name: "Coze 工作流基础回归",
    description: "打开 Coze 资源页，创建工作流，添加大模型节点，试运行并确认有结果输出。",
    targetUrl:
      targetUrl ||
      "https://www.coze.cn/space/7543460160883884075/library?force_stay=1",
    loginMode: "storageState",
    authStatePath: "playwright/.auth/coze-user.json",
    tags: ["coze", "workflow", "smoke"],
    tutorial: COZE_WORKFLOW_TUTORIAL_HINT,
    objective: "创建一个工作流，添加大模型节点并试运行成功。",
    createdAt: timestamp,
    updatedAt: timestamp,
    steps: [
      step({
        name: "打开目标页面",
        type: "goto",
        timeout: 45000,
        screenshot: true,
      }),
      step({
        name: "检查登录状态",
        type: "checkAuth",
        timeout: 12000,
      }),
      step({
        name: "创建工作流",
        type: "cozeCreateWorkflow",
        timeout: 90000,
        screenshot: true,
      }),
      step({
        name: "添加大模型节点并试运行",
        type: "cozeAddAndRunLLM",
        value: "请只回复：hello AutoVT",
        timeout: 60000,
        screenshot: true,
      }),
      step({
        name: "保存最终截图",
        type: "screenshot",
      }),
    ],
  };
}

export function generateHeuristicCase(request: GeneratedCaseRequest): TestCase {
  const objective = request.objective.trim();
  const timestamp = now();
  const wantsWorkflow = /工作流|workflow|编排|节点|大模型|LLM/i.test(
    `${objective}\n${request.tutorial || ""}`
  );

  if (/coze\.cn/i.test(request.targetUrl) || wantsWorkflow) {
    const base = createCozeWorkflowCase(request.targetUrl);
    return {
      ...base,
      id: randomUUID(),
      name: /coze\.cn/i.test(request.targetUrl)
        ? "Coze 工作流回归 - AI 生成"
        : "低码工作流回归 - AI 生成",
      description: objective || base.description,
      loginMode: request.loginMode || base.loginMode,
      tutorial: request.tutorial,
      objective,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  return {
    id: randomUUID(),
    name: "页面基础可用性检查 - AI 生成",
    description: objective || "打开页面并检查页面可以正常加载。",
    targetUrl: request.targetUrl,
    loginMode: request.loginMode || "none",
    tags: ["generated", "smoke"],
    tutorial: request.tutorial,
    objective,
    createdAt: timestamp,
    updatedAt: timestamp,
    steps: [
      step({
        name: "打开目标页面",
        type: "goto",
        timeout: 45000,
        screenshot: true,
      }),
      step({
        name: "等待页面稳定",
        type: "waitForIdle",
        timeout: 15000,
      }),
      step({
        name: "保存页面截图",
        type: "screenshot",
      }),
    ],
  };
}
