import { FlowConfig } from "../types.ts";

export const cozeCreateAgentFlow: FlowConfig = {
  name: "Coze 创建智能体流程",
  description: "自动登录 Coze，创建名为 testVT 的智能体并进入开发页面",
  baseUrl: "https://www.coze.cn/space/7543460160883884075/develop",
  steps: [
    {
      name: "打开页面",
      type: "goto"
    },
    {
      name: "处理登录",
      type: "waitForLogin"
    },
    {
      name: "点击创建项目",
      type: "click",
      selectors: [
        'button:has-text("创建项目")',
        '.arco-btn:has-text("创建项目")',
        'button:has-text("项目")',
        '.arco-btn:has-text("项目")',
        '.arco-btn:has(.arco-icon-plus)',
        'button:has-text("创建")',
        '.arco-btn-primary:has-text("创建")'
      ],
      timeout: 30000
    },
    {
      name: "选择创建智能体",
      type: "click",
      selectors: [
        'text=创建智能体',
        '.arco-dropdown-menu-item:has-text("智能体")',
        '[role="menuitem"]:has-text("智能体")'
      ]
    },
    {
      name: "输入智能体名称",
      type: "input",
      selectors: [
        'input[placeholder*="名称"]',
        '.arco-input[placeholder*="智能体"]',
        '.arco-modal-content input'
      ],
      value: "testVT"
    },
    {
      name: "点击确认创建",
      type: "click",
      selectors: [
        'button:has-text("确认")',
        '.arco-modal-footer button.arco-btn-primary',
        'button:has-text("确定")'
      ]
    },
    {
      name: "等待进入开发页",
      type: "assertText",
      value: "工作流",
      timeout: 30000
    },
    {
      name: "最终截图",
      type: "screenshot"
    }
  ]
};
