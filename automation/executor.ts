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

async function clickTextCenter(page: Page, text: string, timeout = 5000) {
  const locator = page.getByText(text, { exact: false }).last();
  await locator.waitFor({ state: "visible", timeout });
  const box = await locator.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
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

class StepRecoveryError extends Error {
  diagnostics: string[];
  recoveryActions: string[];
  pageState: Record<string, unknown>;
  needsHumanInput?: {
    reason: string;
    question: string;
    suggestions: string[];
  };

  constructor(
    message: string,
    options: {
      diagnostics?: string[];
      recoveryActions?: string[];
      pageState?: Record<string, unknown>;
      needsHumanInput?: {
        reason: string;
        question: string;
        suggestions: string[];
      };
    } = {}
  ) {
    super(message);
    this.name = "StepRecoveryError";
    this.diagnostics = options.diagnostics || [];
    this.recoveryActions = options.recoveryActions || [];
    this.pageState = options.pageState || {};
    this.needsHumanInput = options.needsHumanInput;
  }
}

async function getBodyText(page: Page) {
  try {
    return await page.locator("body").innerText({ timeout: 3000 });
  } catch {
    return "";
  }
}

async function detectCozeState(page: Page) {
  const bodyText = await getBodyText(page);
  const url = page.url();
  const has = (pattern: RegExp) => pattern.test(bodyText);
  const workflowEditorSignals = [
    has(/开始节点|结束节点/),
    has(/试运行|运行记录|输入参数/),
    has(/添加节点|新增节点|大模型|LLM/),
    /workflow|canvas|editor/i.test(url),
  ].filter(Boolean).length;

  return {
    url,
    textSample: bodyText.replace(/\s+/g, " ").slice(0, 500),
    isResourceLibrary: has(/资源库|资源|工作流|知识库|插件/),
    isCreateTypeDialog: has(/创建智能体/) && has(/创建应用/),
    hasWorkflowOption: has(/创建工作流|新建工作流|工作流/),
    isWorkflowEditor: workflowEditorSignals >= 2,
    workflowEditorSignals,
  };
}

async function closeCozeDialogIfOpen(page: Page) {
  const closeButtons = [
    page.locator(".arco-modal-close-icon").first(),
    page.getByRole("button", { name: /关闭|Close/i }).first(),
    page.locator('[aria-label="Close"]').first(),
    page.locator("button").filter({ hasText: /^×$/ }).first(),
  ];

  for (const button of closeButtons) {
    try {
      if (await isVisible(button, 500)) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(500);
        return true;
      }
    } catch {
      // Try the next close affordance.
    }
  }

  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    return true;
  } catch {
    return false;
  }
}

async function dismissCozeCoachMarks(page: Page, recoveryActions: string[]) {
  const labels = ["知道了", "我知道了", "关闭", "跳过"];
  try {
    const dismissed = await clickFirst(page, textLocators(page, labels, "button"), 3000);
    if (dismissed) {
      recoveryActions.push("关闭新手引导/浮层提示。");
      await page.waitForTimeout(600);
    }
  } catch {
    // No coach mark is fine.
  }
}

