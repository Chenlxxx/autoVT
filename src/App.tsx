import React, { useState, useEffect } from "react";
import { Play, List, CheckCircle, XCircle, Clock, Image as ImageIcon, AlertCircle, ChevronRight, ExternalLink, Activity } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface TestStep {
  name: string;
  status: "pass" | "fail";
  duration: number;
  error?: string;
}

interface TestResult {
  taskId: string;
  startTime: string;
  endTime?: string;
  targetUrl: string;
  status: "success" | "failure" | "running";
  steps: TestStep[];
  screenshots: string[];
  consoleErrors: string[];
  networkFailures: string[];
  finalOutput?: string;
  aiSummary?: string;
}

export default function App() {
  const [targetUrl, setTargetUrl] = useState("https://www.coze.cn/space/7543460160883884075/develop");
  const [tasks, setTasks] = useState<TestResult[]>([]);
  const [selectedTask, setSelectedTask] = useState<TestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      setTasks(data);
    } catch (err) {
      console.error("Failed to fetch tasks", err);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  const runTest = async () => {
    setIsRunning(true);
    try {
      const res = await fetch("/api/test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl }),
      });
      const data = await res.json();
      console.log("Test started", data);
      fetchTasks();
    } catch (err) {
      console.error("Failed to run test", err);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Activity className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Coze 自动化测试平台</h1>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            className="w-96 px-4 py-2 bg-slate-100 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
            placeholder="目标 URL"
          />
          <button
            onClick={runTest}
            disabled={isRunning}
            className={`flex items-center gap-2 px-6 py-2 rounded-md font-medium transition-all ${
              isRunning 
                ? "bg-slate-200 text-slate-500 cursor-not-allowed" 
                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm hover:shadow-md"
            }`}
          >
            <Play className={`w-4 h-4 ${isRunning ? "animate-pulse" : ""}`} />
            {isRunning ? "运行中..." : "开始测试"}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-12 gap-6">
        {/* Task List */}
        <div className="col-span-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <List className="w-4 h-4" />
              最近任务
            </h2>
            <span className="text-xs bg-slate-200 px-2 py-0.5 rounded-full text-slate-600 font-medium">
              {tasks.length}
            </span>
          </div>
          <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-180px)] pr-2">
            {tasks.map((task) => (
              <motion.div
                layoutId={task.taskId}
                key={task.taskId}
                onClick={() => setSelectedTask(task)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedTask?.taskId === task.taskId
                    ? "bg-white border-indigo-500 shadow-md ring-1 ring-indigo-500"
                    : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {task.status === "success" ? (
                      <CheckCircle className="w-5 h-5 text-emerald-500" />
                    ) : task.status === "failure" ? (
                      <XCircle className="w-5 h-5 text-rose-500" />
                    ) : (
                      <Clock className="w-5 h-5 text-amber-500 animate-spin" />
                    )}
                    <span className="font-mono text-xs text-slate-500">
                      ID: {task.taskId.slice(0, 8)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {new Date(task.startTime).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-sm font-medium truncate mb-1">{task.targetUrl}</div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {task.endTime 
                      ? `${Math.round((new Date(task.endTime).getTime() - new Date(task.startTime).getTime()) / 1000)}秒`
                      : "运行中..."}
                  </span>
                  <span className="flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" />
                    {task.screenshots?.length || 0} 张截图
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Task Details */}
        <div className="col-span-8">
          <AnimatePresence mode="wait">
            {selectedTask ? (
              <motion.div
                key={selectedTask.taskId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[calc(100vh-180px)]"
              >
                {/* Task Header */}
                <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-bold tracking-tight">任务详情报告</h2>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${
                        selectedTask.status === "success" ? "bg-emerald-100 text-emerald-700" : 
                        selectedTask.status === "failure" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {selectedTask.status === "success" ? "成功" : selectedTask.status === "failure" ? "失败" : "运行中"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-6 text-sm">
                    <div>
                      <div className="text-slate-400 mb-1">开始时间</div>
                      <div className="font-medium">{new Date(selectedTask.startTime).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 mb-1">耗时</div>
                      <div className="font-medium">
                        {selectedTask.endTime 
                          ? `${Math.round((new Date(selectedTask.endTime).getTime() - new Date(selectedTask.startTime).getTime()) / 1000)} 秒`
                          : "进行中"}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 mb-1">目标地址</div>
                      <div className="font-medium truncate max-w-[200px]">{selectedTask.targetUrl}</div>
                    </div>
                  </div>
                </div>

                <div className="p-8 space-y-8">
                  {/* AI Summary */}
                  {selectedTask.aiSummary && (
                    <section>
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-indigo-500" />
                        AI 智能分析结论
                      </h3>
                      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 text-indigo-900 leading-relaxed whitespace-pre-wrap text-sm italic">
                        {selectedTask.aiSummary}
                      </div>
                    </section>
                  )}

                  {/* Steps Timeline */}
                  <section>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">执行时间轴</h3>
                    <div className="space-y-4">
                      {selectedTask.steps?.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-4">
                          <div className="mt-1">
                            {step.status === "pass" ? (
                              <CheckCircle className="w-5 h-5 text-emerald-500" />
                            ) : (
                              <XCircle className="w-5 h-5 text-rose-500" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-slate-800">{step.name}</span>
                              <span className="text-xs text-slate-400">{step.duration}ms</span>
                            </div>
                            {step.error && (
                              <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100 mt-1 font-mono">
                                <div className="font-bold mb-1">错误详情：</div>
                                {step.error}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Screenshots */}
                  {selectedTask.screenshots?.length > 0 && (
                    <section>
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">执行截图 (点击放大)</h3>
                      <div className="grid grid-cols-2 gap-4">
                        {selectedTask.screenshots.map((src, idx) => (
                          <div 
                            key={idx} 
                            onClick={() => setZoomImage(`/storage/${selectedTask.taskId}/${src}`)}
                            className="group relative rounded-xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-zoom-in"
                          >
                            <img 
                              src={`/storage/${selectedTask.taskId}/${src}`} 
                              alt={`Screenshot ${idx}`}
                              className="w-full h-48 object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <span className="text-white text-xs font-bold uppercase tracking-widest bg-black/60 px-3 py-1 rounded-full">
                                查看大图
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Logs & Errors */}
                  {(selectedTask.consoleErrors?.length > 0 || selectedTask.networkFailures?.length > 0) && (
                    <section className="grid grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-rose-500" />
                          控制台错误日志 (Console)
                        </h3>
                        <div className="text-[10px] text-slate-500 mb-2">说明：网页代码执行过程中的内部报错，通常不影响主流程。</div>
                        <div className="bg-slate-900 rounded-xl p-4 max-h-48 overflow-y-auto font-mono text-[10px] text-rose-400 space-y-1">
                          {selectedTask.consoleErrors.map((err, i) => (
                            <div key={i} className="border-b border-slate-800 pb-1 last:border-0">{err}</div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500" />
                          网络请求失败 (Network)
                        </h3>
                        <div className="text-[10px] text-slate-500 mb-2">说明：网页尝试加载资源（图片、脚本）但失败了，可能是网络波动。</div>
                        <div className="bg-slate-900 rounded-xl p-4 max-h-48 overflow-y-auto font-mono text-[10px] text-amber-400 space-y-1">
                          {selectedTask.networkFailures.map((err, i) => (
                            <div key={i} className="border-b border-slate-800 pb-1 last:border-0">{err}</div>
                          ))}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Final Output */}
                  {selectedTask.finalOutput && (
                    <section>
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">最终执行输出</h3>
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 font-medium text-slate-700">
                        {selectedTask.finalOutput}
                      </div>
                    </section>
                  )}
                </div>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[calc(100vh-180px)] text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
                <div className="bg-slate-100 p-4 rounded-full mb-4">
                  <ChevronRight className="w-8 h-8" />
                </div>
                <p className="text-lg font-medium">请选择一个任务查看详细报告</p>
                <p className="text-sm">或者点击上方按钮开始新的测试</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Image Zoom Modal */}
      <AnimatePresence>
        {zoomImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoomImage(null)}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          >
            <motion.img 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={zoomImage} 
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              referrerPolicy="no-referrer"
            />
            <button className="absolute top-6 right-6 text-white/70 hover:text-white bg-white/10 p-2 rounded-full backdrop-blur-md">
              <XCircle className="w-8 h-8" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
