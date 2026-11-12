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
  AssistantArtifact,
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
      messageQueue: new URL("../app/features/assistant/message-queue.tsx", import.meta.url).pathname,
      composerControls: new URL("../app/features/assistant/composer-controls.tsx", import.meta.url).pathname,
      fees: new URL("../app/features/assistant/fee-dialog.tsx", import.meta.url).pathname,
      materials: new URL("../app/features/assistant/materials.tsx", import.meta.url).pathname,
      coverPlan: new URL("../app/features/assistant/cover-plan.tsx", import.meta.url).pathname,
    },
    plugins: [
      {
        name: "existing-runtime",
        resolveId(id) {
          if (
            [
              "react",
              "react-dom",
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
    const { AssistantMessageQueue } = await import(pathToFileURL(join(directory, "messageQueue.mjs")).href);
    const { AssistantComposerControls, TaskClarification } = await import(pathToFileURL(join(directory, "composerControls.mjs")).href);
    const { AssistantFeeDialog } = await import(pathToFileURL(join(directory, "fees.mjs")).href);
    const { AssistantAttachmentCards } = await import(pathToFileURL(join(directory, "materials.mjs")).href);
    const { CoverPlanBody } = await import(pathToFileURL(join(directory, "coverPlan.mjs")).href);
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
            actionId: "general-writing", skillId: "general-writing", skillName: "通用写作",
            label: "通用文章草稿",
            available: true,
            reason: null,
          },
          {
            actionId: "wechat-write", skillId: "wechat-write", skillName: "公众号创作",
            label: "公众号创作",
            available: true,
            reason: null,
          },
          {
            actionId: "ai-image-generator", skillId: "ai-image-generator", skillName: "图片生成",
            label: "图片生成",
            available: true,
            reason: null,
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
            research: {
              platform: "xiaohongshu", analysisCallId: "frozen-analysis", application: "从日常场景开篇",
              patterns: [{ label: "标题", observation: "用具体场景点题" }],
              references: [{ sourceId: "research-1", title: "真实参考笔记", url: "https://example.com/note", metrics: [{ label: "收藏", value: 0 }] }],
            },
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
    assert(entry.includes("发送后按本次费用上限开始，结束后按实际费用结算"));
    assert(entry.includes("发送后自动开始，结束后按实际费用结算"));
    assert(entry.includes('title="技能"'));
    assert(!entry.includes("<span>自动选择技能</span>"));
    assert(!entry.includes("额度内自动"));
    assert(!entry.includes("确认本次交付内容"), "normal entry does not show task clarification controls");
    assert(entry.includes('multiple=""'));
    assert(entry.includes("会话历史"));
    assert(!entry.includes("← 数据工具"));
    assert.equal(
      (entry.match(/id="assistant-composer-input"/g) ?? []).length,
      1,
    );
    assert(entry.includes("公众号创作"));
    assert(!entry.includes("公众号创作 · 未开放"));
    assert(entry.includes("/assistant/sessions/owned"));
    const answerComposer = renderToStaticMarkup(createElement(AssistantComposer, { text: "补充事实", onChange() {}, onSend() {}, disabled: false, busy: false, running: true, onStop() {}, answerMode: true, maxLength: 10000, controls: createElement("span", null, "下一轮材料与技能"), attachments: createElement("span", null, "下一轮文件卡") }));
    assert(answerComposer.includes("提交回答并继续"));
    assert(!answerComposer.includes("停止当前任务"));
    assert(!answerComposer.includes("下一轮材料与技能"), "answer mode exposes only the current text command");
    assert(!answerComposer.includes("下一轮文件卡"));
    const runningEmpty = renderToStaticMarkup(createElement(AssistantComposer, { text: "", running: true, onStop() {}, onChange() {}, onSend() {}, disabled: true, busy: true, stopBusy: false, maxLength: 30000 }));
    assert.equal((runningEmpty.match(/aria-label="停止当前任务"/g) ?? []).length, 1);
    assert(runningEmpty.includes("<span>停止</span>"));
    assert(!runningEmpty.includes(">停止当前任务</button>"));
    const emptyAnswer = renderToStaticMarkup(createElement(AssistantComposer, { text: "", running: true, answerMode: true, onStop() {}, onChange() {}, onSend() {}, disabled: true, busy: true, stopBusy: false, maxLength: 10000 }));
    assert.equal((emptyAnswer.match(/aria-label="停止当前任务"/g) ?? []).length, 1);
    assert(emptyAnswer.includes("<span>停止</span>"));
    assert(!emptyAnswer.includes("提交回答并继续"));
    assert(!runningEmpty.match(/<button[^>]*disabled[^>]*aria-label="停止当前任务"/), "slow enqueue cannot disable the independent stop action");
    const runningDraft = renderToStaticMarkup(createElement(AssistantComposer, { text: "下一条", running: true, onStop() {}, onChange() {}, onSend() {}, disabled: false, busy: false, maxLength: 30000 }));
    assert(!runningDraft.includes('aria-label="停止当前任务"'));
    const composerWithFiles = renderToStaticMarkup(createElement(AssistantComposer, { text: "根据文件创作", onChange() {}, onSend() {}, disabled: false, busy: false, maxLength: 30000, controls: createElement("span", null, "底部材料技能费用"), attachments: createElement(AssistantAttachmentCards, { attachments: [{ id: "ready", name: "同框参考.md", state: "ready", text: "参考" }], max: 10, disabled: false, retry() {}, remove() {}, error: null }) }));
    assert(composerWithFiles.indexOf("<form") < composerWithFiles.indexOf("同框参考.md"), "file cards belong inside the rounded input form");
    assert(composerWithFiles.indexOf("同框参考.md") < composerWithFiles.indexOf("<textarea"), "files appear above the text input");
    assert(composerWithFiles.indexOf("</textarea>") < composerWithFiles.indexOf("底部材料技能费用"), "the input controls remain below the textarea");
    const groupedProfile = { ...options.assistants[0], actions: [
      { actionId: "xiaohongshu-write", skillId: "xiaohongshu-creator", skillName: "小红书创作", label: "笔记创作", available: false, reason: "暂不可用" },
      { actionId: "xiaohongshu-rewrite", skillId: "xiaohongshu-creator", skillName: "小红书创作", label: "改写", available: true, reason: null },
    ] };
    const grouped = renderToStaticMarkup(createElement(AssistantComposerControls, { profile: groupedProfile, selection: { skillId: "xiaohongshu-creator" }, onSelection() {}, disabled: false, addFiles() {}, capabilities: options.inputCapabilities }));
    assert.equal((grouped.match(/role="menuitemradio"[^>]*>小红书创作<\/button>/g) ?? []).length, 1);
    assert(!grouped.includes('value="xiaohongshu-rewrite"'));
    assert.match(grouped, /role="menuitemradio" aria-checked="true">小红书创作<\/button>/);
    assert(!grouped.includes("<select"));
    assert.equal((grouped.match(/aria-haspopup="menu" aria-expanded="false"/g) ?? []).length, 3);
    const hinted = renderToStaticMarkup(createElement(AssistantComposerControls, { profile: groupedProfile, selection: { skillId: "xiaohongshu-creator" }, taskHint: {actionId:"xiaohongshu-rewrite"}, onSelection() {}, disabled: false, addFiles() {}, capabilities: options.inputCapabilities }));
    assert(hinted.includes("小红书创作 · 改写"));
    assert(hinted.includes('aria-haspopup="menu"'));
    assert(!hinted.includes("发送后先确认积分"));
    const clarificationProfile = {...groupedProfile,taskOptions:[
      {actionId:"xiaohongshu-write",choice:{skillId:"xiaohongshu-creator",moduleId:"M1",delivery:"writing"},label:"写笔记",sizes:[]},
      {actionId:"xiaohongshu-rewrite",choice:{skillId:"xiaohongshu-creator",moduleId:"M2",delivery:"writing"},label:"改写",sizes:[]},
      ...["plans-only","image"].map(delivery=>({actionId:"xiaohongshu-cover",choice:{skillId:"xiaohongshu-creator",moduleId:"M4",delivery},label:delivery==="image"?"方案及封面图":"三套方案",sizes:delivery==="image"?["3:4"]:[]}))
    ]};
    const clarification = renderToStaticMarkup(createElement(TaskClarification, {profile:clarificationProfile,selection:{skillId:"xiaohongshu-creator"},taskHint:{actionId:"xiaohongshu-cover"},disabled:false,confirm(){}}));
    const queueProps = { profile: clarificationProfile, pending: false, approve(){}, cancel(){}, resume(){}, requote(){} };
    const queuedEntry = { id: "queued-cover", position: 1, message: "春季穿搭封面", state: "pending", quote: null, error: null, turnId: null, commandKey: "queue-key", taskSelectionRequired: true, skillSelection: { skillId: "xiaohongshu-creator" } };
    const queuedClarification = renderToStaticMarkup(createElement(AssistantMessageQueue, { ...queueProps, queue: { paused: false, entries: [{ ...queuedEntry, taskHint: { actionId: "xiaohongshu-cover" } }] } }));
    assert(queuedClarification.includes("只要三套封面方案，还是选一套后生成图片？"));
    assert.equal((queuedClarification.match(/type="radio"/g)??[]).length,2);
    assert(!queuedClarification.includes("写笔记") && !queuedClarification.includes("改写"));
    const legacyQueue = renderToStaticMarkup(createElement(AssistantMessageQueue, { ...queueProps, queue: { paused: false, entries: [queuedEntry] } }));
    assert.equal((legacyQueue.match(/type="radio"/g)??[]).length,4, "older queued items without an action still offer their original choices");
    assert(clarification.includes("只要三套封面方案，还是选一套后生成图片？"));
    assert(!clarification.includes("写笔记"));
    assert.equal((clarification.match(/type="radio"/g)??[]).length,2);
    const legacy = renderToStaticMarkup(createElement(AssistantComposerControls, { profile: groupedProfile, selection: { actionId: "xiaohongshu-rewrite" }, onSelection() {}, disabled: false, addFiles() {}, capabilities: options.inputCapabilities }));
    assert(legacy.includes("本次：改写")); assert.match(legacy, /role="menuitemradio" aria-checked="true" disabled="">小红书创作 · 本次：改写/);
    const removedSelection = renderToStaticMarkup(createElement(AssistantComposerControls, {
      profile: { ...options.assistants[0], actions: [] }, selection: { actionId: "xiaohongshu-write" }, onSelection() {}, disabled: false,
      addFiles() {}, capabilities: options.inputCapabilities,
    }));
    assert.match(removedSelection, /role="menuitemradio" aria-checked="true" disabled="">原技能不可用/);
    assert(removedSelection.includes("原技能不可用，请重新选择"));
    assert(!removedSelection.includes('value="xiaohongshu-write"'));
    for (const actionId of ["image-generator", "claude-image-generation"]) {
      const hiddenSelection = renderToStaticMarkup(createElement(AssistantComposerControls, {
        profile: options.assistants[0], selection: { actionId }, onSelection() {}, disabled: false,
        addFiles() {}, capabilities: options.inputCapabilities,
      }));
      assert.match(hiddenSelection, /role="menuitemradio" aria-checked="true" disabled="">原技能不可用/);
      assert(!hiddenSelection.includes(`value="${actionId}"`));
      assert(!hiddenSelection.includes('role="menuitemradio" aria-checked="true">图片生成'), "old selections are never replaced automatically");
    }
    {
      const controls = renderToStaticMarkup(createElement(AssistantComposerControls, {
        profile: options.assistants[0], selection: null, onSelection() {}, disabled: false, addFiles() {},
        capabilities: options.inputCapabilities,
      }));
      assert(!controls.includes("assistant-fee-remaining"), "legacy session allowance does not authorize a new task");
      assert(controls.includes("开始前先确认本次费用上限"));
      assert(controls.includes("发送后按本次费用上限开始，结束后按实际费用结算"));
      assert.equal((controls.match(/class="assistant-composer-menu"/g) ?? []).length, 3);
      assert(controls.includes('role="menuitemradio" aria-checked="false">公众号创作'), "the real WeChat skill is a menu choice");
      assert(!controls.includes("图片创作 · 帮我完善描述"));
      assert(controls.includes("图片生成"));
      assert.equal((controls.match(/role="menuitemradio" aria-checked="false">图片生成<\/button>/g) ?? []).length, 1);
      assert(!controls.includes('value="image-generator"') && !controls.includes('value="claude-image-generation"'));
      assert(!controls.includes("每次确认</button>"));
      assert(!controls.includes("额度内自动</button>"));
    }
    const imageOnlyControls = renderToStaticMarkup(createElement(AssistantComposerControls, {
      profile: options.assistants[0], selection: null, onSelection() {}, disabled: false, addFiles() {},
      capabilities: options.inputCapabilities,
      artifacts: [{
        ...session.artifacts[0],
        artifactId: "image-only",
        kind: "image",
        content: { ...session.artifacts[0].content, title: "窗边的猫", prompt: "柔和晨光", fileKey: "image-key", width: 1024, height: 1024 },
      }],
    }));
    assert(imageOnlyControls.includes("引用已保存稿件（暂无）"));
    assert.match(imageOnlyControls, /引用已保存稿件（暂无）<\/button>/);
    const confirmingComposer = renderToStaticMarkup(createElement(AssistantComposer, {
      text: "保留原需求", onChange() {}, onSend() {}, disabled: false, busy: false, maxLength: 30000,
      attachments: createElement("span", null, "九张待发附件"),
      children: createElement("span", null, "已有材料与更新提示"),
      confirmation: createElement(TurnQuoteDialog, { quote, message: "保留原需求", pending: false, error: null, close() {}, confirm() {} }),
    }));
    assert(confirmingComposer.includes('class="assistant-composer-confirmation"'));
    assert(confirmingComposer.includes(">确认开始</button>"));
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
    assert(turnQuote.includes(`本次创作 · 本次最多 ${quote.amount} 积分`));
    assert(turnQuote.includes("额外服务费用以执行前的报价为准。"));
    assert(!turnQuote.includes("图片"), "older quotes use neutral disclosure");
    for (const [additionalFeeKinds, notice] of [
      [[], null],
      [["search"], "如需查询参考，将另行报价并确认。"],
      [["image"], "图片生成另行计费，生成前会单独确认。"],
      [["search", "image"], "如需检索或生成图片，将另行计费；图片生成前会单独确认。"],
    ] as const) {
      const markup = render(TurnQuoteDialog, { quote: { ...quote, additionalFeeKinds }, message: "私有需求", pending: false, error: null, close() {}, confirm() {} });
      if (notice) assert(markup.includes(notice));
      else assert(!markup.includes("另行计费") && !markup.includes("额外服务费用"));
      if (!additionalFeeKinds.some(kind => kind === "image")) assert(!markup.includes("图片"));
    }
    assert(!turnQuote.includes('tabindex="-1"'), "the inline cost reminder does not steal keyboard focus");
    assert(!turnQuote.includes('role="dialog"'));
    assert(turnQuote.includes("<details"), "cost details remain collapsed");
    assert(turnQuote.includes("费用与需求详情"));
    assert(turnQuote.includes(">确认开始</button>"));
    assert(turnQuote.includes(">取消</button>"));
    assert.equal((turnQuote.match(/<button/g) ?? []).length, 2);
    assert(turnQuote.indexOf("私有需求") < turnQuote.indexOf("<details"), "the request is visible before the first approval");
    assert(turnQuote.slice(0, turnQuote.indexOf("<details")).includes(`报价时可用 ${quote.available.toLocaleString()} 积分`));
    const taskQuote=render(TurnQuoteDialog,{quote:{...quote,task:{label:'三套方案',scope:'plans-only',items:[{key:'creation',label:'方案创作',units:1,amount:7}]}},message:'私有需求',pending:false,error:null,close(){},confirm(){}});
    assert(taskQuote.includes('最多'));assert(taskQuote.includes('按实际执行结算'));assert(!taskQuote.includes('另行报价'));
    for (const [policy, queryKey] of [["xhs-empty-window@1", "search-xhs-notes@1"], ["wechat-low-raw-window@1", "search-wechat-hot@1"]]) {
      for (const [units, unitPrice, creationPrice] of [[2, 20, 200], [1, 37, 230]]) {
        const researchQuote = { ...quote, amount: creationPrice + units * unitPrice, available: 1000, task: { label: "研究写作", scope: JSON.stringify({ delivery: "writing", research: { policy, maximumQueries: units } }), items: [
          { key: "creation", label: "文字创作", units: 1, amount: creationPrice },
          { key: queryKey, label: "参考查询", units, amount: unitPrice },
        ] } };
        const renderResearch = (value = researchQuote) => render(TurnQuoteDialog, { quote: value, message: "本次研究需求", pending: false, error: null, close(){}, confirm(){}, requote(){} });
        const research = renderResearch();
        assert(research.includes(`最多 ${researchQuote.amount} 积分`));
        assert(research.includes(`查询每次 ${unitPrice} 积分，最多 ${units} 次；没搜到只收查询费。`));
        assert(!research.includes("重新获取报价"), "a valid quote offers only cancel and confirmation");
        assert.equal((research.match(/<button/g) ?? []).length, 2);
        for (const scope of ["old-contract", JSON.stringify({ delivery: "writing" }), JSON.stringify({ delivery: "image", research: { policy, maximumQueries: units } })])
          assert(!renderResearch({ ...researchQuote, task: { ...researchQuote.task, scope } }).includes("只收查询费"));
        assert(!renderResearch({ ...researchQuote, amount: researchQuote.amount + 1 }).includes("只收查询费"), "inconsistent frozen items use neutral disclosure");
      }
    }
    assert(!taskQuote.includes("只收查询费"), "cover plans do not inherit writing research settlement");
    const queueQuote = render(AssistantMessageQueue, { ...queueProps, queue: { paused: false, entries: [{ ...queuedEntry, state: "quoted", taskSelectionRequired: false, quote }] } });
    assert(!queueQuote.includes("重新获取报价"));
    assert.equal((queueQuote.match(/<button/g) ?? []).length, 2, "the quoted queue item uses the same cancel and confirm actions once");
    assert.equal((queueQuote.slice(0, queueQuote.indexOf("<details")).match(/春季穿搭封面/g) ?? []).length, 1, "the queued request is already visible above its quote");
    const expiredQueue = render(AssistantMessageQueue, { ...queueProps, queue: { paused: false, entries: [{ ...queuedEntry, state: "quoted", quote: { ...quote, expiresAt: "2020-01-01T00:00:00Z" } }] } });
    assert.equal((expiredQueue.match(/>更新费用<\/button>/g) ?? []).length, 1);
    assert(!expiredQueue.includes(">确认开始</button>"));
    const firstRequest = { commandKey: "first-request", input: { message: "已发送的首条需求", expectedRevision: 0, skillSelection: null, inputIds: [], artifactVersions: [] }, quote };
    const firstQuoteSession = render(AssistantConversation, { data: { me, options, session: { ...session, messages: [], turn: null, initialRequest: firstRequest } } });
    assert(!firstQuoteSession.includes("开始这次创作"), "the initial request has already left the empty conversation state");
    const dateCorrection = "查询日期超出可用范围，请选择2026-10-06至2026-11-05内的日期。";
    const firstDateSession = render(AssistantConversation, { data: { me, options, session: { ...session, messages: [], turn: null, initialRequest: { ...firstRequest, quote: null, clarification: { code: "assistant_research_date_required", message: dateCorrection } } } } });
    assert(firstDateSession.includes(dateCorrection), "a refreshed session retains the backend's exact date correction");
    assert(firstDateSession.includes("修改需求后在本会话重新发送；尚未查询或冻结积分。"));
    assert(firstDateSession.includes("继续首条需求"));
    assert(!firstDateSession.includes("开始这次创作") && !firstDateSession.includes("这次发送未受理"));
    const hydratingEmpty = render(AssistantConversation, { data: { me, options, session: { ...session, messages: [], turn: null } } });
    assert(!hydratingEmpty.includes("开始这次创作"), "withhold the welcome until local pending requests have been read");
    const expiredQuote=render(TurnQuoteDialog,{quote:{...quote,amount:200,available:20,affordable:false,expiresAt:"2020-01-01T00:00:00Z"},message:"私有需求",pending:false,error:null,close(){},confirm(){},requote(){}});
    assert(expiredQuote.includes("费用需要更新，需求已保留"));
    assert(expiredQuote.includes("上次预计 200 积分"));
    assert(expiredQuote.includes("报价时可用 20 积分（仅供参考）"));
    assert(!expiredQuote.includes("还差")&&!expiredQuote.includes("当前可用"));
    assert(expiredQuote.includes("补充积分") && expiredQuote.includes(">更新费用</button>"));
    assert(!expiredQuote.includes(">确认开始</button>"));
    const insufficient=render(TurnQuoteDialog,{quote:{...quote,amount:200,available:20,affordable:false},message:"私有需求",pending:false,error:null,close(){},confirm(){}});
    assert(insufficient.includes("本次最多 200 积分") && insufficient.includes("报价时可用 20 积分"));
    assert(insufficient.includes("还差 180"));
    assert(insufficient.includes("补充积分") && insufficient.includes("刷新余额") && !insufficient.includes(">确认开始</button>"));
    const balanceRefresh=render(TurnQuoteDialog,{quote:{...quote,amount:200,available:20,affordable:false},message:"私有需求",pending:false,error:null,close(){},confirm(){},requote(){}});
    assert(!balanceRefresh.includes(">更新费用</button>") && balanceRefresh.includes("补充积分"));
    const serviceBudget = render(TurnQuoteDialog, { quote: { ...quote, amount: 200, available: 20, affordable: false }, message: "服务额度不足", pending: false, error: "图片服务额度暂不可用，请稍后重试，未冻结积分。", requiresRequote: true, close(){}, confirm(){}, requote(){} });
    assert(serviceBudget.includes("服务暂时不可用，需求已保留"));
    assert(serviceBudget.includes('href="/feedback" target="_blank"'));
    assert(!serviceBudget.includes("补充积分") && !serviceBudget.includes("刷新余额") && !serviceBudget.includes("还差"));
    const accountReturn = render(TurnQuoteDialog, { quote: { ...quote, amount: 200, available: 20, affordable: false }, message: "原需求不进入链接", returnTo: "/assistant/sessions/owned#assistant-fees", pending: false, error: null, close(){}, confirm(){} });
    assert(accountReturn.includes('href="/account?assistantReturn=%2Fassistant%2Fsessions%2Fowned%23assistant-fees#account-credits"'));
    const link = accountReturn.match(/href="[^"]+"/)?.[0] ?? "";
    assert(!link.includes("原需求"));
    for (const automatic of [false, true]) {
      const rejected = render(TurnQuoteDialog, { quote: { ...quote, amount: 200, available: 20, affordable: false }, message: "保留原需求", pending: false, error: null,
        requiresRequote: true, continueAutomatically: automatic, showRejectedBalance: true, close(){}, confirm(){}, requote(){} });
      assert(rejected.includes(automatic ? "更新费用并继续" : ">更新费用</button>"));
      assert.equal(rejected.includes("更新后按本次费用上限开始"), automatic);
      assert(rejected.includes("刷新余额") && !rejected.includes("还差"));
      assert(!rejected.includes(">确认开始</button>"));
      const unavailable = render(TurnQuoteDialog, { quote, message: "余额读取失败的原需求", pending: false, error: null, requiresRequote: true, balanceUnavailable: true,
        continueAutomatically: automatic, close(){}, confirm(){}, requote(){} });
      assert(unavailable.includes("暂时无法读取积分"));
      assert(unavailable.includes("重试读取") && !unavailable.includes("补充积分"));
      assert(!unavailable.includes("当前可用") && !unavailable.includes(">确认开始</button>"));
      for (const state of ["pending", "quoted"]) {
        const failedQueue = render(AssistantMessageQueue, { ...queueProps, queue: { paused: false, entries: [{ ...queuedEntry, taskSelectionRequired: false,
          state, quote: state === "quoted" ? quote : null, error: "本次发送未受理", confirmationMode: automatic ? "automatic" : "manual" }] } });
        assert(failedQueue.includes(automatic ? "更新费用并继续" : ">更新费用</button>"));
        assert(!failedQueue.includes(">确认开始</button>") && !failedQueue.includes("继续排队消息"));
      }
      const savedAutomatic = render(TurnQuoteDialog, { quote, message: "发送时模式", pending: false, continueAutomatically: automatic, error: null, close(){}, confirm(){} });
      assert(savedAutomatic.includes(automatic ? ">继续这次任务</button>" : ">确认开始</button>"));
      const queueInsufficient = { paused: false, entries: [{ ...queuedEntry, taskSelectionRequired: false, state: "quoted", quote: { ...quote, amount: 200, available: 20, affordable: false }, confirmationMode: automatic ? "automatic" : "manual", error: "本次预计需要 200 积分，当前可用 20 积分，还差 180 积分。" }] };
      const lowQueue = render(AssistantMessageQueue, { ...queueProps, queue: queueInsufficient, returnTo: "/assistant/sessions/queue#assistant-fees" });
      assert(lowQueue.includes("刷新余额"));
      assert(!lowQueue.includes("更新费用") && !lowQueue.includes(">确认开始</button>"));
      const recoveringQueue = render(AssistantMessageQueue, { ...queueProps, queue: queueInsufficient, recovering: true, pending: true });
      assert(!recoveringQueue.includes("补充积分") && !recoveringQueue.includes("刷新余额"));
      const pausedQueue = render(AssistantMessageQueue, { ...queueProps, queue: { ...queueInsufficient, paused: true } });
      assert(!pausedQueue.includes("刷新余额") && !pausedQueue.includes("补充积分"));
    }
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
    assert(html.includes("会话作品"));
    assert.equal(
      (html.match(/id="assistant-composer-input"/g) ?? []).length,
      1,
    );
    assert(html.includes("真实参考笔记"));
    assert(html.includes("你提供的材料"));
    assert(!html.includes("本回合用户提供的材料"));
    assert(html.includes('href="https://example.com/note"'));
    assert(!html.includes("javascript:"));
    assert.doesNotMatch(html, /部分交付|仅单关键词研究|frozen-analysis/);
    const references = html.match(/<details(?![^>]* open)[^>]*><summary[^>]*>参考规律与作品<\/summary>([\s\S]*?)<\/details>/);
    assert(references && references[1]!.includes("用具体场景点题") && references[1]!.includes("收藏 0"));
    assert.equal(html.split('href="https://example.com/note"').length, 2);
    assert(html.includes("带入标题"));
    assert(html.includes("带入正文"));
    assert(html.includes("保留原稿事实"));
    assert(!html.includes("继续处理"));
    const imageHtml = render(AssistantConversation, {
      data: {
        me,
        options,
        session: {
          ...session,
          turn: {
            ...session.turn!,
            calls: [{
              callId: "call-image",
              name: "generate_image",
              input: { prompt: "模型原提案", size: "1:1" },
              proposalRevision: 1,
              state: "proposed",
              quote,
              childRunId: null,
              imageParameters: {
                prompt: "竖版海报：窗边的橘猫",
                size: "4:5",
                resolution: "1k",
                count: 1,
              },
              result: { normalized: { commandInput: "internal request" } },
            }],
          },
        },
      },
    });
    assert(imageHtml.includes("竖版海报：窗边的橘猫"));
    assert(imageHtml.includes("1K · 1 张 · 4:5"));
    assert(!imageHtml.includes("internal request"));
    assert(!imageHtml.includes("3:2"));
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
    assert(!question.includes("提交回答并继续"), "an empty answer uses the same composer stop control");
    assert.equal((question.match(/aria-label="停止当前任务"/g) ?? []).length, 1);
    assert(question.includes("<span>停止</span>"));
    assert(!question.includes(">停止当前任务</button>"), "no separate stop button appears outside the composer");
    assert.equal(
      (question.match(/id="assistant-composer-input"/g) ?? []).length,
      1,
    );
    assert(question.includes("补充回答沿用这次请求，不会另取创作报价"));
    assert(!question.includes("获取本回合报价"));
    assert(!question.includes("回合"));
    const coverArtifact: AssistantArtifact = {
      ...session.artifacts[0]!, artifactId: "cover-plan", version: 3, kind: "xhs-cover-plan",
      content: { ...session.artifacts[0]!.content, title: "封面研究方案", body: "基于真实图片的三种设计方向", titles: [], tags: [], sources: [], scope: "实际观察1/3张封面", coverPlan: {
        summary: "历史原稿：候选80，去重后194；基于真实图片的三种设计方向",
        schemes: ["大字标题", "留白主体", "分栏对比"].map((name, index) => ({ schemeId: index === 0 ? "keep-plans" : `scheme-${index}`, name, layout: `布局说明${index}`, palette: `配色说明${index}`, prompt: `完整提示词${index}\n请保留文字与主体关系`, aspectRatio: "3:4", sourceIds: ["cover-source"] })),
        evidence: { queryRunId: 1, visionRunId: 2, reportId: 3, candidateCount: 8, selectedCount: 3, downloadedCount: 2, analyzedCount: 2, observedCount: 1, keyword: "AI工具", startDate: "2026-10-01", scope: "样本不足，仅限本次可观察图片", failed: [{ sourceId: "failed-cover", status: "download_failed" }], unreadable: [{ sourceId: "unreadable-cover", uncertainties: ["标题模糊"] }], samples: [{
          sourceId: "cover-source", resultId: 4, title: "真实封面来源", url: "https://example.com/cover-note", coverUrl: "https://supplier.example/private-image", authorName: null, userId: null, publicTime: null, fans: null, collectedCount: null, useShareCount: null, useCommentCount: null, useLikeCount: null, interactiveCount: null, sha256: "sample-sha", fileKey: "covers/sample key", observation: { sourceId: "cover-source", status: "observed", text: "可见大字标题", subject: "工具界面", colors: "黑白蓝", layout: "上文下图", uncertainties: ["小字无法辨认"] },
        }] },
      } },
    };
    const coverQuestion = {
      ...session.turn!, phase: "waiting_question" as const, status: "waiting", calls: [],
      question: { questionId: "choose-cover", text: "请选择一个封面方向，也可补充修改要求。", coverPlan: {
        artifactId: coverArtifact.artifactId, version: coverArtifact.version,
        schemes: coverArtifact.content.coverPlan!.schemes.map(({ schemeId, name }) => ({ schemeId, name })),
        imageAvailable: true, imageUnavailableReason: null, feeNotice: "选择本身不代表批准费用，单张图片另行确认报价。",
      } },
    };
    const sparseCover = structuredClone(coverArtifact);
    for (const scheme of sparseCover.content.coverPlan!.schemes) { scheme.layout = ""; scheme.palette = ""; }
    const sparseCoverHtml = renderToStaticMarkup(createElement(CoverPlanBody, { artifact: sparseCover }));
    const designsHtml = sparseCoverHtml.slice(0, sparseCoverHtml.indexOf("查看研究依据"));
    assert(!designsHtml.includes(">布局</dt>"));assert(!designsHtml.includes(">配色</dt>"));
    assert(designsHtml.includes("完整提示词0"));assert(designsHtml.includes("方案 3"));
    assert.equal(coverArtifact.content.coverPlan!.schemes[0]!.layout, "布局说明0", "rendering absent optional fields does not mutate saved plans");
    const coverHtml = render(AssistantConversation, { data: { me, options, session: { ...session, artifacts: [coverArtifact], turn: coverQuestion } } });
    assert(coverHtml.includes('aria-label="封面方案：封面研究方案"'));
    assert(coverHtml.includes("小红书封面方案"));
    assert(coverHtml.includes("参考了 1 张可读封面。部分选定样本未能读取"));
    assert(coverHtml.includes("纳入候选 8 张 · 选定 3 张 · 已下载 2 张 · 已分析 2 张 · 可读 1 张"));
    assert(coverHtml.indexOf('aria-label="封面方案 3：') < coverHtml.indexOf("查看研究依据"));
    assert.match(coverHtml, /<details[^>]*><summary[^>]*>查看研究依据<\/summary>/);
    assert.equal((coverHtml.match(/历史原稿：候选80，去重后194/g) ?? []).length, 1);
    assert(coverHtml.indexOf("查看原稿摘要") > coverHtml.indexOf("查看研究依据"));
    assert(!coverHtml.slice(0, coverHtml.indexOf("查看研究依据")).includes("候选80"));
    const choicesHtml = coverHtml.slice(coverHtml.indexOf('class="assistant-cover-choices"'), coverHtml.indexOf('</fieldset>'));
    for (let index = 0; index < 3; index++) {
      assert(choicesHtml.includes(`布局说明${index}`));
      assert(choicesHtml.includes(`配色说明${index}`));
    }
    assert(coverHtml.includes("样本不足，仅限本次可观察图片"));
    assert(coverHtml.includes("选择封面方案"));
    for (let index = 0; index < 3; index++) {
      assert(coverHtml.includes(`完整提示词${index}`));
      assert(coverHtml.includes(`布局说明${index}`));
      assert(coverHtml.includes(`复制方案 ${index + 1} 提示词`));
    }
    assert.equal((coverHtml.match(/aria-label="封面方案 [123]：/g) ?? []).length, 3);
    assert.equal((coverHtml.match(/class="assistant-cover-choice"/g) ?? []).length, 4);
    assert(coverHtml.includes("只保存方案"));
    assert.equal((coverHtml.match(/<input type="radio"/g) ?? []).length, 4);
    const coverChoiceValues = [...coverHtml.matchAll(/<input type="radio"[^>]*value="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(coverChoiceValues, ["scheme:keep-plans", "scheme:scheme-1", "scheme:scheme-2", "keep-plans"]);
    assert(!coverHtml.match(/<input type="radio"[^>]*checked=""/), "cover choices start unselected");
    assert.match(coverHtml, /<button[^>]*disabled=""[^>]*>按这套生成<\/button>/);
    assert(coverHtml.includes("选一个封面方案"));
    assert.equal((coverHtml.match(/选好后查看生成费用。/g) ?? []).length, 1);
    assert(!coverHtml.includes(coverQuestion.question.coverPlan.feeNotice));
    const taskCredits={amount:34,consumed:0,released:0,state:"reserved" as const};
    const includedCover=render(AssistantConversation,{data:{me,options,session:{...session,artifacts:[coverArtifact],turn:{...coverQuestion,credits:taskCredits}}}});
    assert(includedCover.includes("选好后继续生成。"));assert(!includedCover.includes("选好后查看生成费用。"));
    const includedCall=render(AssistantConversation,{data:{me,options,session:{...session,turn:{...session.turn!,credits:taskCredits,calls:[{...session.turn!.calls[0]!,quote:{...session.turn!.calls[0]!.quote!,amount:0}}]}}}});
    assert(includedCall.includes("已包含在本次任务中"));
    assert(!includedCall.includes("当时检索报价")&&!includedCall.includes("独立检索费用"));
    assert(!/批准(?:分析|生成|查询|检索)并占用积分/.test(includedCall));

    assert(coverHtml.includes("/api/tools/assets/covers%2Fsample%20key/content"));
    assert(coverHtml.includes('href="https://example.com/cover-note"'));
    assert(coverHtml.includes("可见大字标题") && coverHtml.includes("小字无法辨认"));
    assert(!coverHtml.includes("supplier.example"));
    assert(!coverHtml.includes("编辑稿件") && !coverHtml.includes("转交助手"));
    assert(!coverHtml.includes("文章草稿"));
    const unavailableCover = render(AssistantConversation, { data: { me, options, session: { ...session, artifacts: [coverArtifact], turn: { ...coverQuestion, question: { ...coverQuestion.question, coverPlan: { ...coverQuestion.question.coverPlan, imageAvailable: false, imageUnavailableReason: "图片服务暂不可用" } } } } } });
    assert.equal((unavailableCover.match(/<input type="radio"[^>]*disabled=""/g) ?? []).length, 3);
    assert.match(unavailableCover, /<input type="radio"[^>]*value="keep-plans"(?![^>]*disabled)[^>]*\/>/);
    assert(unavailableCover.includes("图片服务暂不可用"));
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
    const previousDelivery = { turnId: "previous-turn", artifactId: "draft", version: 2, kind: "xhs-note" as const, title: "前轮稿件" };
    const emptyResearchSession: AssistantSession = {
      ...session,
      messages: [
        { id: "previous-request", seq: 1, role: "user", text: "上一轮写作需求", turnId: "previous-turn" },
        { id: "empty-request", seq: 2, role: "user", text: "仅查询本次时间范围", turnId: "empty-turn" },
        { id: "empty-response", seq: 3, role: "assistant", text: "本次范围没有查到可用文章，未生成新稿。", turnId: "empty-turn" },
      ],
      turn: {
        ...session.turn!, turnId: "empty-turn", phase: "completed", status: "completed",
        activities: [{ id: "call:empty-search", kind: "search_wechat_articles", state: "completed" }],
        calls: [{ ...session.turn!.calls[0]!, name: "search_wechat_articles", state: "completed", result: { results: [], limited: false } }],
      },
    };
    for (const deliveries of [undefined, [], [previousDelivery]]) {
      const emptyResearch = render(AssistantConversation, { data: { me, options, session: { ...emptyResearchSession, deliveries } } });
      assert(!emptyResearch.includes("assistant-task-artifacts"), "an empty current search must not offer an old draft as its result, including older snapshots");
      assert(emptyResearch.includes("本次范围没有查到可用文章，未生成新稿。"));
      assert(emptyResearch.includes('aria-label="会话作品"') && emptyResearch.includes("可读正文"), "historical artifacts stay available in the workspace");
      const summary = emptyResearch.match(/<span[^>]*class="assistant-execution-phase"[^>]*>[\s\S]*?<\/span>/)?.[0] ?? "";
      assert(summary.includes("已处理完成"));
      assert(!summary.includes("稿件已保存"));
      assert.equal((emptyResearch.match(/data-delivery-artifact-id="draft"/g) ?? []).length, deliveries?.length ?? 0);
      const savedConversation = emptyResearch.slice(emptyResearch.indexOf('aria-label="已保存的对话"'));
      if (deliveries?.length) assert(savedConversation.indexOf('data-delivery-artifact-id="draft"') < savedConversation.indexOf("仅查询本次时间范围"), "the previous delivery remains beside its own request");
    }
    const projectedEmptySave = render(CurrentTask, {
      session: { ...emptyResearchSession, deliveries: [], turn: { ...emptyResearchSession.turn!, activities: [{ id: "call:save", kind: "save_draft", state: "completed" }] } },
      csrf: me.csrf, pending: false, reading: false, readError: null, refresh: async () => {}, control: async () => {}, showArtifacts() {}, setView() {},
    });
    const emptySaveSummary = projectedEmptySave.match(/<span[^>]*class="assistant-execution-phase"[^>]*>[\s\S]*?<\/span>/)?.[0] ?? "";
    assert(emptySaveSummary.includes("已处理完成") && !emptySaveSummary.includes("稿件已保存"), "an explicit empty delivery projection takes precedence over a save activity label");
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
    for (const overrides of [
      { pending: true },
      { reading: true },
      { readError: "读取中断" },
      { session: { ...session, archived: true, turn: coverQuestion } },
      { session: { ...session, turn: { ...coverQuestion, status: "needs_review" } } },
    ]) {
      const blockedChoice = render(CurrentTask, { ...taskProps, session: { ...session, turn: coverQuestion }, ...overrides });
      assert.equal((blockedChoice.match(/<input type="radio"[^>]*disabled=""/g) ?? []).length, 4);
      assert.match(blockedChoice, /<button[^>]*disabled=""[^>]*>按这套生成<\/button>/);
      assert.match(blockedChoice, /<button(?![^>]*\sdisabled=)[^>]*>查看方案 · 版本 3<\/button>/);
    }
    function renderTask(turn: NonNullable<AssistantSession["turn"]>, artifacts = session.artifacts, readError: string | null = null) {
      return render(CurrentTask, { ...taskProps, session: { ...session, turn, artifacts }, readError });
    }
    const executingTurn = { ...session.turn!, phase: "executing" as const, status: "active", calls: [] };
    const executing = renderTask(executingTurn);
    assert(!executing.includes('class="assistant-execution" open=""'), "execution detail starts collapsed while live status stays visible");
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
      assert(!result.includes("查看会话作品"), "delivery links belong to their persisted message slot");
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
    assert(interrupted.includes("连接暂时中断，已保留上次内容"));
    assert(interrupted.includes("上次已知：已批准，处理中"));
    assert(!interrupted.includes("assistant-activity-dot"));
    const awaitingAnswer = renderTask({ ...executingTurn, phase: "waiting_question", status: "waiting", question: { questionId: "question", text: "还需哪些材料？" } });
    assert(awaitingAnswer.indexOf("回答这个问题") > awaitingAnswer.indexOf("</details>"));
    assert(awaitingAnswer.includes("需要你补充") && awaitingAnswer.includes("还需哪些材料？"));
    assert(!awaitingAnswer.includes("assistant-activity-dot"));
    const reconnecting = render(CurrentTask, {
      ...taskProps, session: { ...session, turn: executingTurn }, reading: true, readError: "读取失败",
    });
    assert(reconnecting.includes("正在重新连接，已保留上次内容"));
    assert(!reconnecting.includes("assistant-activity-dot"));
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
    assert(!history.includes("创作技能") && !history.includes("创作接口"));
    assert(history.includes("正在处理"));
    assert(!history.includes("正在处理你的创作需求"));
    for (const [kind, label] of [
      ["search_xhs_notes", "正在查找参考笔记"],
      ["search_wechat_articles", "正在查找参考文章"],
      ["analyze_xhs_research", "正在整理参考笔记"],
      ["analyze_wechat_research", "正在分析参考文章"],
    ] as const) {
      const business = renderTask({ ...executingTurn, activities: [{ id: `business:${kind}`, kind, state: "running" }] });
      const summary = business.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0] ?? "";
      assert(summary.includes(label));
      assert(!summary.includes("创作接口") && !summary.includes("加载"));
    }
    const onlyTechnical = renderTask({ ...executingTurn, activities: [{ id: "only-model", kind: "model_request", state: "running" }] });
    assert.match(onlyTechnical, /<li class="assistant-execution-step">[\s\S]*?<p>正在处理<\/p>/, "expansion remains readable when only internal preparation exists");
    const oldReply = "I will load the skill. 加载模块是这条历史回复的原文。";
    const preservedReply = render(AssistantConversation, { data: { me, options, session: { ...session, messages: [...session.messages, { id: "historical-technical", seq: 99, role: "assistant", text: oldReply, turnId: "turn" }] } } });
    assert(preservedReply.includes(oldReply), "model replies are never removed by frontend keywords");
    const correcting = renderTask({ ...projected, activities: [
      ...projected.activities.slice(0, 3),
      { id: "call:invalid-draft", kind: "save_draft", state: "failed" },
      projected.activities[3]!,
    ] });
    const correctingSummary = correcting.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0] ?? "";
    assert(correctingSummary.includes("正在处理"));
    assert(!correctingSummary.includes("调用创作接口"));
    assert(correctingSummary.includes("assistant-activity-dot"));
    assert(correcting.includes("保存稿件 · 失败"), "the earlier failure remains in the execution history");
    const generated = renderTask({ ...completedTurn, activities: [
      ...projected.activities.slice(0, 3),
      { id: "model:m2", kind: "model_request", state: "completed" },
      { id: "call:draft", kind: "save_draft", state: "completed" },
    ] });
    assert(!generated.includes("创作技能") && !generated.includes("稿件内容已返回"));
    assert(generated.includes("稿件已保存"));
    assert(!generated.includes("创作接口已返回"));
    const savedCover = renderTask({ ...completedTurn, activities: [{ id: "call:cover-plan", kind: "save_xhs_cover_plan", state: "completed" }] }, [coverArtifact]);
    assert(savedCover.includes("封面方案已保存"));
    assert(!savedCover.includes("稿件已保存") && !savedCover.includes("图片已保存"));
    const savedCoverImage = renderTask({ ...completedTurn, activities: [
      { id: "call:cover-plan", kind: "save_xhs_cover_plan", state: "completed" },
      { id: "call:cover-image", kind: "generate_image", state: "completed" },
    ] }, [coverArtifact]);
    const savedImageSummary = savedCoverImage.match(/<summary[^>]*>[\s\S]*?<\/summary>/)?.[0] ?? "";
    assert(savedImageSummary.includes("图片已保存"));
    assert(!savedImageSummary.includes("封面方案已保存"));
    const deliveredImage: AssistantArtifact = { ...session.artifacts[0]!, artifactId: "delivered-image", version: 1, kind: "image", content: { ...session.artifacts[0]!.content, title: "本次封面图片", fileKey: "generated/current.png", planReference: { artifactId: coverArtifact.artifactId, version: 3, schemeId: "scheme-1" } } };
    const imageResultCall = { ...session.turn!.calls[0]!, callId: "delivered-call", name: "generate_image", state: "completed", result: { artifactId: deliveredImage.artifactId, version: 1, kind: "image" } };
    const deliveredTurn = { ...completedTurn, calls: [imageResultCall] };
    const resultHtml = render(AssistantConversation, { data: { me, options, session: { ...session, artifacts: [coverArtifact, deliveredImage], turn: deliveredTurn } } });
    assert.equal((resultHtml.match(/data-delivery-artifact-id="delivered-image"/g) ?? []).length, 1);
    assert(resultHtml.includes('data-delivery-version="1"'));
    assert(resultHtml.includes('aria-label="下载图片：本次封面图片 · 第 1 版"'));
    assert(!resultHtml.includes("查看会话作品"));
    assert(resultHtml.includes("生成的封面 · 本次封面图片"));
    assert(resultHtml.includes("三套设计方案 · 封面研究方案"));
    assert.match(resultHtml, /<div hidden=""><article[^>]*aria-label="封面方案：封面研究方案"/);
    assert.match(resultHtml, /<option value="delivered-image" selected="">/);
    assert(resultHtml.includes('src="/api/tools/assets/generated%2Fcurrent.png/content"'));
    assert.equal((resultHtml.match(/aria-label="下载图片：本次封面图片 · 第 1 版"/g) ?? []).length, 2, "the image and its delivery row share the download control");
    assert(resultHtml.includes("历史版本"));
    const genericImage = { ...deliveredImage, content: { ...deliveredImage.content, planReference: undefined } };
    const genericResult = render(AssistantConversation, { data: { me, options, session: { ...session, artifacts: [genericImage], turn: deliveredTurn, messages: session.messages.filter((message) => message.role === "user") } } });
    assert(genericResult.includes("图片已生成。"));
    assert(!genericResult.includes("封面已生成"));
    for (const result of [null, { artifactId: "missing", version: 1, kind: "image" }, { artifactId: deliveredImage.artifactId, version: 2, kind: "image" }]) {
      assert(!renderTask({ ...deliveredTurn, calls: [{ ...imageResultCall, result }] }, [coverArtifact, deliveredImage]).includes("· 查看图片"));
    }

    const coverMessages = [
      { id: "cover-request", seq: 1, eventSeq: 10, role: "user" as const, turnId: "turn", text: "这次做三套封面" },
      { id: "cover-question", seq: 2, eventSeq: 40, role: "assistant" as const, turnId: "turn", text: "三套已保存，请选一个方向" },
      { id: "cover-answer", seq: 3, eventSeq: 60, role: "user" as const, turnId: "turn", text: "我选择第二套方案" },
    ];
    const planDelivery = { turnId: "turn", artifactId: coverArtifact.artifactId, version: 3, kind: "xhs-cover-plan" as const, title: coverArtifact.content.title, eventSeq: 30 };
    const imageDelivery = { turnId: "turn", artifactId: deliveredImage.artifactId, version: 1, kind: "image" as const, title: deliveredImage.content.title, eventSeq: 90 };
    const plansBeforeChoice = render(AssistantConversation, { data: { me, options, session: { ...session, artifacts: [coverArtifact], messages: coverMessages.slice(0, 2), deliveries: [planDelivery], turn: coverQuestion } } });
    const coversAfterChoice = render(AssistantConversation, { data: { me, options, session: { ...session, artifacts: [coverArtifact, deliveredImage], messages: coverMessages, deliveries: [planDelivery, imageDelivery], turn: deliveredTurn } } });
    const planMarker = `data-delivery-artifact-id="${coverArtifact.artifactId}"`;
    const imageMarker = `data-delivery-artifact-id="${deliveredImage.artifactId}"`;
    const savedCoverMessages = coversAfterChoice.slice(coversAfterChoice.indexOf('aria-label="已保存的对话"'));
    assert(savedCoverMessages.includes(planMarker) && savedCoverMessages.includes(imageMarker));
    assert(plansBeforeChoice.indexOf(planMarker) < plansBeforeChoice.indexOf("三套已保存，请选一个方向"));
    assert(savedCoverMessages.indexOf(planMarker) < savedCoverMessages.indexOf("三套已保存，请选一个方向"));
    assert(savedCoverMessages.indexOf("三套已保存，请选一个方向") < savedCoverMessages.indexOf("我选择第二套方案"));
    assert(savedCoverMessages.indexOf("我选择第二套方案") < savedCoverMessages.indexOf(imageMarker));
    assert.equal((coversAfterChoice.match(/data-delivery-artifact-id="cover-plan"/g) ?? []).length, 1);
    assert.equal((coversAfterChoice.match(/data-delivery-artifact-id="delivered-image"/g) ?? []).length, 1);

    const writingDeliveries = [
      { turnId: "old-turn", artifactId: "draft", version: 1, kind: "xhs-note" as const, title: "第一版标题" },
      { turnId: "turn", artifactId: "draft", version: 2, kind: "xhs-note" as const, title: "真实稿件" },
    ];
    const deliveredWriting = { ...session, deliveries: writingDeliveries, turn: { ...completedTurn, credits: { amount: 200, consumed: 200, released: 0, state: "settled" as const } }, messages: [
      { id: "old-user", seq: 1, role: "user" as const, text: "第一次需求", turnId: "old-turn" },
      { id: "old-response", seq: 2, role: "assistant" as const, text: "第一版原话已保留", turnId: "old-turn" },
      ...session.messages.map((message) => ({ ...message, seq: message.seq + 2 })),
    ] };
    const writingHtml = render(AssistantConversation, { data: { me, options, session: deliveredWriting } });
    assert.equal((writingHtml.match(/data-delivery-artifact-id="draft"/g) ?? []).length, 2);
    assert(writingHtml.includes('data-delivery-version="1"') && writingHtml.includes('data-delivery-version="2"'));
    assert(writingHtml.indexOf('data-delivery-version="1"') < writingHtml.lastIndexOf("用户已提交材料"));
    assert(!writingHtml.includes("作品已更新") && !writingHtml.includes("查看会话作品"));
    assert(!writingHtml.includes("已保存第 2 版。"), "an existing assistant reply is not repeated");
    assert(writingHtml.includes("本次用了 200 积分。"));
    assert.match(writingHtml, /class="assistant-execution-phase"[^>]*>稿件已保存<\/span>/, "a persisted current delivery proves completion even without activity records");
    assert(!writingHtml.includes("已释放") && !writingHtml.includes("另有 0 积分"));
    assert.equal((writingHtml.match(/aria-label="复制需求"/g) ?? []).length, 2);
    assert.equal((writingHtml.match(/aria-label="复制回复"/g) ?? []).length, 2);
    const withoutReply = render(AssistantConversation, { data: { me, options, session: { ...deliveredWriting, messages: session.messages.filter((message) => message.role === "user"), deliveries: [writingDeliveries[1]] } } });
    assert(withoutReply.includes("已保存第 2 版。"));
    const refund = renderTask({ ...completedTurn, credits: { amount: 580, consumed: 200, released: 380, state: "settled" } });
    assert(refund.includes("本次用了 200 积分，另有 380 积分已退回可用余额。"));
    const unfinal = renderTask({ ...completedTurn, phase: "needs_review", status: "needs_review", credits: { amount: 580, consumed: 0, released: 0, state: "review" } });
    assert(unfinal.includes("580 积分暂时保留，尚未扣除"));
    assert.equal(unfinal.match(/580/g)?.length, 1);
    assert(!unfinal.includes("本次用了") && !unfinal.includes("退回可用余额"));
    const noFile = render(AssistantConversation, { data: { me, options, session: { ...session, deliveries: [{ turnId: "turn", artifactId: genericImage.artifactId, version: 1, kind: "image", title: "无文件" }], artifacts: [{ ...genericImage, content: { ...genericImage.content, fileKey: "" } }], turn: completedTurn } } });
    assert(noFile.includes('aria-label="下载图片：无文件 · 第 1 版"'), "a historical image can request its exact version on click even without a snapshot file");
    const historicalImages = render(AssistantConversation, { data: { me, options, session: { ...session, deliveries: [
      { ...imageDelivery, version: 1, title: "旧版封面" }, { ...imageDelivery, version: 2, title: "新版封面" },
    ], artifacts: [{ ...genericImage, version: 2 }], turn: completedTurn } } });
    assert(historicalImages.includes('aria-label="下载图片：旧版封面 · 第 1 版"'));
    assert(historicalImages.includes('aria-label="下载图片：新版封面 · 第 2 版"'));
    const stoppedWithRunningHistory = renderTask({ ...projected, phase: "stopped", status: "stopped" });
    assert(!stoppedWithRunningHistory.includes("assistant-activity-dot"));
    const questionWithRunningHistory = renderTask({ ...projected, phase: "waiting_question", status: "waiting", question: { questionId: "wait", text: "请补充主题" } });
    assert(!questionWithRunningHistory.includes("assistant-activity-dot"));

    const modelActivity: AssistantActivity = { id: "model:single", kind: "model_request", state: "completed" };
    const toolActivity = (kind: AssistantActivity["kind"], index = 0): AssistantActivity => ({
      id: `call:${kind}:${index}`, kind, state: "preparing",
    });
    const modelThenTools = (tools: AssistantActivity[], state: AssistantActivity["state"] = "completed") =>
      renderTask({ ...executingTurn, activities: [{ ...modelActivity, state }, ...tools] }, []);
    assert(modelThenTools([]).includes("正在处理"));
    const mixed = modelThenTools([toolActivity("load_skill"), toolActivity("save_draft")]);
    assert(mixed.includes("准备保存稿件"));
    assert(!mixed.includes("已选择创作技能"));
    assert(!mixed.includes("稿件内容已返回"));
    const repeated = modelThenTools([toolActivity("load_skill"), toolActivity("load_skill", 1)]);
    assert(repeated.includes("正在处理"));
    assert(!repeated.includes("创作技能"));
    assert(!repeated.includes("已返回下一步处理安排"));
    assert(modelThenTools([toolActivity("ask_question")]).includes("准备补充信息"));
    assert(!modelThenTools([toolActivity("read_skill_reference")]).includes("技能资料"));
    for (const state of ["running", "preparing", "waiting"] as const) {
      const pendingModel = modelThenTools([toolActivity("save_draft")], state);
      assert(pendingModel.includes("正在处理"));
      assert(!pendingModel.includes("创作接口"));
      assert(!pendingModel.includes("稿件内容已返回"));
      assert(!pendingModel.includes("稿件已保存"));
    }
    const proposedSearch = modelThenTools([{ ...toolActivity("search_xhs_notes"), state: "waiting", keyword: "咖啡" }]);
    assert(!proposedSearch.includes("已提出笔记检索需求"));
    assert(proposedSearch.includes("等待处理 · 查询“咖啡”"));
    assert(!proposedSearch.includes("查询结果已返回"));
    const completedSearch = modelThenTools([{ ...toolActivity("search_xhs_notes"), state: "completed", keyword: "咖啡" }]);
    assert(!completedSearch.includes("已提出笔记检索需求"));
    assert(completedSearch.includes("查询“咖啡” · 查询结果已返回"));
    const analysisPending = modelThenTools([toolActivity("analyze_xhs_research")]);
    assert(!analysisPending.includes("爆款规律分析已返回"));
    assert(analysisPending.includes("准备整理爆款规律"));
    assert(!analysisPending.includes("已保存爆款规律分析"));
    const analysisSaved = modelThenTools([{ ...toolActivity("analyze_xhs_research"), state: "completed" }]);
    assert(analysisSaved.includes("已保存爆款规律分析"));
    const analysisFailed = modelThenTools([{ ...toolActivity("analyze_xhs_research"), state: "failed" }]);
    assert(analysisFailed.includes("整理爆款规律 · 失败"));
    assert(!analysisFailed.includes("已保存爆款规律分析"));
    const waitingHistory = renderTask({ ...projected, status: "waiting", activities: projected.activities.map((a) => a.id === "model:m2" ? { ...a, state: "waiting" as const } : a) });
    assert(waitingHistory.includes("正在处理"));
    assert(!waitingHistory.includes("创作接口"));
    assert(waitingHistory.includes("assistant-activity-dot"), "the task phase remains the processing authority when activities are waiting");
    const onlyCompleted = { ...projected, activities: projected.activities.slice(0, 3) };
    for (const phase of ["executing", "waiting_child"] as const) {
      for (const activities of [undefined, [], projected.activities.slice(0, 1), onlyCompleted.activities, [
        ...onlyCompleted.activities,
        { id: "call:declined", kind: "search_xhs_notes" as const, state: "rejected" as const },
      ]]) {
        const queued = renderTask({ ...onlyCompleted, phase, activities });
        const summary = queued.slice(queued.indexOf("<summary"), queued.indexOf("</summary>"));
        assert(summary.includes("正在处理"));
        assert(summary.includes('data-state="active"'));
        assert(!summary.includes('data-state="done"'));
        assert(queued.includes("assistant-activity-dot"));
        if (activities?.length) {
          assert(queued.includes("已收到请求"));
          assert(queued.includes('data-state="done"'));
        }
      }
    }
    for (const state of ["preparing", "waiting", "completed", "failed", "needs_review", "stopped", "rejected"] as const) {
      const inactiveDetail = renderTask({ ...executingTurn, activities: [{ id: `detail:${state}`, kind: "generate_image", state }] });
      const summary = inactiveDetail.slice(inactiveDetail.indexOf("<summary"), inactiveDetail.indexOf("</summary>"));
      assert(summary.includes("正在处理") && summary.includes('data-state="active"'));
      assert(!summary.includes("正在生成图片"), "an inactive activity cannot supply a current business action");
    }
    const disconnectedHistory = renderTask({
      ...executingTurn,
      activities: [
        { id: "saved-search", kind: "search_wechat_articles", state: "completed", keyword: "职场" },
        { id: "last-running-step", kind: "save_draft", state: "running" },
      ],
    }, session.artifacts, "连接失败");
    assert(disconnectedHistory.includes("公众号热文查询结果已返回"));
    assert(disconnectedHistory.includes("上次已知：正在保存稿件"));
    assert(!disconnectedHistory.includes("assistant-activity-dot"));
    const missingQuestion = renderTask({ ...executingTurn, phase: "waiting_question", status: "waiting", question: null });
    assert(missingQuestion.includes("等待你的回答") && !missingQuestion.includes("assistant-activity-dot"));
    for (const [phase, status, label, icon] of [
      ["waiting_question", "waiting", "需要你补充", "waiting"],
      ["waiting_approval", "waiting", "等待费用确认", "waiting"],
      ["stopped", "stopped", "已停止", "stopped"],
      ["completed", "completed", "已处理完成", "done"],
      ["needs_review", "needs_review", "本次结果需要核对", "attention"],
      ["failed", "failed", "本次处理已结束", "attention"],
    ] as const) {
      const staleRunning = renderTask({
        ...executingTurn, phase, status,
        question: phase === "waiting_question" ? { questionId: "stale-running-question", text: "请补充主题" } : null,
        activities: [{ id: "stale-image", kind: "generate_image", state: "running" }],
      });
      const summary = staleRunning.slice(staleRunning.indexOf("<summary"), staleRunning.indexOf("</summary>"));
      assert(summary.includes(label) && summary.includes(`data-state="${icon}"`));
      assert(!staleRunning.includes("assistant-activity-dot"), "stale running history cannot animate an inactive phase");
      assert(staleRunning.includes("上次记录："), "a stale business step stays readable as history");
      const detail = staleRunning.slice(staleRunning.indexOf('class="assistant-execution-step"'));
      assert(detail.includes(`data-state="${phase === "completed" ? "waiting" : icon}"`), "turn completion alone does not prove a stale activity completed");
    }
    const stoppedHistory = renderTask({ ...onlyCompleted, phase: "stopped", status: "stopped" });
    assert(stoppedHistory.includes('data-state="stopped"'));
    assert(stoppedHistory.includes("已停止"));
    assert(!stoppedHistory.includes("创作技能"));
    const approvalHistory = renderTask({ ...session.turn!, activities: [
      { id: "request:t", kind: "request_received", state: "completed" },
      { id: "call:search", kind: "search_xhs_notes", state: "waiting", callId: session.turn!.calls[0]!.callId, keyword: "咖啡" },
    ] });
    assert(approvalHistory.includes("等待确认查询“咖啡”"));
    assert.equal((approvalHistory.match(/data-call-id=/g) ?? []).length, 1);
    assert(approvalHistory.indexOf("批准检索并占用积分") > approvalHistory.indexOf("</details>"));
    assert(approvalHistory.includes("外部检索服务"));
    assert(!approvalHistory.includes("Redfox"));
    const imageWaiting = renderTask({
      ...session.turn!,
      calls: [{ ...session.turn!.calls[0]!, callId: "call-image", name: "generate_image", input: { prompt: "窗边橘猫", size: "1:1" } }],
      activities: [{ id: "call:image", kind: "generate_image", state: "waiting", callId: "call-image" }],
    });
    assert(imageWaiting.includes("等待确认图片生成"));
    assert(!imageWaiting.includes("等待确认查询参考笔记"));
    const wechatWaiting = renderTask({
      ...session.turn!,
      calls: [{ ...session.turn!.calls[0]!, callId: "call-wechat", name: "search_wechat_articles", input: { keyword: "职场成长", startDate: "2026-10-26", endDate: "2026-11-02" } }],
      activities: [{ id: "call:wechat", kind: "search_wechat_articles", state: "waiting", callId: "call-wechat", keyword: "职场成长" }],
    });
    assert(wechatWaiting.includes("等待确认公众号查询“职场成长”"));
    const rejected = renderTask({ ...completedTurn, calls: [{ ...running, state: "rejected" }] });
    assert(rejected.includes("你已拒绝请求"));
    assert(!rejected.includes("assistant-activity-dot"));
  } finally {
    await bundle.close();
    await rm(directory, { recursive: true, force: true });
  }
});