async function dragBetweenPoints(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function connectCozeNodes(page: Page, recoveryActions: string[]) {
  try {
    const startBox = await page.getByText("开始", { exact: true }).first().boundingBox();
    const llmBox = await page.getByText("大模型", { exact: false }).first().boundingBox();
    const endBox = await page.getByText("结束", { exact: true }).first().boundingBox();
    if (!startBox || !llmBox || !endBox) {
      recoveryActions.push("未能定位开始/大模型/结束节点，跳过自动连线。");
      return false;
    }

    const startOut = { x: startBox.x + 315, y: startBox.y + 20 };
    const llmIn = { x: llmBox.x - 45, y: llmBox.y + 58 };
    const llmOut = { x: llmBox.x + 315, y: llmBox.y + 66 };
    const endIn = { x: endBox.x - 45, y: endBox.y + 20 };

    await dragBetweenPoints(page, startOut, llmIn);
    await page.waitForTimeout(600);
    await dragBetweenPoints(page, llmOut, endIn);
    await page.waitForTimeout(900);
    recoveryActions.push("尝试自动连线：开始 -> 大模型 -> 结束。");
    return true;
  } catch {
    recoveryActions.push("自动连线失败，继续尝试试运行以获取诊断。");
    return false;
  }
}

async function assertNoCozeRunErrors(page: Page, recoveryActions: string[]) {
  const bodyText = await getBodyText(page);
  const hasErrorList = /错误列表|引用变量不存在|运行失败|执行失败|报错/.test(bodyText);
  if (!hasErrorList) return;

  throw new StepRecoveryError("试运行未成功：页面显示错误列表或运行错误。", {
    diagnostics: ["检测到 Coze 错误列表，不能把常驻的“试运行/输出”文字当作成功。"],
    recoveryActions,
    pageState: await detectCozeState(page),
    needsHumanInput: {
      reason: "工作流节点已创建，但变量引用或连线仍不满足 Coze 运行校验。",
      question: "请确认大模型节点输出应如何连接到结束节点，或者是否需要配置结束节点输出变量。",
      suggestions: [
        "在 Coze 页面手动连接 Start -> LLM -> End 并确认结束节点输出变量。",
        "把教程补充为包含连线和结束节点变量配置的步骤。",
        "后续可接入视觉模型识别节点端口，并生成更稳定的拖拽坐标。",
      ],
    },
  });
}

async function assertCozeWorkflowEditor(page: Page, recoveryActions: string[]) {
  const state = await detectCozeState(page);
  if (state.isWorkflowEditor) return state;

  if (state.isCreateTypeDialog) {
    throw new StepRecoveryError("创建工作流未完成：当前停留在“创建智能体 / 创建应用”的类型选择弹窗，而不是工作流编辑器。", {
      diagnostics: [
        "Coze 页面当前创建入口与教程目标不一致。",
        "旧逻辑只检测到“工作流/节点/运行”等宽泛文字就判定成功，导致误报。",
      ],
      recoveryActions,
      pageState: state,
      needsHumanInput: {
        reason: "页面没有暴露可自动确认的“创建工作流”入口。",
        question: "请确认当前 Coze 空间里创建工作流的真实入口在哪里，或手动打开到工作流编辑器后重新录制/保存步骤。",
        suggestions: [
          "检查是否应先点击顶部“工作流”分类后再点击“+ 资源”。",
          "检查工作流是否迁移到“项目开发”或其他入口。",
          "如果你的私有页面可接入代码仓，建议给创建按钮增加 data-testid，避免依赖视觉猜测。",
        ],
      },
    });
  }

  throw new StepRecoveryError("创建工作流未完成：没有进入工作流编辑器。", {
    diagnostics: ["未检测到开始节点、试运行按钮、节点面板或工作流编辑器 URL。"],
    recoveryActions,
    pageState: state,
    needsHumanInput: {
      reason: "页面状态和教程目标不匹配。",
      question: "请确认创建工作流后的成功页面应包含哪些稳定文字或控件。",
      suggestions: ["提供更精确教程步骤。", "在目标页面关键控件添加 data-testid。"],
    },
  });
}

async function createCozeWorkflow(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
  const recoveryActions: string[] = [];

  if (!(await checkAuth(page))) {
    throw new Error("登录态无效，页面跳转到了登录或显示登录入口。");
  }

  const firstState = await detectCozeState(page);
  if (firstState.isWorkflowEditor) return;

  try {
    const clickedWorkflowTab = await clickFirst(
      page,
      [
        page.getByRole("tab", { name: /工作流/i }),
        page.locator('[class*="tab"]:has-text("工作流")'),
        page.locator("a:has-text(\"工作流\")"),
        page.getByText("工作流", { exact: true }),
      ],
      5000
    );
    if (clickedWorkflowTab) {
      recoveryActions.push("先切换到顶部“工作流”分类。");
      await page.waitForTimeout(900);
    }
  } catch {
    recoveryActions.push("未找到可点击的顶部“工作流”分类，继续尝试创建入口。");
  }

  const createAttempts = [
    {
      name: "直接点击工作流创建入口",
      labels: ["创建工作流", "新建工作流"],
      timeout: 8000,
    },
    {
      name: "点击右上角“+ 资源”主按钮",
      locators: [
        page.locator('button:has-text("资源")').last(),
        page.locator('.arco-btn-primary:has-text("资源")').last(),
        page.locator('button').filter({ hasText: /资源/ }).last(),
      ],
      timeout: 8000,
    },
    {
      name: "点击资源创建入口",
      labels: ["创建资源", "新建资源", "+ 资源", "资源", "创建", "新建"],
      timeout: 12000,
    },
  ];

  let clickedCreate = false;
  for (const attempt of createAttempts) {
    try {
      const locators = "locators" in attempt ? attempt.locators : textLocators(page, attempt.labels, "button");
      clickedCreate = await clickFirst(page, locators, attempt.timeout);
      if (clickedCreate) {
        recoveryActions.push(attempt.name);
        break;
      }
    } catch {
      recoveryActions.push(`${attempt.name}失败。`);
    }
  }

  if (!clickedCreate) {
    throw new StepRecoveryError("没有找到创建工作流入口。", {
      diagnostics: ["页面上没有匹配“创建工作流/新建工作流/创建资源”的可点击元素。"],
      recoveryActions,
      pageState: await detectCozeState(page),
      needsHumanInput: {
        reason: "缺少稳定创建入口。",
        question: "请确认 Coze 当前版本创建工作流的入口文字或位置。",
        suggestions: ["在页面上手动点一次创建工作流，观察入口文字。", "将步骤改为先进入真实工作流页面 URL。"],
      },
    });
  }

  await page.waitForTimeout(1000);

  let state = await detectCozeState(page);
  if (state.isCreateTypeDialog) {
    recoveryActions.push("检测到错误分支：弹出“创建智能体/创建应用”，尝试关闭并重新选择工作流分类。");
    await closeCozeDialogIfOpen(page);
    try {
      await clickFirst(page, [page.getByText("工作流", { exact: true }), page.getByRole("tab", { name: /工作流/i })], 5000);
      await page.waitForTimeout(800);
      recoveryActions.push("关闭错误弹窗后再次点击“工作流”分类。");
      await clickFirst(page, textLocators(page, ["创建工作流", "新建工作流", "+ 资源", "资源", "创建"], "button"), 8000);
      recoveryActions.push("重新点击创建入口。");
      await page.waitForTimeout(1000);
    } catch {
      recoveryActions.push("自动重试未能找到工作流创建入口。");
    }
  }

  try {
    await clickFirst(page, textLocators(page, ["工作流", "Workflow", "AI 工作流"], "menuitem"), 5000);
    recoveryActions.push("在创建菜单中选择“工作流”。");
    await page.waitForTimeout(800);
  } catch {
    // No workflow choice appeared; continue with dialog/editor detection.
  }

  const workflowName = `AutoVT_${Date.now()}`;
  const nameLocators = [
    page.getByPlaceholder(/名称|名字|name/i),
    page.locator('input[placeholder*="名称"]'),
    page.locator('input[placeholder*="名字"]'),
    page.locator(".arco-modal input").first(),
    page.locator("input").first(),
  ];

  try {
    if (await fillFirst(page, nameLocators, workflowName, 5000)) {
      recoveryActions.push("填写合法工作流名称：字母开头，仅包含字母、数字和下划线。");
    }
  } catch {
    recoveryActions.push("没有出现名称输入框，可能已自动创建或仍停留在选择弹窗。");
  }

  const descriptionLocators = [
    page.getByPlaceholder(/描述|description|调用此工作流/i),
    page.locator('textarea[placeholder*="描述"]'),
    page.locator("textarea").first(),
  ];

  try {
    if (await fillFirst(page, descriptionLocators, "AutoVT 自动化回归测试创建的临时工作流", 5000)) {
      recoveryActions.push("填写工作流描述以满足必填校验。");
    }
  } catch {
    recoveryActions.push("没有找到工作流描述输入框。");
  }

  try {
    await clickFirst(
      page,
      [
        page.locator(".arco-modal-footer button:not([disabled]):has-text(\"确认\")").last(),
        page.locator("button:not([disabled]):has-text(\"确认\")").last(),
        page.locator("button:not([disabled]):has-text(\"创建\")").last(),
        ...textLocators(page, ["确认", "确定", "创建", "完成", "进入编辑"], "button"),
      ],
      10000
    );
    recoveryActions.push("点击确认/创建按钮。");
  } catch {
    recoveryActions.push("没有出现确认按钮，进入最终状态判定。");
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    state = await detectCozeState(page);
    if (state.isWorkflowEditor) return;
    if (state.isCreateTypeDialog) break;
    await page.waitForTimeout(1000);
  }

  await assertCozeWorkflowEditor(page, recoveryActions);
}

async function cozeAddAndRunLLM(page: Page, prompt: string) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  const recoveryActions: string[] = [];
  const state = await detectCozeState(page);
  if (!state.isWorkflowEditor) {
    throw new StepRecoveryError("无法添加大模型节点：当前页面不是工作流编辑器。", {
      diagnostics: ["上一步没有真正进入工作流画布，继续添加节点没有意义。"],
      recoveryActions: ["提前中止后续节点操作，避免长时间无效等待。"],
      pageState: state,
      needsHumanInput: {
        reason: "前置页面状态错误。",
        question: "请先确认创建工作流步骤如何进入真实工作流编辑器。",
        suggestions: ["修正创建工作流入口。", "提供工作流编辑器的直接 URL 或更精确教程。"],
      },
    });
  }

  await dismissCozeCoachMarks(page, recoveryActions);

  const addLabels = ["添加节点", "新增节点", "节点", "+", "添加"];
  try {
    await clickFirst(
      page,
      [
        page.locator('button:has-text("添加节点")').last(),
        page.locator('[role="button"]:has-text("添加节点")').last(),
        page.getByText("添加节点", { exact: false }).last(),
        ...textLocators(page, addLabels, "button"),
      ],
      10000
    );
    recoveryActions.push("点击“添加节点”打开节点选择面板。");
    await page.waitForTimeout(800);
  } catch {
    try {
      if (await clickTextCenter(page, "添加节点", 4000)) {
        recoveryActions.push("通过文字坐标兜底点击“添加节点”。");
        await page.waitForTimeout(800);
      }
    } catch {
      recoveryActions.push("未找到“添加节点”按钮，尝试直接查找节点面板。");
    }
  }

  try {
    const searched = await fillFirst(
      page,
      [
        page.getByPlaceholder(/搜索|节点|请输入/i),
        page.locator('input[placeholder*="搜索"]'),
        page.locator('input[placeholder*="节点"]'),
      ],
      "大模型",
      3000
    );
    if (searched) {
      recoveryActions.push("在节点面板搜索“大模型”。");
      await page.waitForTimeout(800);
    }
  } catch {
    // Search is optional.
  }

  const llmLocators = [
    page.getByText("大模型", { exact: false }),
    page.getByText("模型调用", { exact: false }),
    page.getByText("调用模型", { exact: false }),
    page.getByText("LLM", { exact: false }),
    page.getByText("模型", { exact: false }),
    page.locator('[draggable="true"]:has-text("大模型")'),
    page.locator('[class*="node"]:has-text("大模型")'),
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

  if (!addedNode) {
    throw new StepRecoveryError("没有找到或无法添加大模型节点。", {
      diagnostics: ["已进入工作流编辑器，但节点选择面板中没有检测到“大模型/LLM/模型”入口。"],
      recoveryActions,
      pageState: await detectCozeState(page),
      needsHumanInput: {
        reason: "Coze 节点面板结构或名称和预期不一致。",
        question: "请确认当前版本 Coze 的大模型节点名称，或是否需要先在节点面板里搜索“大模型”。",
        suggestions: [
          "如果节点面板有搜索框，输入“大模型”后再选择。",
          "把目标页面教程补充到“点击添加节点后选择哪个分类/节点”。",
          "在你的私有页面接入 data-testid 后，可直接定位节点模板。",
        ],
      },
    });
  }

  await page.waitForTimeout(1600);
  await connectCozeNodes(page, recoveryActions);

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

  try {
    const filledRunInput = await fillFirst(
      page,
      [
        page.locator('input[placeholder*="input"]').last(),
        page.locator('input').last(),
        page.locator('textarea').last(),
      ],
      "hello AutoVT",
      5000
    );
    if (filledRunInput) {
      recoveryActions.push("填写试运行输入 input。");
      await clickFirst(
        page,
        [
          page.locator('button:has-text("试运行")').last(),
          page.locator('[role="button"]:has-text("试运行")').last(),
        ],
        5000
      );
      recoveryActions.push("再次点击右侧试运行按钮。");
    }
  } catch {
    recoveryActions.push("未能填写右侧试运行输入，继续读取运行结果。");
  }

  const successTexts = ["hello AutoVT", "运行成功", "执行成功", "输出", "结果", "完成"];
  await waitForAnyText(page, successTexts, 30000);
  await page.waitForTimeout(1200);
  await assertNoCozeRunErrors(page, recoveryActions);
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
        if (error instanceof StepRecoveryError) {
          stepResult.evidence.diagnostics = error.diagnostics;
          stepResult.evidence.recoveryActions = error.recoveryActions;
          stepResult.evidence.pageState = error.pageState;
          stepResult.evidence.needsHumanInput = error.needsHumanInput;
          result.diagnostics = [
            ...(result.diagnostics || []),
            ...error.diagnostics,
            ...error.recoveryActions.map((action) => `自修复动作：${action}`),
          ];
        }
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




