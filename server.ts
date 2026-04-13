import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { runCozeTest } from "./automation/coze-test.ts";
import { analyzeResult } from "./server/gemini.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  app.use(express.json());

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV || "development" });
  });

  // Ensure storage directory exists
  const storageDir = path.join(process.cwd(), "storage");
  await fs.ensureDir(storageDir);

  // API Routes
  app.post("/api/test/run", async (req, res) => {
    const { targetUrl } = req.body;
    const taskId = uuidv4();
    const taskDir = path.join(storageDir, taskId);
    await fs.ensureDir(taskDir);

    // Run test in background
    runCozeTest(taskId, targetUrl, taskDir)
      .then(async (result) => {
        // Analyze with Gemini
        const aiSummary = await analyzeResult(result, taskDir);
        result.aiSummary = aiSummary;
        
        // Save final result
        await fs.writeJson(path.join(taskDir, "result.json"), result, { spaces: 2 });
      })
      .catch(async (error) => {
        console.error(`Task ${taskId} failed:`, error);
        const failedResult = {
          taskId,
          status: "failure",
          error: error.message,
          endTime: new Date().toISOString(),
        };
        await fs.writeJson(path.join(taskDir, "result.json"), failedResult, { spaces: 2 });
      });

    res.json({ taskId, message: "Test started" });
  });

  app.get("/api/tasks", async (req, res) => {
    const dirs = await fs.readdir(storageDir);
    const tasks = await Promise.all(
      dirs.map(async (id) => {
        const resultPath = path.join(storageDir, id, "result.json");
        if (await fs.pathExists(resultPath)) {
          return fs.readJson(resultPath);
        }
        return { taskId: id, status: "running" };
      })
    );
    res.json(tasks.sort((a, b) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime()));
  });

  app.get("/api/tasks/:id", async (req, res) => {
    const resultPath = path.join(storageDir, req.params.id, "result.json");
    if (await fs.pathExists(resultPath)) {
      const result = await fs.readJson(resultPath);
      res.json(result);
    } else {
      res.status(404).json({ error: "Task not found" });
    }
  });

  // Serve screenshots
  app.use("/storage", express.static(storageDir));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      root: process.cwd(),
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
