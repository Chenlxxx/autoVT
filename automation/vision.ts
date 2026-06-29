import fs from "fs/promises";

export type VisionProvider = "openai-compatible" | "heuristic";

export interface VisionConfig {
  enabled: boolean;
  provider: VisionProvider;
  model: string;
  configured: boolean;
  fallback: string;
}

export interface VisionAnalysisContext {
  stepName: string;
  error?: string;
  diagnostics?: string[];
  recoveryActions?: string[];
  pageState?: Record<string, unknown>;
}

function envFlag(name: string, defaultValue: boolean) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}

export function getVisionConfig(): VisionConfig {
  const enabled = envFlag("VISION_ENABLED", true);
  const apiKey = process.env.VISION_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseUrl = process.env.VISION_BASE_URL || process.env.AI_BASE_URL || "";
  const model = process.env.VISION_MODEL || process.env.AI_VISION_MODEL || process.env.AI_MODEL || "qwen-vl-max";
  const configured = Boolean(enabled && apiKey && baseUrl);

  return {
    enabled,
    provider: configured ? "openai-compatible" : "heuristic",
    model,
    configured,
    fallback: configured ? "视觉模型失败时自动退回规则诊断" : "未配置视觉模型，使用页面文本、错误列表和自修复日志兜底",
  };
}

export async function analyzeScreenshot(imagePath: string, context: VisionAnalysisContext) {
  const config = getVisionConfig();
  if (!config.enabled) return "视觉分析未启用。";

  if (config.configured) {
    try {
      return await analyzeWithOpenAICompatible(imagePath, context, config);
    } catch (error: any) {
      return [
        "视觉模型调用失败，已自动退回规则诊断。",
        heuristicVisionAnalysis(context),
        `模型错误：${error?.message || String(error)}`,
      ].join("\n\n");
    }
  }

  return heuristicVisionAnalysis(context);
}

async function analyzeWithOpenAICompatible(imagePath: string, context: VisionAnalysisContext, config: VisionConfig) {
  const apiKey = process.env.VISION_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  const rawBaseUrl = process.env.VISION_BASE_URL || process.env.AI_BASE_URL || "";
  const baseUrl = rawBaseUrl.replace(/\/$/, "");
  const image = await fs.readFile(imagePath);
  const imageUrl = `data:image/png;base64,${Buffer.from(image).toString("base64")}`;
  const pageState = JSON.stringify(context.pageState || {}, null, 2).slice(0, 5000);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "你是 AutoVT 的页面自动化视觉诊断器。请根据截图、页面状态和错误信息判断当前页面停在哪一步，失败原因是什么，以及下一步最稳妥的自修复动作。回答要短，使用中文。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `步骤：${context.stepName}`,
                `错误：${context.error || "无"}`,
                `已有诊断：${(context.diagnostics || []).join("；") || "无"}`,
                `已尝试动作：${(context.recoveryActions || []).join("；") || "无"}`,
                `页面状态：${pageState || "无"}`,
                "请输出：1. 当前页面判断 2. 最可能失败原因 3. 推荐的下一步恢复动作。",
              ].join("\n"),
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`视觉模型 HTTP ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("视觉模型未返回可读诊断");
  return String(content).trim();
}

function heuristicVisionAnalysis(context: VisionAnalysisContext) {
  const textSample = String(context.pageState?.textSample || "");
  const error = context.error || "";
  const combined = [textSample, error, ...(context.diagnostics || [])].join("\n");
  const lines: string[] = [];

  if (/创建智能体|创建应用/.test(combined)) {
    lines.push("页面疑似仍停留在创建类型选择弹窗，需要选择“创建工作流”或进入资源创建入口的二级菜单。");
  }
  if (/引用变量不存在|变量值不可为空|错误列表|运行失败|执行失败/.test(combined)) {
    lines.push("页面已进入工作流运行校验阶段，但节点参数或连线引用不完整，需要补齐开始节点输入、大模型输入引用和结束节点输出引用。");
  }
  if (/等待文本超时|Timeout|timed out/i.test(combined)) {
    lines.push("等待结果文本超时，建议先读取画布错误列表和运行面板状态，而不是继续等待固定文案。");
  }
  if (/登录|验证码|passport|auth/i.test(combined)) {
    lines.push("页面可能处于登录或验证状态，需要先刷新 storageState 或走交互式登录保存登录态。");
  }
  if ((context.recoveryActions || []).length > 0) {
    lines.push(`已尝试 ${context.recoveryActions?.length} 个自修复动作；如果仍失败，应把当前页面状态作为下一轮策略输入，而不是直接终止。`);
  }

  if (lines.length === 0) {
    lines.push("未配置外部视觉模型，当前使用规则兜底：请结合截图、页面文本和 Playwright trace 判断页面是否出现遮罩、弹窗、节点配置缺失或登录失效。");
  }

  return lines.join("\n");
}
