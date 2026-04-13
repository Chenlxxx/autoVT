import Anthropic from "@anthropic-ai/sdk";
import { TestResult } from "../automation/coze-test.ts";

// 配置自定义 AI 模型 (Anthropic 格式)
const anthropic = new Anthropic({
  apiKey: "sk-cp-20a37b5d8804b455f033d4936ab84625c3289d62e71ecf8f9e4498549f5d5b3b",
  baseURL: "https://api.nengpa.com/anthropic", // Anthropic SDK 会自动补全 /v1
});

export async function analyzeResult(result: TestResult, taskDir: string): Promise<string> {
  try {
    const prompt = `
      你是一名资深 QA 自动化工程师。请分析以下在 Coze.cn 上执行的 Web 自动化测试结果。
      
      任务 ID: ${result.taskId}
      目标 URL: ${result.targetUrl}
      最终状态: ${result.status}
      
      执行步骤:
      ${result.steps.map(s => `- ${s.name}: ${s.status} (${s.duration}ms)${s.error ? ` 错误: ${s.error}` : ""}`).join("\n")}
      
      控制台错误 (Console Errors):
      ${result.consoleErrors.slice(0, 5).join("\n")}
      
      网络失败记录 (Network Failures):
      ${result.networkFailures.slice(0, 5).join("\n")}
      
      最终输出内容 (Final Output):
      ${result.finalOutput || "无输出"}
      
      请提供：
      1. 执行过程的简要总结。
      2. 如果测试失败，请分析最可能的根本原因。
      3. 核心流程（创建 -> 运行）是否成功的结论。
      4. 提高自动化稳定性的改进建议。
      
      请使用中文输出，保持专业且简洁。
    `;

    const response = await anthropic.messages.create({
      model: "MiniMax-M2.5",
      max_tokens: 4096,
      system: "你是一个专业的自动化测试分析助手。请直接输出分析结果，不要包含思考过程（thinking）。",
      messages: [
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
    });

    // 提取文本内容
    const content = response.content[0];
    if (content.type === 'text') {
      return content.text;
    }
    
    return "AI 未能生成有效的文本总结。";
  } catch (error: any) {
    console.error("AI 分析失败:", error);
    return `AI 分析失败: ${error.message}`;
  }
}
