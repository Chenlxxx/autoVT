import { chromium } from "playwright";
import type { Locator, Page } from "playwright";
import fs from "fs-extra";
import path from "path";
import type { LocatorHint, StepConfig, TestCase, TestResult, TestStepResult } from "./types.ts";

const DEFAULT_VIEWPORT = { width: 1440, height: 920 };

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9\-_\u4e00-\u9fa5]+/gi, "-").replace(/-+/g, "-").slice(0, 80);
}

async function isVisible(locator: Locator, timeout = 1200) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function clickFirst(page: Page, locators: Locator[], timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    for (const locator of locators) {
      try {
        const item = locator.first();
        if (await isVisible(item, 600)) {
          await item.click({ timeout: 3000 });
          return true;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(350);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  return false;
}

function locatorsFromHint(page: Page, hint?: LocatorHint): Locator[] {
  if (!hint) return [];
  const locators: Locator[] = [];

  if (hint.testId) locators.push(page.getByTestId(hint.testId));
  if (hint.role && hint.name) locators.push(page.getByRole(hint.role, { name: hint.name }));
  if (hint.placeholder) locators.push(page.getByPlaceholder(hint.placeholder));
  if (hint.text) locators.push(page.getByText(hint.text, { exact: false }));
  for (const selector of hint.selectors || []) locators.push(page.locator(selector));

  return locators;
}

function textLocators(page: Page, labels: string[], role?: "button" | "link" | "menuitem" | "tab") {
  const locators: Locator[] = [];
  for (const label of labels) {
    if (role) locators.push(page.getByRole(role, { name: new RegExp(label, "i") }));
    locators.push(page.locator(`button:has-text("${label}")`));
    locators.push(page.locator(`[role="button"]:has-text("${label}")`));
    locators.push(page.locator(`[role="menuitem"]:has-text("${label}")`));
    locators.push(page.getByText(label, { exact: false }));
  }
  return locators;
}

async function fillFirst(page: Page, locators: Locator[], value: string, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    for (const locator of locators) {
      try {
        const item = locator.first();
        if (await isVisible(item, 600)) {
          await item.fill(value, { timeout: 3000 });
          return true;
        }
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(350);
  }

  if (lastError instanceof Error) throw lastError;
  return false;
}

async function checkAuth(page: Page) {
  const url = page.url();
  if (/passport|auth\/login|login/i.test(url)) return false;

  const loginLike = ["登录", "手机号登录", "扫码登录", "验证码登录"];
  for (const label of loginLike) {
    const visible = await isVisible(page.getByText(label, { exact: false }), 500);
    if (visible && /coze\.cn/.test(url)) return false;
  }
  return true;
}

async function waitForAnyText(page: Page, texts: string[], timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const text of texts) {
      if (await isVisible(page.getByText(text, { exact: false }), 700)) return text;
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`等待文本超时：${texts.join(" / ")}`);
}

async function createCozeWorkflow(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);

  if (!(await checkAuth(page))) {
    throw new Error("登录态无效，页面跳转到了登录或显示登录入口。");
  }

  const createLabels = ["创建工作流", "新建工作流", "创建资源", "新建资源", "创建", "新建"];
  const clickedCreate = await clickFirst(page, textLocators(page, createLabels, "button"), 25000);
  if (!clickedCreate) throw new Error("没有找到创建入口。");

  await page.waitForTimeout(900);

  const workflowLabels = ["工作流", "Workflow", "AI 工作流"];
  try {
    await clickFirst(page, textLocators(page, workflowLabels, "menuitem"), 10000);
  } catch {
    // Some Coze entries open the workflow dialog directly after clicking create.
  }

  await page.waitForTimeout(1200);

  const workflowName = `AutoVT-${Date.now()}`;
  const nameLocators = [
    page.getByPlaceholder(/名称|名字|name/i),
    page.locator('input[placeholder*="名称"]'),
    page.locator('input[placeholder*="名字"]'),
    page.locator(".arco-modal input").first(),
    page.locator("input").filter({ hasNotText: /^$/ }).first(),
  ];

  try {
    await fillFirst(page, nameLocators, workflowName, 8000);
  } catch {
    // Newer Coze pages may auto-create and skip the name dialog.
  }

  const confirmLabels = ["确认", "确定", "创建", "完成", "进入编辑"];
  try {
    await clickFirst(page, textLocators(page, confirmLabels, "button"), 12000);
  } catch {
    // If the editor is already open, continuing is fine.
  }

  await Promise.race([
    waitForAnyText(page, ["开始节点", "工作流", "节点", "试运行", "运行"], 45000),
    page.waitForURL(/workflow|develop|canvas|editor/i, { timeout: 45000 }).then(() => "url"),
  ]);
}

async function cozeAddAndRunLLM(page: Page, prompt: string) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  const addLabels = ["添加节点", "新增节点", "节点", "+", "添加"];
  try {
    await clickFirst(page, textLocators(page, addLabels, "button"), 10000);
    await page.waitForTimeout(800);
  } catch {
    // Node panels are often already visible on workflow editors.
  }

  const llmLocators = [
    page.getByText("大模型", { exact: false }),
    page.getByText("LLM", { exact: false }),
    page.getByText("模型", { exact: false }),
    page.locator('[draggable="true"]:has-text("大模型")'),
  ];

  const canvasLocators = [
    page.locator("canvas").first(),
    page.locator('[class*="canvas"]').first(),
    page.locator('[class*="flow"]').first(),
    page.locator('[class*="react-flow"]').first(),
  ];

  let addedNode = false;
  for (const source of llmLocators) {
    if (!(await isVisible(source, 1200))) continue;
    for (const destination of canvasLocators) {
      try {
        if (await isVisible(destination, 1200)) {
          await source.first().dragTo(destination, { timeout: 6000, targetPosition: { x: 420, y: 260 } });
          addedNode = true;
          break;
        }
      } catch {
        // Try less precise gestures below.
      }
    }
    if (addedNode) break;
    try {
      await source.first().dblclick({ timeout: 4000 });
      addedNode = true;
      break;
    } catch {
      try {
        await source.first().click({ timeout: 4000 });
        addedNode = true;
        break;
      } catch {
        // Continue trying other candidates.
      }
    }
  }

  if (!addedNode) throw new Error("没有找到或无法添加大模型节点。");

  await page.waitForTimeout(1600);

  const promptLocators = [
    page.getByPlaceholder(/提示词|prompt|输入/i),
    page.locator('textarea[placeholder*="提示词"]'),
    page.locator('textarea[placeholder*="Prompt"]'),
    page.locator("textarea").first(),
    page.locator('[contenteditable="true"]').first(),
  ];

  try {
    const promptBox = promptLocators.find(Boolean);
    await fillFirst(page, promptLocators, prompt, 12000);
    if (promptBox) await page.keyboard.press("Tab");
  } catch {
    // Some Coze nodes can run with default configuration or require model credentials outside this test.
  }

  const runLabels = ["试运行", "运行", "Run", "测试运行", "调试", "开始运行"];
  const clickedRun = await clickFirst(page, textLocators(page, runLabels, "button"), 25000);
  if (!clickedRun) throw new Error("没有找到试运行或运行按钮。");

  await page.waitForTimeout(1500);

  try {
    await clickFirst(page, textLocators(page, ["发送", "确定", "运行", "开始"], "button"), 8000);
  } catch {
    // The first run click may be enough.
  }

  const successTexts = ["hello AutoVT", "运行成功", "执行成功", "输出", "结果", "完成"];
  await waitForAnyText(page, successTexts, 70000);
}

export async function runTestCase(
  taskId: string,
  testCase: TestCase,
  taskDir: string,
  overrideUrl?: string
): Promise<TestResult> {
  const targetUrl = overrideUrl || testCase.targetUrl;
  const result: TestResult = {
    taskId,
    caseId: testCase.id,
    caseName: testCase.name,
    startTime: new Date().toISOString(),
    targetUrl,
    status: "running",
    steps: [],
    screenshots: [],
    consoleErrors: [],
    networkFailures: [],
  };

  await fs.ensureDir(taskDir);
  const saveProgress = async () => {
    await fs.writeJson(path.join(taskDir, "result.json"), result, { spaces: 2 });
  };

  const takeScreenshot = async (name: string) => {
    const fileName = `${sanitizeFileName(name)}-${Date.now()}.png`;
    await page?.screenshot({ path: path.join(taskDir, fileName), fullPage: true });
    result.screenshots.push(fileName);
    await saveProgress();
    return fileName;
  };

  await saveProgress();

  const authPath = path.resolve(process.cwd(), testCase.authStatePath || "playwright/.auth/coze-user.json");
  if (testCase.loginMode === "storageState" && !(await fs.pathExists(authPath))) {
    result.status = "auth_required";
    result.message = `需要登录态文件：${path.relative(process.cwd(), authPath)}。请先本地运行 npm run save-auth，或上传有效 storageState。`;
    result.endTime = new Date().toISOString();
    await saveProgress();
    return result;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
    storageState: testCase.loginMode === "storageState" ? authPath : undefined,
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const page = await context.newPage();

  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      result.consoleErrors.push(`${msg.type()}: ${msg.text()}`);
    }
  });

  page.on("requestfailed", (request) => {
    result.networkFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || "failed"}`);
  });

  try {
    for (const currentStep of testCase.steps) {
      const started = Date.now();
      const stepResult: TestStepResult = {
        id: currentStep.id,
        name: currentStep.name,
        type: currentStep.type,
        status: "pass",
        duration: 0,
        evidence: {},
      };

      try {
        await runStep(page, currentStep, targetUrl);
        if (currentStep.screenshot) {
          stepResult.evidence.screenshot = await takeScreenshot(currentStep.name);
        }
      } catch (error: any) {
        stepResult.status = "fail";
        stepResult.error = error?.message || String(error);
        try {
          stepResult.evidence.screenshot = await takeScreenshot(`失败-${currentStep.name}`);
        } catch {
          // Ignore screenshot failures so the real step error is preserved.
        }

        if (result.status === "auth_expired") throw error;
        result.steps.push({ ...stepResult, duration: Date.now() - started });
        await saveProgress();
        if (!currentStep.continueOnError) throw error;
        continue;
      }

      result.steps.push({ ...stepResult, duration: Date.now() - started });
      await saveProgress();
    }

    result.status = "success";
  } catch (error: any) {
    if (result.status === "running") result.status = "failure";
    result.message = error?.message || String(error);
  } finally {
    try {
      await takeScreenshot("最终状态");
    } catch {
      // Page may already be closed on browser-level failures.
    }
    const traceFile = "trace.zip";
    await context.tracing.stop({ path: path.join(taskDir, traceFile) });
    result.traceFile = traceFile;
    await browser.close();
    result.endTime = new Date().toISOString();
    await saveProgress();
  }

  return result;

  async function runStep(page: Page, stepConfig: StepConfig, currentUrl: string) {
    const timeout = stepConfig.timeout || 15000;
    switch (stepConfig.type) {
      case "goto":
        await page.goto(stepConfig.url || currentUrl, { waitUntil: "domcontentloaded", timeout });
        await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 15000) }).catch(() => undefined);
        return;
      case "checkAuth":
        if (!(await checkAuth(page))) {
          result.status = "auth_expired";
          throw new Error("登录态已失效，请重新保存登录态。");
        }
        return;
      case "click": {
        const clicked = await clickFirst(page, locatorsFromHint(page, stepConfig.target), timeout);
        if (!clicked) throw new Error(`没有找到可点击目标：${stepConfig.name}`);
        return;
      }
      case "input": {
        const filled = await fillFirst(page, locatorsFromHint(page, stepConfig.target), stepConfig.value || "", timeout);
        if (!filled) throw new Error(`没有找到输入目标：${stepConfig.name}`);
        return;
      }
      case "drag": {
        const source = locatorsFromHint(page, stepConfig.source)[0];
        const destination = locatorsFromHint(page, stepConfig.destination)[0];
        if (!source || !destination) throw new Error("拖拽步骤缺少 source 或 destination。 ");
        await source.first().dragTo(destination.first(), { timeout });
        return;
      }
      case "waitForText":
        await waitForAnyText(page, [stepConfig.value || ""], timeout);
        return;
      case "waitForUrl":
        await page.waitForURL(stepConfig.url || "**", { timeout });
        return;
      case "waitForIdle":
        await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
        await page.waitForTimeout(800);
        return;
      case "screenshot":
        await takeScreenshot(stepConfig.name);
        return;
      case "extractText": {
        const target = locatorsFromHint(page, stepConfig.target)[0] || page.locator("body");
        result.finalOutput = (await target.first().innerText({ timeout })).slice(0, 4000);
        return;
      }
      case "assertVisible": {
        const target = locatorsFromHint(page, stepConfig.target)[0];
        if (!target) throw new Error("断言步骤缺少目标。 ");
        await target.first().waitFor({ state: "visible", timeout });
        return;
      }
      case "cozeCreateWorkflow":
        await createCozeWorkflow(page);
        return;
      case "cozeAddAndRunLLM":
        await cozeAddAndRunLLM(page, stepConfig.value || "请只回复：hello AutoVT");
        return;
    }
  }
}




