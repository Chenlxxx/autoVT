import { chromium, Page } from "playwright";
import fs from "fs-extra";
import path from "path";

export interface TestStep {
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
  status: "success" | "failure";
  steps: TestStep[];
  screenshots: string[];
  consoleErrors: string[];
  networkFailures: string[];
  finalOutput?: string;
  aiSummary?: string;
}

export async function runCozeTest(taskId: string, targetUrl: string, taskDir: string): Promise<TestResult> {
  const result: TestResult = {
    taskId,
    startTime: new Date().toISOString(),
    targetUrl,
    status: "success",
    steps: [],
    screenshots: [],
    consoleErrors: [],
    networkFailures: [],
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  // Capture console errors
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      result.consoleErrors.push(msg.text());
    }
  });

  // Capture network failures
  page.on("requestfailed", (request) => {
    result.networkFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });

  const saveProgress = async () => {
    await fs.writeJson(path.join(taskDir, "result.json"), result, { spaces: 2 });
  };

  const runStep = async (name: string, fn: () => Promise<void>) => {
    const start = Date.now();
    try {
      await fn();
      result.steps.push({ name, status: "pass", duration: Date.now() - start });
      const stepScreenshot = `step-${result.steps.length}.png`;
      await page.screenshot({ path: path.join(taskDir, stepScreenshot) });
      result.screenshots.push(stepScreenshot);
      await saveProgress();
    } catch (error: any) {
      result.steps.push({ name, status: "fail", duration: Date.now() - start, error: error.message });
      result.status = "failure";
      const screenshotPath = `error-${name.replace(/\s+/g, "-").toLowerCase()}.png`;
      await page.screenshot({ path: path.join(taskDir, screenshotPath) });
      result.screenshots.push(screenshotPath);
      await saveProgress();
      throw error;
    }
  };

  try {
    await runStep("Open Page", async () => {
      await page.goto(targetUrl, { waitUntil: "networkidle" });
      
      // Check if login is required - check multiple indicators
      const loginTrigger = page.getByText("登录").first();
      const isPassport = page.url().includes("passport") || page.url().includes("auth/login");
      
      if (await loginTrigger.isVisible() || isPassport) {
        console.log("Login required. Attempting automated login...");
        
        // If we are not already on a login page, click the trigger
        if (!isPassport) {
          await loginTrigger.click();
        }
        
        // Wait for login modal/page to stabilize
        await page.waitForTimeout(3000);
        
        // Look for "账号登录" or similar tab/button
        const accountLoginTab = page.getByText("账号登录").first();
        if (await accountLoginTab.isVisible()) {
          await accountLoginTab.click();
          await page.waitForTimeout(1000);
        }

        // Fill credentials
        // Use more flexible selectors and wait for them to be ready
        const accountInput = page.locator('input[placeholder*="账号"], input[name*="Identity"]').first();
        const passwordInput = page.locator('input[placeholder*="密码"], input[name*="Password"]').first();
        
        await accountInput.waitFor({ state: "visible", timeout: 10000 });
        await accountInput.fill("2110359047");
        
        await passwordInput.waitFor({ state: "visible", timeout: 10000 });
        await passwordInput.fill("Abc12345.");
        
        // Check agreement if exists - often a custom checkbox, try to click the label or container if needed
        const agreement = page.locator('input[type="checkbox"], .arco-checkbox-input').first();
        if (await agreement.isVisible()) {
          await agreement.check().catch(() => agreement.click({ position: { x: 0, y: 0 } }));
        }

        // Click login button
        const loginBtn = page.getByRole("button", { name: /登录|确定/i }).first();
        await loginBtn.waitFor({ state: "visible", timeout: 10000 });
        
        console.log("Clicking login button...");
        await loginBtn.click();
        
        // Wait for URL to change away from login pages
        console.log("Waiting for login to complete (URL change)...");
        try {
          // Wait for the URL to NOT contain login-related strings
          await page.waitForFunction(
            () => !window.location.href.includes("passport") && !window.location.href.includes("auth/login"),
            { timeout: 30000 }
          );
        } catch (e) {
          console.log("URL did not change away from login page within 30s.");
          // Check for visible error messages on the login page
          const errorMsg = await page.locator(".arco-form-item-explain-error, .login-error-msg").first().innerText().catch(() => "");
          if (errorMsg) {
            throw new Error(`Login failed with error: ${errorMsg}`);
          }
          
          // Take a screenshot of the failed login state
          const loginFailScreenshot = `login-failed-${Date.now()}.png`;
          await page.screenshot({ path: path.join(taskDir, loginFailScreenshot) });
          result.screenshots.push(loginFailScreenshot);
        }
        
        // Final verification
        await page.waitForTimeout(5000); // Give it a moment to settle
        if (page.url().includes("passport") || page.url().includes("auth/login")) {
          throw new Error(`Login failed. Still on login page: ${page.url()}`);
        }
        console.log("Login successful, current URL:", page.url());
      }
    });

    await runStep("创建智能体", async () => {
      // 确保不在登录页
      if (page.url().includes("passport") || page.url().includes("auth/login")) {
        throw new Error(`无法创建智能体：仍处于登录页面 (${page.url()})`);
      }

      // 1. 点击右上角的 "+项目" 按钮
      // 尝试多种可能的按钮选择器
      const addProjectBtn = page.locator('button:has-text("项目"), .arco-btn:has-text("项目"), .arco-btn:has(.arco-icon-plus)').first();
      await addProjectBtn.waitFor({ state: "visible", timeout: 15000 });
      await addProjectBtn.click();
      
      // 2. 在下拉菜单中选择 "创建智能体"
      // 增加等待时间并尝试更通用的选择器
      await page.waitForTimeout(1000); // 等待菜单动画
      const createBotOption = page.locator('text=创建智能体, .arco-dropdown-menu-item:has-text("智能体"), [role="menuitem"]:has-text("智能体")').first();
      await createBotOption.waitFor({ state: "visible", timeout: 10000 });
      await createBotOption.click();

      // 3. 填写智能体名称
      // 弹窗可能需要一点时间显示
      const nameInput = page.locator('input[placeholder*="名称"], .arco-input[placeholder*="智能体"], .arco-modal-content input').first();
      await nameInput.waitFor({ state: "visible", timeout: 10000 });
      await nameInput.fill("testVT");

      // 4. 点击确认按钮
      const confirmBtn = page.locator('button:has-text("确认"), .arco-modal-footer button.arco-btn-primary, button:has-text("确定")').first();
      await confirmBtn.waitFor({ state: "visible", timeout: 5000 });
      await confirmBtn.click();
      
      // 等待进入开发页
      console.log("创建智能体已提交，等待页面跳转...");
      await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => console.log("创建后跳转较慢"));
    });

    await runStep("Configure Workflow", async () => {
      // This is the hardest part to automate. 
      // For MVP, we might just check if we are in the development area.
      await page.waitForSelector("text=工作流", { timeout: 10000 });
      await page.screenshot({ path: path.join(taskDir, "workflow-page.png") });
      result.screenshots.push("workflow-page.png");
    });

    await runStep("Test Run", async () => {
      // Find the preview input
      const input = page.getByPlaceholder(/输入消息/i).first();
      await input.fill("你好，请用一句话介绍你自己");
      await page.keyboard.press("Enter");
      
      // Wait for response
      await page.waitForTimeout(5000); // Simple wait for response
      const response = await page.locator(".chat-message-content").last().innerText();
      result.finalOutput = response;
    });

    result.status = "success";
  } catch (error) {
    result.status = "failure";
  } finally {
    const finalScreenshot = "final-state.png";
    await page.screenshot({ path: path.join(taskDir, finalScreenshot) });
    result.screenshots.push(finalScreenshot);
    result.endTime = new Date().toISOString();
    await browser.close();
  }

  return result;
}
