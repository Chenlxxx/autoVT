import type { TestResult } from "../automation/types.ts";

function buildFallbackSummary(result: TestResult) {
  const failed = result.steps.find((step) => step.status === "fail");
  if (result.status === "success") {
    return `本次回归通过。共执行 ${result.steps.length} 个步骤，页面核心链路完成，已保存截图和 trace 证据。`;
  }
  if (result.status === "auth_required" || result.status === "auth_expired") {
    return `本次回归未执行完成：${result.message || "登录态不可用"}。请先更新登录态后重新运行。`;
  }
  return `本次回归失败。失败步骤：${failed?.name || "未知"}。${failed?.error || result.message || "请查看失败截图、控制台错误和网络失败记录。"}`;
}

export async function analyzeResult(result: TestResult): Promise<string> {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  const baseURL = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL || "qwen2.5-vl-72b-instruct";

  if (!apiKey || !baseURL) return buildFallbackSummary(result);

  try {
    const steps = result.steps
      .map((step) => `- ${step.name}: ${step.status} (${step.duration}ms)${step.error ? `，错误：${step.error}` : ""}`)
      .join("\n");

    const endpoint = `${baseURL.replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "你是资深 QA 自动化测试分析助手。请用中文输出简洁、可执行的测试结论，不要输出思考过程。",
          },
          {
            role: "user",
            content: `请分析这次 Web 自动化回归测试。\n\n案例：${result.caseName}\n目标地址：${result.targetUrl}\n状态：${result.status}\n消息：${result.message || "无"}\n\n步骤：\n${steps}\n\nConsole 错误前 8 条：\n${result.consoleErrors.slice(0, 8).join("\n") || "无"}\n\n网络失败前 8 条：\n${result.networkFailures.slice(0, 8).join("\n") || "无"}\n\n请输出：1）最终结论；2）失败原因或风险；3）下一步建议。`,
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || buildFallbackSummary(result);
  } catch (error: any) {
    return `${buildFallbackSummary(result)}\n\nAI 分析调用失败：${error.message}`;
  }
}

