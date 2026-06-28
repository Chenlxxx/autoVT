# AutoVT

AutoVT is a lightweight AI-assisted visual regression and workflow smoke-test console for low-code / agent-building web apps.

Current MVP:

- Generate a reusable test case from a target URL, objective, and tutorial text.
- Keep reusable cases in a local JSON case library.
- Run cases with Playwright in the background.
- Collect step status, screenshots, console errors, network failures, and Playwright trace files.
- Ship with a Coze workflow smoke-test template: create a workflow, add an LLM node, run it, and verify output.
- Use an optional OpenAI-compatible model endpoint for Chinese QA summaries.

## Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Coze Login State

Coze normally requires manual login and may show verification challenges.

When AutoVT runs locally, use the Login panel in the web UI and click "打开登录窗口并自动保存". AutoVT will open a visible Playwright browser, wait for you to finish Coze login, then save `playwright/.auth/coze-user.json` automatically.

You can also save the state from the command line:

```bash
npm run save-auth
```

Render and other cloud hosts cannot display a server-side browser window on your local computer. In that case, save login state locally and paste the storageState JSON in the UI, or provide it through your deployment secret workflow.

## Environment Variables

```bash
AI_API_KEY=...
AI_BASE_URL=https://your-openai-compatible-endpoint/v1
AI_MODEL=qwen2.5-vl-72b-instruct
```

The AI variables are optional. Without them, AutoVT still runs tests and returns a rule-based summary.
