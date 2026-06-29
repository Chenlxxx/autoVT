import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { createCozeWorkflowCase, generateHeuristicCase } from "./automation/case-generator.ts";
import type { GeneratedCaseRequest, TestCase } from "./automation/types.ts";
import { analyzeResult } from "./server/gemini.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const rootDir = process.cwd();
const storageDir = path.join(rootDir, "storage");
const dataDir = path.join(rootDir, "data");
const casesDir = path.join(dataDir, "cases");
const authDir = path.join(rootDir, "playwright", ".auth");
const distDir = path.join(rootDir, "dist");

type JsonValue = Record<string, any> | any[];
type AuthSessionStatus = "running" | "success" | "failure";

interface AuthSession {
  id: string;
  status: AuthSessionStatus;
  startedAt: string;
  completedAt?: string;
  message: string;
  authPath?: string;
}

const authSessions = new Map<string, AuthSession>();

function interactiveAuthSupported() {
  return !process.env.RENDER && !process.env.RENDER_SERVICE_ID;
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function readBody(req: IncomingMessage) {
  const chunks: any[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, data: JsonValue) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

async function readCase(caseId: string): Promise<TestCase | null> {
  const file = path.join(casesDir, `${caseId}.json`);
  if (!(await pathExists(file))) return null;
  return readJson<TestCase>(file);
}

async function writeCase(testCase: TestCase) {
  await writeJson(path.join(casesDir, `${testCase.id}.json`), testCase);
}

async function listCases() {
  await fs.mkdir(casesDir, { recursive: true });
  const files = (await fs.readdir(casesDir)).filter((file) => file.endsWith(".json"));
  const cases = await Promise.all(files.map((file) => readJson<TestCase>(path.join(casesDir, file))));
  return cases.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

async function ensureSeedData() {
  await fs.mkdir(storageDir, { recursive: true });
  await fs.mkdir(casesDir, { recursive: true });
  await fs.mkdir(authDir, { recursive: true });

  const seed = createCozeWorkflowCase();
  await writeCase(seed);
}

async function listTasks() {
  await fs.mkdir(storageDir, { recursive: true });
  const dirs = await fs.readdir(storageDir);
  const tasks = await Promise.all(
    dirs.map(async (id) => {
      const resultPath = path.join(storageDir, id, "result.json");
      if (await pathExists(resultPath)) return readJson<any>(resultPath);
      return { taskId: id, status: "running", startTime: new Date(0).toISOString() };
    })
  );
  return tasks.sort((a, b) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());
}

async function runInteractiveAuth(sessionId: string, targetUrl: string, authPath: string) {
  const session = authSessions.get(sessionId);
  if (!session) return;

  try {
    const { chromium } = await import("playwright");
    await fs.mkdir(path.dirname(authPath), { recursive: true });

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(targetUrl || "https://www.coze.cn/", { waitUntil: "domcontentloaded", timeout: 60000 });
      session.message = "浏览器已打开。请完成登录，AutoVT 会在检测到登录成功后自动保存。";

      await page.waitForFunction(
        () => {
          const url = window.location.href;
          const text = document.body.innerText;
          const notLoginPage = !/passport|auth\/login|login/i.test(url);
          const hasWorkspaceSignal = /资源|项目|空间|工作流|个人空间|Library|Workflow/i.test(text);
          return notLoginPage && hasWorkspaceSignal;
        },
        { timeout: 300000 }
      );

      await context.storageState({ path: authPath });
      session.status = "success";
      session.completedAt = new Date().toISOString();
      session.message = `登录态已保存：${path.relative(rootDir, authPath)}。现在可以直接运行 Coze 案例。`;
    } finally {
      await browser.close();
    }
  } catch (error: any) {
    session.status = "failure";
    session.completedAt = new Date().toISOString();
    session.message = error?.message || String(error);
  }
}

function contentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

async function serveFile(res: ServerResponse, baseDir: string, requestPath: string) {
  const decoded = decodeURIComponent(requestPath);
  const safePath = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(baseDir, safePath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(baseDir))) return sendText(res, 403, "Forbidden");
  if (!(await pathExists(resolved))) return sendText(res, 404, "Not found");
  res.writeHead(200, { "Content-Type": contentType(resolved) });
  createReadStream(resolved).pipe(res);
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const method = req.method || "GET";
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      status: "ok",
      env: process.env.NODE_ENV || "development",
      cozeAuthReady: await pathExists(path.join(authDir, "coze-user.json")),
      interactiveAuthSupported: interactiveAuthSupported(),
    });
  }

  if (method === "GET" && pathname === "/api/cases") return sendJson(res, 200, await listCases());

  const caseMatch = pathname.match(/^\/api\/cases\/([^/]+)$/);
  if (method === "GET" && caseMatch) {
    const testCase = await readCase(caseMatch[1]);
    return testCase ? sendJson(res, 200, testCase) : sendJson(res, 404, { error: "Case not found" });
  }

  if (method === "POST" && pathname === "/api/cases") {
    const incoming = (await readBody(req)) as TestCase;
    const timestamp = new Date().toISOString();
    const testCase: TestCase = {
      ...incoming,
      id: incoming.id || randomUUID(),
      createdAt: incoming.createdAt || timestamp,
      updatedAt: timestamp,
    };
    await writeCase(testCase);
    return sendJson(res, 200, testCase);
  }

  if (method === "POST" && pathname === "/api/cases/generate") {
    const request = (await readBody(req)) as GeneratedCaseRequest;
    if (!request.targetUrl || !request.objective) return sendJson(res, 400, { error: "targetUrl and objective are required" });
    const testCase = generateHeuristicCase(request);
    await writeCase(testCase);
    return sendJson(res, 200, testCase);
  }

  if (method === "POST" && pathname === "/api/auth/storage-state") {
    const { name = "coze-user.json", storageState } = await readBody(req);
    if (!storageState || typeof storageState !== "object") return sendJson(res, 400, { error: "storageState JSON is required" });
    const safeName = String(name).replace(/[^a-z0-9_.-]/gi, "") || "coze-user.json";
    const file = path.join(authDir, safeName);
    await writeJson(file, storageState);
    return sendJson(res, 200, { ok: true, path: path.relative(rootDir, file) });
  }

  if (method === "POST" && pathname === "/api/auth/interactive/start") {
    if (!interactiveAuthSupported()) {
      return sendJson(res, 400, {
        error: "当前运行在云端环境，不能把服务器浏览器窗口弹到你的电脑上。请在本地运行 AutoVT 后使用一键登录，或继续粘贴 storageState。",
      });
    }

    const { targetUrl = "https://www.coze.cn/", name = "coze-user.json" } = await readBody(req);
    const sessionId = randomUUID();
    const safeName = String(name).replace(/[^a-z0-9_.-]/gi, "") || "coze-user.json";
    const authPath = path.join(authDir, safeName);
    const session: AuthSession = {
      id: sessionId,
      status: "running",
      startedAt: new Date().toISOString(),
      message: "正在打开登录浏览器，请在弹出的窗口中完成 Coze 登录。",
      authPath: path.relative(rootDir, authPath),
    };
    authSessions.set(sessionId, session);

    runInteractiveAuth(sessionId, String(targetUrl), authPath).catch((error) => {
      const current = authSessions.get(sessionId);
      if (!current) return;
      current.status = "failure";
      current.completedAt = new Date().toISOString();
      current.message = error.message || String(error);
    });

    return sendJson(res, 200, session);
  }

  const authSessionMatch = pathname.match(/^\/api\/auth\/interactive\/([^/]+)$/);
  if (method === "GET" && authSessionMatch) {
    const session = authSessions.get(authSessionMatch[1]);
    return session ? sendJson(res, 200, session) : sendJson(res, 404, { error: "Auth session not found" });
  }

  if (method === "POST" && pathname === "/api/test/run") {
    const { caseId, targetUrl } = await readBody(req);
    const testCase = caseId ? await readCase(caseId) : createCozeWorkflowCase(targetUrl);
    if (!testCase) return sendJson(res, 404, { error: "Case not found" });

    const taskId = randomUUID();
    const taskDir = path.join(storageDir, taskId);
    await fs.mkdir(taskDir, { recursive: true });

    const authStatePath = path.resolve(rootDir, testCase.authStatePath || "playwright/.auth/coze-user.json");
    if (testCase.loginMode === "storageState" && !(await pathExists(authStatePath))) {
      await writeJson(path.join(taskDir, "result.json"), {
        taskId,
        caseId: testCase.id,
        caseName: testCase.name,
        targetUrl: targetUrl || testCase.targetUrl,
        status: "auth_required",
        message: `需要登录态文件：${path.relative(rootDir, authStatePath)}。请先运行 npm run save-auth，或在页面粘贴 storageState JSON。`,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        steps: [],
        screenshots: [],
        consoleErrors: [],
        networkFailures: [],
        aiSummary: "本次回归未执行：缺少登录态。配置登录态后可无人值守运行 Coze 工作流案例。",
      });
      return sendJson(res, 200, { taskId, message: "Auth state required" });
    }

    import("./automation/executor.ts")
      .then(({ runTestCase }) => runTestCase(taskId, testCase, taskDir, targetUrl))
      .then(async (result) => {
        result.aiSummary = await analyzeResult(result);
        await writeJson(path.join(taskDir, "result.json"), result);
      })
      .catch(async (error) => {
        await writeJson(path.join(taskDir, "result.json"), {
          taskId,
          caseId: testCase.id,
          caseName: testCase.name,
          targetUrl: targetUrl || testCase.targetUrl,
          status: "failure",
          message: error.message,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          steps: [],
          screenshots: [],
          consoleErrors: [],
          networkFailures: [],
        });
      });

    return sendJson(res, 200, { taskId, message: "Test started" });
  }

  if (method === "GET" && pathname === "/api/tasks") return sendJson(res, 200, await listTasks());

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (method === "GET" && taskMatch) {
    const resultPath = path.join(storageDir, taskMatch[1], "result.json");
    return (await pathExists(resultPath)) ? sendJson(res, 200, await readJson(resultPath)) : sendJson(res, 404, { error: "Task not found" });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (url.pathname.startsWith("/storage/")) return await serveFile(res, storageDir, url.pathname.replace(/^\/storage\//, ""));

    const assetPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const fullPath = path.join(distDir, assetPath);
    if (await pathExists(fullPath)) return await serveFile(res, distDir, assetPath);
    if (await pathExists(path.join(distDir, "index.html"))) return await serveFile(res, distDir, "index.html");
    return sendText(res, 200, "AutoVT API is running. Build the frontend with npm run build to serve the UI.");
  } catch (error: any) {
    return sendJson(res, 500, { error: error.message || String(error) });
  }
}

async function listenWithPortFallback(startPort: number, maxAttempts = 10) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    const server = createServer(handleRequest);

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => {
          server.off("error", reject);
          resolve();
        });
      });

      const fallbackNote = port === startPort ? "" : `，默认端口 ${startPort} 被占用，已自动切换`;
      console.log(`AutoVT server running on http://localhost:${port}${fallbackNote}`);
      return;
    } catch (error: any) {
      server.close();
      if (error?.code !== "EADDRINUSE") throw error;
      console.warn(`Port ${port} is already in use, trying ${port + 1}...`);
    }
  }

  throw new Error(`Unable to find an available port from ${startPort} to ${startPort + maxAttempts - 1}`);
}

await ensureSeedData();
await listenWithPortFallback(PORT);
