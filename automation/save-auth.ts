import { chromium } from "playwright";
import fs from "fs-extra";
import path from "path";

async function saveAuth() {
  const authDir = path.join(process.cwd(), "playwright", ".auth");
  const authFile = path.join(authDir, "coze-user.json");

  await fs.ensureDir(authDir);

  console.log("正在打开浏览器，请在窗口中完成 Coze 登录。");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://www.coze.cn/", { waitUntil: "domcontentloaded" });

  console.log("登录完成并进入 Coze 页面后，脚本会自动保存登录态。最长等待 5 分钟。");

  try {
    await page.waitForFunction(
      () => {
        const url = window.location.href;
        const text = document.body.innerText;
        const notLoginPage = !/passport|auth\/login|login/i.test(url);
        return notLoginPage && (/资源|项目|空间|工作流|个人空间/.test(text) || /coze\.cn/.test(url));
      },
      { timeout: 300000 }
    );

    await context.storageState({ path: authFile });
    console.log(`登录态已保存：${authFile}`);
  } catch (error) {
    console.error("等待登录超时，未保存登录态。", error);
  } finally {
    await browser.close();
  }
}

saveAuth().catch(console.error);
