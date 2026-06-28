import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  XCircle,
} from "lucide-react";
import { motion } from "motion/react";

type LoginMode = "none" | "storageState";
type StepStatus = "pass" | "fail" | "skipped";
type TaskStatus = "success" | "failure" | "running" | "auth_required" | "auth_expired";

interface StepConfig {
  id: string;
  name: string;
  type: string;
  description?: string;
  value?: string;
  timeout?: number;
  screenshot?: boolean;
}

interface TestCase {
  id: string;
  name: string;
  description: string;
  targetUrl: string;
  loginMode: LoginMode;
  authStatePath?: string;
  tags: string[];
  tutorial?: string;
  objective?: string;
  steps: StepConfig[];
  updatedAt: string;
}

interface TestStepResult {
  id: string;
  name: string;
  type: string;
  status: StepStatus;
  duration: number;
  error?: string;
  evidence?: { screenshot?: string; extractedText?: string };
}

interface TestResult {
  taskId: string;
  caseId: string;
  caseName: string;
  startTime: string;
  endTime?: string;
  targetUrl: string;
  status: TaskStatus;
  message?: string;
  steps: TestStepResult[];
  screenshots: string[];
  consoleErrors: string[];
  networkFailures: string[];
  aiSummary?: string;
  traceFile?: string;
}

interface HealthState {
  status: string;
  cozeAuthReady: boolean;
  interactiveAuthSupported: boolean;
}

interface AuthSession {
  id: string;
  status: "running" | "success" | "failure";
  startedAt: string;
  completedAt?: string;
  message: string;
  authPath?: string;
}

const defaultUrl = "https://www.coze.cn/space/7543460160883884075/library?force_stay=1";
const defaultObjective = "进入资源页面，创建一个工作流，添加大模型节点，填写 prompt，试运行并确认有输出。";
const defaultTutorial = "打开 Coze 资源/Library 页面，通过创建入口新建工作流，在画布中添加大模型节点，填写测试提示词，点击试运行，检查运行结果区域是否出现输出。";

function statusMeta(status: TaskStatus) {
  switch (status) {
    case "success":
      return { label: "通过", tone: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle2 };
    case "failure":
      return { label: "失败", tone: "text-rose-700 bg-rose-50 border-rose-200", icon: XCircle };
    case "auth_required":
      return { label: "需要登录态", tone: "text-amber-700 bg-amber-50 border-amber-200", icon: KeyRound };
    case "auth_expired":
      return { label: "登录过期", tone: "text-amber-700 bg-amber-50 border-amber-200", icon: KeyRound };
    default:
      return { label: "运行中", tone: "text-blue-700 bg-blue-50 border-blue-200", icon: Loader2 };
  }
}

function compactTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function App() {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [tasks, setTasks] = useState<TestResult[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [targetUrl, setTargetUrl] = useState(defaultUrl);
  const [objective, setObjective] = useState(defaultObjective);
  const [tutorial, setTutorial] = useState(defaultTutorial);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isStartingAuth, setIsStartingAuth] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authJson, setAuthJson] = useState("");
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) || cases[0],
    [cases, selectedCaseId]
  );
  const selectedTask = useMemo(
    () => tasks.find((item) => item.taskId === selectedTaskId) || tasks[0],
    [tasks, selectedTaskId]
  );

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function refresh() {
    const [healthData, caseData, taskData] = await Promise.all([
      fetchJson<HealthState>("/api/health"),
      fetchJson<TestCase[]>("/api/cases"),
      fetchJson<TestResult[]>("/api/tasks"),
    ]);
    setHealth(healthData);
    setCases(caseData);
    setTasks(taskData);
    if (!selectedCaseId && caseData[0]) setSelectedCaseId(caseData[0].id);
    if (!selectedTaskId && taskData[0]) setSelectedTaskId(taskData[0].taskId);
  }

  useEffect(() => {
    refresh().catch(console.error);
    const timer = window.setInterval(() => refresh().catch(console.error), 4000);
    return () => window.clearInterval(timer);
  }, []);

  async function generateCase() {
    setIsGenerating(true);
    try {
      const generated = await fetchJson<TestCase>("/api/cases/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl, objective, tutorial, loginMode: "storageState" }),
      });
      await refresh();
      setSelectedCaseId(generated.id);
    } finally {
      setIsGenerating(false);
    }
  }

  async function runCase(caseId?: string) {
    const id = caseId || selectedCase?.id;
    if (!id) return;
    setIsRunning(true);
    try {
      const result = await fetchJson<{ taskId: string }>("/api/test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id, targetUrl }),
      });
      setSelectedTaskId(result.taskId);
      await refresh();
    } finally {
      setIsRunning(false);
    }
  }

  async function uploadAuth() {
    const storageState = JSON.parse(authJson);
    await fetchJson("/api/auth/storage-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "coze-user.json", storageState }),
    });
    setAuthJson("");
    await refresh();
  }

  async function startInteractiveAuth() {
    setIsStartingAuth(true);
    try {
      const session = await fetchJson<AuthSession>("/api/auth/interactive/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl, name: "coze-user.json" }),
      });
      setAuthSession(session);

      const poll = window.setInterval(async () => {
        try {
          const next = await fetchJson<AuthSession>(`/api/auth/interactive/${session.id}`);
          setAuthSession(next);
          if (next.status !== "running") {
            window.clearInterval(poll);
            await refresh();
          }
        } catch (error) {
          window.clearInterval(poll);
          console.error(error);
        }
      }, 2000);
    } catch (error: any) {
      setAuthSession({
        id: "local-error",
        status: "failure",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        message: error.message,
      });
    } finally {
      setIsStartingAuth(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">AutoVT 回归测试工作台</h1>
              <p className="text-xs text-zinc-500">教程生成案例，Playwright 自动执行，截图和日志留证据</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-md border px-3 py-1.5 text-xs ${health?.cozeAuthReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              {health?.cozeAuthReady ? "Coze 登录态已就绪" : "Coze 登录态未配置"}
            </span>
            <button onClick={() => refresh()} className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm hover:bg-zinc-100">
              <RefreshCw className="h-4 w-4" /> 刷新
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] grid-cols-12 gap-5 px-5 py-5">
        <section className="col-span-12 space-y-5 lg:col-span-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-4 w-4 text-blue-600" />
              <h2 className="font-semibold">生成测试案例</h2>
            </div>
            <label className="mb-2 block text-xs font-medium text-zinc-600">目标网址</label>
            <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} className="mb-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <label className="mb-2 block text-xs font-medium text-zinc-600">你希望测试什么</label>
            <textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} className="mb-4 w-full resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <label className="mb-2 block text-xs font-medium text-zinc-600">教程或操作说明</label>
            <textarea value={tutorial} onChange={(event) => setTutorial(event.target.value)} rows={6} className="mb-4 w-full resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500" />
            <button onClick={generateCase} disabled={isGenerating} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300">
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 生成并保存案例
            </button>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-amber-600" />
              <h2 className="font-semibold">登录态</h2>
            </div>
            <p className="mb-3 text-sm leading-6 text-zinc-600">本地运行 AutoVT 时，可以直接弹出浏览器登录并自动保存。Render 云端无法把服务器浏览器窗口弹到你的电脑上，因此保留粘贴 JSON 作为备用。</p>
            <button onClick={startInteractiveAuth} disabled={isStartingAuth || health?.interactiveAuthSupported === false} className="mb-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-amber-600 px-3 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-zinc-300">
              {isStartingAuth || authSession?.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} 打开登录窗口并自动保存
            </button>
            {health?.interactiveAuthSupported === false && (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">当前是云端环境，不支持弹出可见浏览器。请本地运行 AutoVT 使用一键登录，或粘贴 storageState。</div>
            )}
            {authSession && (
              <div className={`mb-3 rounded-md border p-3 text-xs leading-5 ${authSession.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : authSession.status === "failure" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
                {authSession.message}
              </div>
            )}
            <textarea value={authJson} onChange={(event) => setAuthJson(event.target.value)} placeholder="粘贴 playwright storageState JSON" rows={4} className="mb-3 w-full resize-none rounded-md border border-zinc-300 px-3 py-2 text-xs font-mono outline-none focus:border-amber-500" />
            <button onClick={uploadAuth} disabled={!authJson.trim()} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
              <Save className="h-4 w-4" /> 保存登录态
            </button>
          </div>
        </section>

        <section className="col-span-12 space-y-5 lg:col-span-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-emerald-600" />
                <h2 className="font-semibold">案例库</h2>
              </div>
              <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600">{cases.length}</span>
            </div>
            <div className="space-y-3">
              {cases.map((item) => (
                <button key={item.id} onClick={() => setSelectedCaseId(item.id)} className={`w-full rounded-lg border p-3 text-left transition ${selectedCase?.id === item.id ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white hover:bg-zinc-50"}`}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-xs text-zinc-500">{item.steps.length} 步</span>
                  </div>
                  <p className="line-clamp-2 text-sm leading-5 text-zinc-600">{item.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.tags.map((tag) => <span key={tag} className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">{tag}</span>)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedCase && (
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{selectedCase.name}</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">{selectedCase.description}</p>
                </div>
                <button onClick={() => runCase(selectedCase.id)} disabled={isRunning} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-zinc-300">
                  {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 运行
                </button>
              </div>
              <div className="space-y-2">
                {selectedCase.steps.map((step, index) => (
                  <div key={step.id} className="flex gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white text-xs font-medium text-zinc-500">{index + 1}</span>
                    <div>
                      <div className="text-sm font-medium">{step.name}</div>
                      <div className="text-xs text-zinc-500">{step.type}{step.screenshot ? " · 截图" : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="col-span-12 space-y-5 lg:col-span-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <FileText className="h-4 w-4 text-purple-600" />
              <h2 className="font-semibold">运行报告</h2>
            </div>
            <div className="mb-4 max-h-48 space-y-2 overflow-auto pr-1">
              {tasks.map((task) => {
                const meta = statusMeta(task.status);
                const Icon = meta.icon;
                return (
                  <button key={task.taskId} onClick={() => setSelectedTaskId(task.taskId)} className={`w-full rounded-md border p-3 text-left ${selectedTask?.taskId === task.taskId ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-white hover:bg-zinc-50"}`}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{task.caseName || task.taskId}</span>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-xs ${meta.tone}`}>
                        <Icon className={`h-3 w-3 ${task.status === "running" ? "animate-spin" : ""}`} /> {meta.label}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500">{compactTime(task.startTime)}</div>
                  </button>
                );
              })}
            </div>

            {selectedTask ? <Report task={selectedTask} onZoom={setZoomImage} /> : <EmptyReport />}
          </div>
        </section>
      </main>

      {zoomImage && (
        <div onClick={() => setZoomImage(null)} className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-6">
          <img src={zoomImage} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}

function EmptyReport() {
  return (
    <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 text-zinc-500">
      <Clock3 className="mb-2 h-8 w-8" />
      <p className="text-sm">还没有运行记录</p>
    </div>
  );
}

function Report({ task, onZoom }: { task: TestResult; onZoom: (src: string) => void }) {
  const meta = statusMeta(task.status);
  const Icon = meta.icon;
  const duration = task.endTime ? Math.round((new Date(task.endTime).getTime() - new Date(task.startTime).getTime()) / 1000) : undefined;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className={`rounded-lg border p-3 ${meta.tone}`}>
        <div className="mb-1 flex items-center gap-2 font-medium">
          <Icon className={`h-4 w-4 ${task.status === "running" ? "animate-spin" : ""}`} /> {meta.label}
        </div>
        <div className="text-sm leading-6">{task.message || task.aiSummary || "测试正在执行或已完成。"}</div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Info label="步骤" value={`${task.steps.length}`} />
        <Info label="截图" value={`${task.screenshots.length}`} />
        <Info label="耗时" value={duration ? `${duration}s` : "运行中"} />
      </div>

      {task.aiSummary && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <div className="mb-2 text-xs font-semibold text-zinc-500">AI 总结</div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">{task.aiSummary}</p>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-semibold text-zinc-500">步骤结果</div>
        <div className="space-y-2">
          {task.steps.map((step) => (
            <div key={step.id} className="rounded-md border border-zinc-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {step.status === "pass" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />}
                  <span className="text-sm font-medium">{step.name}</span>
                </div>
                <span className="text-xs text-zinc-500">{step.duration}ms</span>
              </div>
              {step.error && <p className="mt-2 rounded bg-rose-50 p-2 text-xs leading-5 text-rose-700">{step.error}</p>}
            </div>
          ))}
        </div>
      </div>

      {task.screenshots.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-500"><ImageIcon className="h-3 w-3" />截图证据</div>
          <div className="grid grid-cols-2 gap-2">
            {task.screenshots.slice(-6).map((shot) => {
              const src = `/storage/${task.taskId}/${shot}`;
              return <button key={shot} onClick={() => onZoom(src)} className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-100"><img src={src} className="h-28 w-full object-cover" /></button>;
            })}
          </div>
        </div>
      )}

      {(task.consoleErrors.length > 0 || task.networkFailures.length > 0) && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-950 p-3 text-xs text-zinc-200">
          <div className="mb-2 flex items-center gap-2 font-semibold text-amber-300"><AlertCircle className="h-3 w-3" />错误记录</div>
          {[...task.consoleErrors.slice(0, 4), ...task.networkFailures.slice(0, 4)].map((item, index) => <div key={index} className="border-b border-zinc-800 py-1 last:border-0">{item}</div>)}
        </div>
      )}

      {task.traceFile && <a className="inline-flex text-sm font-medium text-blue-700 hover:underline" href={`/storage/${task.taskId}/${task.traceFile}`}>下载 Playwright trace</a>}
    </motion.div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
      <div className="text-zinc-500">{label}</div>
      <div className="mt-1 font-semibold text-zinc-900">{value}</div>
    </div>
  );
}
