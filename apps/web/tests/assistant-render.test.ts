import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { rolldown } from "rolldown";
import type { AccountMe } from "@aihot/contracts/account";
import type {
  AssistantActivity,
  AssistantOptions,
  AssistantSession,
} from "@aihot/contracts/assistant";

test("real assistant runtime SSR renders only persisted messages, explicit approval, draft sources and immutable assistant identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aihot-assistant-render-"));
  const require = createRequire(import.meta.url);
  const bundle = await rolldown({
    input: {
      conversation: new URL(
        "../app/features/assistant/conversation.tsx",
        import.meta.url,
      ).pathname,
      task: new URL("../app/features/assistant/current-task.tsx", import.meta.url).pathname,
      directory: new URL("../app/features/assistant/conversation-navigation.tsx", import.meta.url).pathname,
      page: new URL("../app/features/assistant/page.tsx", import.meta.url)
        .pathname,
      composer: new URL("../app/features/assistant/composer.tsx", import.meta.url).pathname,
      quoteCard: new URL("../app/features/assistant/quote-dialog.tsx", import.meta.url).pathname,
      composerControls: new URL("../app/features/assistant/composer-controls.tsx", import.meta.url).pathname,
      fees: new URL("../app/features/assistant/fee-dialog.tsx", import.meta.url).pathname,
      materials: new URL("../app/features/assistant/materials.tsx", import.meta.url).pathname,
    },
    plugins: [
      {
        name: "existing-runtime",
        resolveId(id) {
          if (
            [
              "react",
              "react/jsx-runtime",
              "react-router",
              "motion/react",
              "@assistant-ui/react",
            ].includes(id)
          )
            return { id: require.resolve(id), external: true };
        },
      },
    ],
  });
  try {
    await bundle.write({
      dir: directory,
      format: "esm",
      entryFileNames: "[name].mjs",
      chunkFileNames: "chunk-[hash].mjs",
    });
    const { AssistantConversation } = await import(
      pathToFileURL(join(directory, "conversation.mjs")).href
    );
    const { AssistantEntry } = await import(
      pathToFileURL(join(directory, "page.mjs")).href
    );
    const { CurrentTask } = await import(pathToFileURL(join(directory, "task.mjs")).href);
    const { ConversationNavigation } = await import(pathToFileURL(join(directory, "directory.mjs")).href);
    const { AssistantComposer } = await import(pathToFileURL(join(directory, "composer.mjs")).href);
    const { TurnQuoteDialog } = await import(pathToFileURL(join(directory, "quoteCard.mjs")).href);
    const { AssistantComposerControls } = await import(pathToFileURL(join(directory, "composerControls.mjs")).href);
    const { AssistantFeeDialog } = await import(pathToFileURL(join(directory, "fees.mjs")).href);
    const { AssistantAttachmentCards } = await import(pathToFileURL(join(directory, "materials.mjs")).href);
    const me: AccountMe = {
      csrf: "render-user-token",
      user: {
        id: 1,
        username: "member",
        displayName: "用户",
        role: "member",
        status: "active",
        createdAt: "2026-10-30T00:00:00Z",
        lastLoginAt: null,
      },
    };
    const options: AssistantOptions = {
      inputCapabilities: { fileTypes: [".txt", ".md"], maxAttachments: 10, maxFileBytes: 2097152 },
      assistants: ["creative", "xiaohongshu"].map((id) => ({
        id: id as "creative" | "xiaohongshu",
        name: id === "creative" ? "综合创作助手" : "小红书助手",
        welcome: "给定材料开始创作",
        version: "1",
        available: true,
        reason: null,
        actions: [
          {
            actionId: "general-writing",
            label: "通用文章草稿",
            available: true,
            reason: null,
          },
          {
            actionId: "wechat",
            label: "公众号创作",
            available: false,
            reason: "未开放",
          },
        ],
      })),
      limits: { modelCalls: 8, activeTurns: 2, inputCharacters: 30000 },
    };
    const quote = {
      quoteId: "quote",
      amount: 8,
      expiresAt: "2099-10-30T00:00:00Z",
      priceVersion: 1,
      priceId: "price",
      available: 100,
      affordable: true,
      recoveryOfRunId: null,
    };
    const session: AssistantSession = {
      sessionId: "persisted-session",
      assistantId: "xiaohongshu",
      assistantName: "小红书助手",
      title: "继续创作",
      brief: "保留原稿事实",
      revision: 3,
      archived: false,
      eventSeq: 7,
      inputs: [
        {
          id: "material",
          text: JSON.stringify({ title: "带入标题", body: "带入正文" }),
          source: { version: 2 },
        },
      ],
      messages: [
        {
          id: "message-user",
          seq: 1,
          role: "user",
          text: "用户已提交材料",
          turnId: "turn",
        },
        {
          id: "message-assistant",
          seq: 2,
          role: "assistant",
          text: "已保存助手消息",
          turnId: "turn",
        },
      ],
      artifacts: [
        {
          artifactId: "draft",
          version: 2,
          kind: "xhs-note",
          schemaVersion: 1,
          content: {
            title: "真实稿件",
            body: "可读正文",
            intent: "draft",
            titles: ["备选标题"],
            tags: ["AI"],
            sources: ["research-1", "unsafe", "current-message"],
            partial: true,
            scope: "仅单关键词研究",
          },
          sources: [
            {
              id: "current-message",
              kind: "user-material",
              label: "本回合用户提供的材料",
              url: null,
            },
            {
              id: "research-1",
              kind: "research",
              label: "真实参考笔记",
              url: "https://example.com/note",
            },
            {
              id: "unsafe",
              kind: "research",
              label: "不安全URL保留标签",
              url: "javascript:alert(1)",
            },
          ],
        },
      ],
      turn: {
        turnId: "turn",
        runId: 4,
        phase: "waiting_approval",
        status: "waiting",
        generation: 0,
        canResume: false,
        question: null,
        calls: [
          {
            callId: "call-stable",
            name: "search_xhs_notes",
            input: {
              keyword: "AI创作",
              startDate: "2026-10-01",
              endDate: "2026-10-30",
            },
            proposalRevision: 2,
            state: "proposed",
            quote,
            childRunId: null,
            result: { normalized: "must not display" },
          },
        ],
      },
    };
    function render(component: any, props: any) {
      const router = createMemoryRouter(
        [{ path: "*", element: createElement(component, props) }],
        {
          initialEntries: ["/assistant/sessions/persisted-session"],
        },
      );
      try {
        return renderToStaticMarkup(createElement(RouterProvider, { router }));
      } finally {
        router.dispose();
      }
    }
    const entry = render(AssistantEntry, {
      data: {
        me,
        options,
        history: {
          sessions: [
            {
              sessionId: "owned",
              assistantId: "xiaohongshu",
              assistantName: "小红书助手",
              title: "旧会话",
              createdAt: "2026-10-30T00:00:00Z",
            },
          ],
        },
      },
      assistantId: "creative",
    });
    assert(entry.includes("发送需求"));
    assert(entry.includes("选择技能，当前自动选择技能"));
    assert(entry.includes("费用确认：每次确认"));
    assert(entry.includes('multiple=""'));
    assert(entry.includes("会话历史"));
    assert(!entry.includes("← 数据工具"));
    assert.equal(
      (entry.match(/id="assistant-composer-input"/g) ?? []).length,
      1,
    );
    assert.match(entry, /disabled=""[^>]*>公众号创作/);
    assert(entry.includes("/assistant/sessions/owned"));
    const answerComposer = renderToStaticMarkup(createElement(AssistantComposer, { text: "补充事实", onChange() {}, onSend() {}, disabled: false, busy: false, answerMode: true, maxLength: 10000, controls: createElement("span", null, "下一轮材料与技能"), attachments: createElement("span", null, "下一轮文件卡") }));
    assert(answerComposer.includes("提交回答并继续"));
    assert(!answerComposer.includes("下一轮材料与技能"), "answer mode exposes only the current text command");
    assert(!answerComposer.includes("下一轮文件卡"));
    const composerWithFiles = renderToStaticMarkup(createElement(AssistantComposer, { text: "根据文件创作", onChange() {}, onSend() {}, disabled: false, busy: false, maxLength: 30000, controls: createElement("span", null, "底部材料技能费用"), attachments: createElement(AssistantAttachmentCards, { attachments: [{ id: "ready", name: "同框参考.md", state: "ready", text: "参考" }], max: 10, disabled: false, retry() {}, remove() {}, error: null }) }));
    assert(composerWithFiles.indexOf("<form") < composerWithFiles.indexOf("同框参考.md"), "file cards belong inside the rounded input form");
    assert(composerWithFiles.indexOf("同框参考.md") < composerWithFiles.indexOf("<textarea"), "files appear above the text input");
    assert(composerWithFiles.indexOf("</textarea>") < composerWithFiles.indexOf("底部材料技能费用"), "the input controls remain below the textarea");
    for (const remaining of [0, 800, 2147483647]) {
      const controls = renderToStaticMarkup(createElement(AssistantComposerControls, {
        profile: options.assistants[0], actionId: null, onAction() {}, disabled: false, addFiles() {},
        capabilities: options.inputCapabilities, configureFees() {},
        feeAuthorization: { enabled: true, remaining },
      }));
      assert.match(controls, new RegExp(`<span class="assistant-fee-remaining">剩余 ${remaining} 积分</span>`), "remaining allowance must be rendered text outside responsive hidden labels");
      assert(controls.includes('<span class="assistant-control-short">自动</span>'), "mobile label preserves automatic mode");
      assert(controls.includes('class="assistant-fee-menu-options"'));
      assert(controls.includes('aria-pressed="false">每次确认</button>'));
      assert(controls.includes('aria-pressed="true">额度内自动</button>'));
    }
    const confirmingComposer = renderToStaticMarkup(createElement(AssistantComposer, {
      text: "保留原需求", onChange() {}, onSend() {}, disabled: false, busy: false, maxLength: 30000,
      attachments: createElement("span", null, "九张待发附件"),
      children: createElement("span", null, "已有材料与更新提示"),
      confirmation: createElement(TurnQuoteDialog, { quote, message: "保留原需求", pending: false, error: null, close() {}, confirm() {} }),
    }));
    assert(confirmingComposer.includes('class="assistant-composer-confirmation"'));
    assert(confirmingComposer.includes(">开始</button>"));
    assert(confirmingComposer.includes(">取消</button>"));
    assert(!confirmingComposer.includes("<form"), "quote approval replaces the editor so attachments cannot squeeze its actions away");
    assert(!confirmingComposer.includes("九张待发附件"));
    assert(!confirmingComposer.includes("已有材料与更新提示"));
    const feeDialog = renderToStaticMarkup(createElement(AssistantFeeDialog, { sessionId: "owned", csrf: "csrf", initial: null, close() {}, changed() {} }));
    assert(feeDialog.includes('value=""'), "first consent has no pre-approved amount");
    assert(!feeDialog.includes('checked=""'), "automatic search starts unchecked");
    assert(feeDialog.includes("不会批准已有待确认请求"));
    const cards = renderToStaticMarkup(createElement(AssistantAttachmentCards, { attachments: [{ id: "failed", name: "长文件名.md", state: "error", error: "文件需要重试" }, { id: "ready", name: "已上传.txt", state: "ready", text: "private text" }], count: 10, max: 10, disabled: false, retry() {}, remove() {}, error: null }));
    assert(cards.includes("已添加10/10"));
    assert(cards.includes('aria-label="预览附件 已上传.txt"'));
    assert(!cards.includes("查看文本"), "preview is the card action, not another text button");
    assert.match(cards, /class="assistant-attachment-remove"[^>]*>×<\/button>/);
    assert(feeDialog.includes("仅本会话，超额再询问"));
    assert(!feeDialog.includes("重新读取"), "reload is only shown after an error");
    assert(!feeDialog.includes("关闭自动确认"), "manual selection belongs in the menu");
    const turnQuote = render(TurnQuoteDialog, { quote, message: "私有需求", pending: false, error: null, close() {}, confirm() {} });
    assert(turnQuote.includes(`本次 ${quote.amount} 积分`));
    assert(turnQuote.includes("费用与需求详情"));
    assert(turnQuote.includes(">开始</button>"));
    assert(turnQuote.includes(">取消</button>"));
    assert(cards.includes("重试"));
    assert(cards.includes("移除附件 长文件名.md"));
    assert(!cards.includes("private text"), "private preview stays closed until selected");
    const html = render(AssistantConversation, {
      data: { me, options, session },
    });
    assert(html.includes('data-message-id="message-user"'));
    assert(html.includes('data-message-id="message-assistant"'));
    assert(html.includes("用户已提交材料"));
    assert(html.includes("已保存助手消息"));
    assert(html.includes('data-call-id="call-stable"'));
    assert(html.includes("AI创作"));
    assert(html.includes("2026-10-01"));
    assert(html.includes("批准检索并占用积分"));
    assert(html.includes("拒绝此次检索"));
    assert(html.includes("独立检索费用"));
    assert(!html.includes("must not display"));
    assert(html.includes("可读正文"));
    assert(html.includes("用这版继续修改"));
    assert(html.includes("会话稿件"));
    assert.equal(
      (html.match(/id="assistant-composer-input"/g) ?? []).length,
      1,
    );
    assert(html.includes("真实参考笔记"));
    assert(html.includes("你提供的材料"));
    assert(!html.includes("本回合用户提供的材料"));
    assert(html.includes('href="https://example.com/note"'));
    assert(!html.includes("javascript:"));
    assert(html.includes("部分交付"));
    assert(html.includes("仅单关键词研究"));
    assert(html.includes("带入标题"));
    assert(html.includes("带入正文"));
    assert(html.includes("保留原稿事实"));
    assert(!html.includes("继续处理"));
    const question = render(AssistantConversation, {
      data: {
        me,
        options,
        session: {
          ...session,
          turn: {
            ...session.turn!,
            phase: "waiting_question",
            calls: [],
            question: { questionId: "question", text: "需要保留哪些事实？" },
          },
        },
      },
    });
    assert(question.includes("需要保留哪些事实？"));
    assert(question.includes("提交回答并继续"));
    assert.equal(
      (question.match(/id="assistant-composer-input"/g) ?? []).length,
      1,
    );
    assert(question.includes("补充回答沿用这次请求，不会另取创作报价"));
    assert(!question.includes("获取本回合报价"));
    assert(!question.includes("回合"));
    const resumable = render(AssistantConversation, {
      data: {
        me,
        options,
        session: {
          ...session,
          turn: {
            ...session.turn!,
            phase: "stopped",
            status: "stopped",
            canResume: true,
            calls: [],
          },
        },
      },
    });
    assert(resumable.includes("继续处理"));
    assert(resumable.includes("已停止"));
    assert(!resumable.includes("回合"));
    const completed = render(AssistantConversation, {
      data: {
        me,
        options,
        session: {
          ...session,
          turn: {
            ...session.turn!,
            phase: "completed",
            status: "completed",
            calls: [
              {
                ...session.turn!.calls[0]!,
                state: "completed",
                result: {
                  results: [
                    {
                      id: 1,
                      title: "检索笔记标题",
                      text: "已保存摘要",
                      url: "https://example.com/research",
                    },
                  ],
                  limited: false,
                },
              },
            ],
          },
        },
      },
    });
    assert(completed.includes("检索笔记标题"));
    assert(completed.includes("已保存摘要"));
    assert(completed.includes("当时检索报价"));
    assert(!completed.includes(" · 可用"));
    assert(!completed.includes("报价已过期"));
    assert.equal((completed.match(/已处理完成/g) ?? []).length, 1);
    assert(!completed.includes("会话稿件已保存"));
    assert(!completed.includes("回合"));
    assert(html.includes('aria-label="对话目录"'));
    assert.equal((html.match(/aria-label="跳到第 /g) ?? []).length, 1);
    assert(html.includes('aria-controls="assistant-message-message-user"'));
    assert(!html.includes('aria-controls="assistant-message-message-assistant"'));
    const directoryHtml = render(ConversationNavigation, {
      messages: session.messages.filter((message) => message.role === "user"),
      activeId: "message-user", jump() {},
    });
    assert(directoryHtml.includes('aria-current="location"'));
    assert(directoryHtml.includes('aria-expanded="false"'));
    assert(directoryHtml.includes("跳到第 1 条需求：用户已提交材料"));
    assert.equal((directoryHtml.match(/class="assistant-conversation-nav-list"/g) ?? []).length, 1);

    const taskProps = {
      csrf: me.csrf, pending: false, reading: false, readError: null,
      refresh: async () => undefined, control: async () => {}, showArtifacts() {}, setView() {},
    };
    function renderTask(turn: NonNullable<AssistantSession["turn"]>, artifacts = session.artifacts, readError: string | null = null) {
      return render(CurrentTask, { ...taskProps, session: { ...session, turn, artifacts }, readError });
    }
    const executingTurn = { ...session.turn!, phase: "executing" as const, status: "active", calls: [] };
    const executing = renderTask(executingTurn);
    assert(executing.includes('class="assistant-execution" open=""'));
    assert(executing.includes("已收到这次请求"));
    assert(executing.includes("正在处理你的创作需求"));
    assert(executing.includes("assistant-activity-dot"));
    assert(!executing.includes("已保存稿件"));
    for (const invented of ["正在理解需求", "已载入材料", "正在写作", "正在检查稿件", "预计剩余", "完整执行历史"])
      assert(!executing.includes(invented));
    const completedTurn = { ...executingTurn, phase: "completed" as const, status: "completed" };
    for (const artifacts of [[], session.artifacts]) {
      const result = renderTask(completedTurn, artifacts);
      assert.equal((result.match(/已处理完成/g) ?? []).length, 1);
      assert(!result.includes('class="assistant-execution" open=""'));
      assert(!result.includes("assistant-activity-dot"));
      assert(!result.includes("稿件已保存"));
      assert.equal(result.includes("查看会话稿件"), !!artifacts.length);
    }
    // Existing artifacts have no relationship to this turn in the public snapshot.
    const oldArtifacts = session.artifacts.map((artifact) => ({ ...artifact, artifactId: "old-draft" }));
    assert(!renderTask(completedTurn, oldArtifacts).includes("本次生成"));
    const awaitingApproval = renderTask(session.turn!);
    assert(awaitingApproval.indexOf("批准检索并占用积分") > awaitingApproval.indexOf("</details>"));
    assert(awaitingApproval.includes("此检索单独计费，不包含在本次创作费用内"));
    const review = renderTask({ ...executingTurn, phase: "needs_review", status: "needs_review" });
    assert(review.includes('data-state="attention"'));
    assert(review.indexOf("联系管理员") > review.indexOf("</details>"));
    assert(!review.includes("assistant-activity-dot"));
    const running = { ...session.turn!.calls[0]!, state: "running" };
    const interrupted = renderTask({ ...executingTurn, phase: "waiting_child", calls: [running] }, session.artifacts, "读取失败");
    assert(interrupted.includes('data-status-known="false"'));
    assert(interrupted.includes("状态待确认 · 上次已知：正在获取参考资料"));
    assert(interrupted.includes("上次已知：已批准，检索中"));
    assert(!interrupted.includes("assistant-activity-dot"));
    const awaitingAnswer = renderTask({ ...executingTurn, phase: "waiting_question", status: "waiting", question: { questionId: "question", text: "还需哪些材料？" } });
    assert(awaitingAnswer.indexOf("回答这个问题") > awaitingAnswer.indexOf("</details>"));
    const projected = {
      ...executingTurn,
      activities: [
        { id: "request:t", kind: "request_received" as const, state: "completed" as const },
        { id: "model:m1", kind: "model_request" as const, state: "completed" as const },
        { id: "call:s", kind: "load_skill" as const, state: "completed" as const },
        { id: "model:m2", kind: "model_request" as const, state: "running" as const },
      ],
    };
    const history = renderTask(projected);
    assert(history.includes("已收到请求"));
    assert(history.includes("已选择创作技能"));
    assert(history.includes("已加载创作技能"));
    assert(history.includes("正在调用创作接口"));
    assert(!history.includes("正在处理你的创作需求"));
    const correcting = renderTask({ ...projected, activities: [
      ...projected.activities.slice(0, 3),
      { id: "call:invalid-draft", kind: "save_draft", state: "failed" },
      projected.activities[3]!,
    ] });
    const correctingSummary = correcting.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0] ?? "";
    assert(correctingSummary.includes("正在调用创作接口"));
    assert(correctingSummary.includes("assistant-activity-dot"));
    assert(correcting.includes("保存稿件 · 失败"), "the earlier failure remains in the execution history");
    const generated = renderTask({ ...completedTurn, activities: [
      ...projected.activities.slice(0, 3),
      { id: "model:m2", kind: "model_request", state: "completed" },
      { id: "call:draft", kind: "save_draft", state: "completed" },
    ] });
    assert.equal((generated.match(/已选择创作技能/g) ?? []).length, 1);
    assert.equal((generated.match(/稿件内容已返回/g) ?? []).length, 1);
    assert(generated.indexOf("已选择创作技能") < generated.indexOf("已加载创作技能"));
    assert(generated.indexOf("稿件内容已返回") < generated.lastIndexOf("稿件已保存"));
    assert(!generated.includes("创作接口已返回"));
    const modelActivity: AssistantActivity = { id: "model:single", kind: "model_request", state: "completed" };
    const toolActivity = (kind: AssistantActivity["kind"], index = 0): AssistantActivity => ({
      id: `call:${kind}:${index}`, kind, state: "preparing",
    });
    const modelThenTools = (tools: AssistantActivity[], state: AssistantActivity["state"] = "completed") =>
      renderTask({ ...executingTurn, activities: [{ ...modelActivity, state }, ...tools] }, []);
    assert(modelThenTools([]).includes("创作接口已返回"));
    const mixed = modelThenTools([toolActivity("load_skill"), toolActivity("save_draft")]);
    assert(mixed.includes("已返回下一步处理安排"));
    assert(!mixed.includes("已选择创作技能"));
    assert(!mixed.includes("稿件内容已返回"));
    const repeated = modelThenTools([toolActivity("load_skill"), toolActivity("load_skill", 1)]);
    assert(repeated.includes("已选择创作技能"));
    assert(!repeated.includes("已返回下一步处理安排"));
    for (const [kind, label] of [
      ["ask_question", "已提出需要补充的问题"],
      ["read_skill_reference", "已选择创作参考"],
    ] as const) assert(modelThenTools([toolActivity(kind)]).includes(label));
    for (const [state, label] of [
      ["running", "正在调用创作接口"],
      ["preparing", "准备调用创作接口"],
      ["waiting", "等待处理 · 调用创作接口"],
    ] as const) {
      const pendingModel = modelThenTools([toolActivity("save_draft")], state);
      assert(pendingModel.includes(label));
      assert(!pendingModel.includes("稿件内容已返回"));
      assert(!pendingModel.includes("稿件已保存"));
    }
    const proposedSearch = modelThenTools([{ ...toolActivity("search_xhs_notes"), state: "waiting", keyword: "咖啡" }]);
    assert(proposedSearch.includes("已提出笔记检索需求"));
    assert(proposedSearch.includes("等待处理 · 查询“咖啡”"));
    assert(!proposedSearch.includes("查询结果已返回"));
    const completedSearch = modelThenTools([{ ...toolActivity("search_xhs_notes"), state: "completed", keyword: "咖啡" }]);
    assert(completedSearch.includes("已提出笔记检索需求"));
    assert(completedSearch.includes("查询“咖啡” · 查询结果已返回"));
    const waitingHistory = renderTask({ ...projected, status: "waiting", activities: projected.activities.map((a) => a.id === "model:m2" ? { ...a, state: "waiting" as const } : a) });
    assert(waitingHistory.includes("等待处理 · 调用创作接口"));
    assert(!waitingHistory.includes("assistant-activity-dot"));
    const onlyCompleted = { ...projected, activities: projected.activities.slice(0, 3) };
    for (const phase of ["executing", "waiting_child"] as const) {
      for (const activities of [projected.activities.slice(0, 1), onlyCompleted.activities, [
        ...onlyCompleted.activities,
        { id: "call:declined", kind: "search_xhs_notes" as const, state: "rejected" as const },
      ]]) {
        const queued = renderTask({ ...onlyCompleted, phase, activities });
        const summary = queued.slice(queued.indexOf("<summary"), queued.indexOf("</summary>"));
        assert(summary.includes("等待下一步处理"));
        assert(summary.includes('data-state="waiting"'));
        assert(!summary.includes('data-state="done"'));
        assert(!queued.includes("assistant-activity-dot"));
        assert(queued.includes("已收到请求"));
        assert(queued.includes('data-state="done"'));
      }
    }
    const stoppedHistory = renderTask({ ...onlyCompleted, phase: "stopped", status: "stopped" });
    assert(stoppedHistory.includes('data-state="stopped"'));
    assert(stoppedHistory.includes("已停止"));
    assert(stoppedHistory.includes("已加载创作技能"));
    const approvalHistory = renderTask({ ...session.turn!, activities: [
      { id: "request:t", kind: "request_received", state: "completed" },
      { id: "call:search", kind: "search_xhs_notes", state: "waiting", callId: session.turn!.calls[0]!.callId, keyword: "咖啡" },
    ] });
    assert(approvalHistory.includes("等待确认查询“咖啡”"));
    assert.equal((approvalHistory.match(/data-call-id=/g) ?? []).length, 1);
    assert(approvalHistory.indexOf("批准检索并占用积分") > approvalHistory.indexOf("</details>"));
    assert(approvalHistory.includes("外部检索服务"));
    assert(!approvalHistory.includes("Redfox"));
    const rejected = renderTask({ ...completedTurn, calls: [{ ...running, state: "rejected" }] });
    assert(rejected.includes("你已拒绝检索"));
    assert(!rejected.includes("assistant-activity-dot"));
  } finally {
    await bundle.close();
    await rm(directory, { recursive: true, force: true });
  }
});
