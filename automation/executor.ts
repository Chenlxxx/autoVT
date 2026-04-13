import { chromium, Page, Browser, BrowserContext } from "playwright";
import fs from "fs-extra";
import path from "path";
import { FlowConfig, StepConfig, TestResult, TestStepResult } from "./types.ts";

export async function runTestFlow(
  taskId: string,
  flowConfig: FlowConfig,
  taskDir: string,
  initialUrl?: string
): Promise<TestResult> {
  const result: TestResult = {
    taskId,
    startTime: new Date().toISOString(),
    targetUrl: initialUrl || flowConfig.baseUrl || "",
    status: "running",
    steps: [],
    screenshots: [],
    consoleErrors: [],
    networkFailures: [],
  };

  const saveProgress = async () => {
    await fs.writeJson(path.join(taskDir, "result.json"), result, { spaces: 2 });
  };

  // 立即保存初始状态，确保前端能看到任务已开始
  await saveProgress();

  const authFile = path.join(process.cwd(), "playwright", ".auth", "coze-user.json");
  const hasAuth = await fs.pathExists(authFile);

  if (!hasAuth) {
    result.status = "AUTH_REQUIRED";
    result.message = "未检测到登录态文件，请先运行保存登录态脚本 (npm run save-auth)";
    await fs.writeJson(path.join(taskDir, "result.json"), result, { spaces: 2 });
    return result;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    storageState: authFile,
  });

  const page = await context.newPage();

  // 捕获控制台错误
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      result.consoleErrors.push(msg.text());
    }
  });

  // 捕获网络失败
  page.on("requestfailed", (request) => {
    result.networkFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });

  const takeScreenshot = async (name: string) => {
    const fileName = `${name}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(taskDir, fileName) });
    result.screenshots.push(fileName);
    await saveProgress();
  };

  const checkAuthValidity = async () => {
    const url = page.url();
    const isLoginPage = url.includes("passport") || url.includes("auth/login");
    const loginBtnVisible = await page.getByText("登录").first().isVisible();
    
    if (isLoginPage || loginBtnVisible) {
      result.status = "AUTH_EXPIRED";
      result.message = "登录态已失效，请重新运行保存登录态脚本 (npm run save-auth)";
      return false;
    }
    return true;
  };

  const findElement = async (selectors: string[] | undefined, timeout: number = 10000) => {
    if (!selectors || selectors.length === 0) return null;
    
    // 优先尝试每个选择器
    for (const selector of selectors) {
      try {
        // 使用 waitForSelector 确保元素在 DOM 中且可见
        await page.waitForSelector(selector, { state: "visible", timeout: 3000 });
        return page.locator(selector).first();
      } catch (e) {
        continue;
      }
    }
    
    // 如果都没有立即找到，尝试最后一个并等待完整超时
    try {
      const lastSelector = selectors[selectors.length - 1];
      await page.waitForSelector(lastSelector, { state: "visible", timeout });
      return page.locator(lastSelector).first();
    } catch (e) {
      return null;
    }
  };

  try {
    for (const step of flowConfig.steps) {
      const stepStart = Date.now();
      console.log(`Executing step: ${step.name} (${step.type})`);
      
      try {
        switch (step.type) {
          case "goto":
            await page.goto(step.url || result.targetUrl, { waitUntil: "networkidle" });
            // 每次 goto 之后检查登录态
            if (!(await checkAuthValidity())) {
              throw new Error(result.message);
            }
            break;

          case "waitForLogin":
            // 在持久化模式下，这个步骤主要用于验证登录态
            const isValid = await checkAuthValidity();
            if (!isValid) {
              throw new Error(result.message);
            }
            console.log("登录态有效，跳过自动登录流程");
            break;

          case "click":
            const clickEl = await findElement(step.selectors, step.timeout);
            if (!clickEl) throw new Error(`Could not find element for click: ${step.selectors?.join(", ")}`);
            await clickEl.click();
            break;

          case "input":
            const inputEl = await findElement(step.selectors, step.timeout);
            if (!inputEl) throw new Error(`Could not find element for input: ${step.selectors?.join(", ")}`);
            await inputEl.fill(step.value || "");
            break;

          case "assertText":
            await page.waitForSelector(`text=${step.value}`, { timeout: step.timeout || 10000 });
            break;

          case "waitForUrl":
            await page.waitForURL(step.url!, { timeout: step.timeout || 30000 });
            break;

          case "screenshot":
            await takeScreenshot(step.name.replace(/\s+/g, "-").toLowerCase());
            break;

          case "extractText":
            const extractEl = await findElement(step.selectors, step.timeout);
            if (extractEl) {
              result.finalOutput = await extractEl.innerText();
            }
            break;
        }

        result.steps.push({
          name: step.name,
          status: "pass",
          duration: Date.now() - stepStart
        });
        await saveProgress();

      } catch (error: any) {
        console.error(`Step failed: ${step.name}`, error);
        
        // 如果是登录态问题，直接中断
        if (result.status === "AUTH_EXPIRED" || result.status === "AUTH_REQUIRED") {
          throw error;
        }

        result.steps.push({
          name: step.name,
          status: "fail",
          duration: Date.now() - stepStart,
          error: error.message
        });
        
        // 失败自动截图
        await takeScreenshot(`error-${step.name.replace(/\s+/g, "-").toLowerCase()}`);
        
        if (!step.continueOnError) {
          result.status = "failure";
          throw error;
        }
      }
    }
    result.status = "success";
  } catch (error) {
    if (result.status !== "AUTH_EXPIRED" && result.status !== "AUTH_REQUIRED") {
      result.status = "failure";
    }
  } finally {
    if (result.status !== "AUTH_REQUIRED") {
      // 即使是 AUTH_EXPIRED，也截一张最后的图，方便看为什么失效
      await takeScreenshot("final-state");
      await browser.close();
    }
    result.endTime = new Date().toISOString();
    await saveProgress();
  }

  return result;
}
