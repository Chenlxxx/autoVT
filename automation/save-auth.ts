import { chromium } from "playwright";
import fs from "fs-extra";
import path from "path";

async function saveAuth() {
  const authDir = path.join(process.cwd(), "playwright", ".auth");
  const authFile = path.join(authDir, "coze-user.json");

  await fs.ensureDir(authDir);

  console.log("正在启动浏览器进行人工登录...");
  // 使用 non-headless 模式以便人工操作
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.coze.cn/");

  console.log("请在浏览器窗口中完成登录（包括验证码）。");
  console.log("登录成功并进入主页后，脚本将自动保存状态并关闭。");

  // 等待登录成功的标志：URL 不再包含 passport 且 出现了个人空间或项目等关键词
  try {
    await page.waitForFunction(
      () => {
        const url = window.location.href;
        return !url.includes("passport") && !url.includes("auth/login") && 
               (document.body.innerText.includes("项目") || document.body.innerText.includes("个人空间"));
      },
      { timeout: 300000 } // 给 5 分钟时间进行人工操作
    );

    console.log("检测到登录成功，正在保存登录态...");
    await context.storageState({ path: authFile });
    console.log(`登录态已保存至: ${authFile}`);
  } catch (error) {
    console.error("等待登录超时或发生错误:", error);
  } finally {
    await browser.close();
  }
}

saveAuth().catch(console.error);
