const messages = {
  "en": {
    "navComparison": "Codex & GWI",
    "comparisonEyebrow": "CHOOSING A WORKFLOW",
    "comparisonTitle": "Codex directly or through GWI",
    "comparisonIntro": "Codex already supports goals, skills, review and subagents. It provides the reasoning and tools in both routes; GWI adds project-level workflow configuration, supervision and records.",
    "comparisonWork": "Work",
    "comparisonDirect": "Codex directly",
    "comparisonGwi": "Through GWI",
    "comparisonStart": "Start and adapt",
    "comparisonStartDirect": "Describe a goal; let Codex plan, delegate and adapt in the conversation.",
    "comparisonStartGwi": "Describe an outcome for the coordinator to choose existing workflows, or run a saved pipeline directly. Decisions and progress stay recorded.",
    "comparisonSupervise": "Supervise",
    "comparisonSuperviseDirect": "Read chat and agent activity, inspect changes, and steer the next action.",
    "comparisonSuperviseGwi": "Follow named stages, owners, handoffs, artifacts and pending human decisions in one workbench.",
    "comparisonCheck": "Check and deliver",
    "comparisonCheckDirect": "Ask Codex for checks/review and follow your project's acceptance and publication process.",
    "comparisonCheckGwi": "Configured verification and human gates organize evidence, revision requests and delivery decisions.",
    "comparisonReuse": "Reuse and recover",
    "comparisonReuseDirect": "Reuse instructions and skills; resume or fork a conversation to continue work.",
    "comparisonReuseGwi": "Reuse versioned roles, pipelines and selected knowledge. Keep earlier attempts and check external progress before continuing failed work.",
    "comparisonFit": "Use Codex directly for a focused fix or exploration with less setup. Choose GWI when repeatable work needs several handoffs or regular human review. GWI requires local GWI/Multica services and adds coordination/context overhead; faster or cheaper completion still needs measurement.",
    "comparisonReferences": "Native capability references:",
    "comparisonNativeDocs": "Goals, review and skills",
    "comparisonSubagents": "Subagents",
    "navigationLabel": "Main navigation",
    "workflowLabel": "Example workflow",
    "resourcesLabel": "Resources",
    "terminal": "Terminal",
    "skip": "Skip to content",
    "navWorkflow": "Product",
    "navSetup": "Run locally",
    "eyebrow": "LOCAL PROJECT ITERATION",
    "title": "A local workbench<br>for projects using Codex.",
    "intro": "Use Codex to move a project forward. Follow the implementation, independent checks and delivery decisions in one local workbench.",
    "setup": "Run GWI locally",
    "guide": "Read the guide",
    "heroNote": "Configuration and run history are stored locally. Selected context goes to your model provider.",
    "balance": "Room for Codex to adapt.<br>Clear boundaries for the work.",
    "principle": "Read the product approach →",
    "startEyebrow": "ON YOUR MACHINE",
    "startTitle": "Run GW-Iterator locally",
    "startBody": "GWI connects a local web interface to Multica and your authenticated Codex installation. It does not require a hosted GWI account.",
    "requirements": "Node.js 24–26 · Git · curl · Docker Compose · Codex<br>GitHub operations also require an authenticated gh CLI.",
    "platformNote": "Native execution is verified on macOS. Other hosts must pass the setup checks.",
    "setupDetails": "Prerequisites and setup checks →",
    "copy": "Copy",
    "copied": "Commands copied",
    "copyFailed": "Select and copy the commands above.",
    "openLocal": "Then open",
    "footer": "Built with Codex and Multica. GWI source: Apache-2.0; dependencies have their own terms.",
    "source": "Source",
    "docs": "Docs",
    "issues": "Issues",
    "notices": "Notices",
    "pageTitle": "GW-Iterator — A workbench for project iteration",
    "description": "A local workbench for project iteration with Codex and Multica. Follow work, review changes, and keep decisions together.",
    "tourEyebrow": "PRODUCT WALKTHROUGH",
    "tourTitle": "Follow a change through GWI",
    "tourNote": "One example project.<br>Choose a view to explore it.",
    "tourProject": "Project website",
    "tourCase": "Language parity",
    "tourExample": "Illustrative example",
    "tourViews": "Product views",
    "moduleProjects": "Projects",
    "moduleWorkbench": "Workbench",
    "modulePipelines": "Pipelines",
    "moduleTeam": "Team",
    "moduleKnowledge": "Knowledge",
    "projectsTitle": "Choose the project that owns the work",
    "projectsBody": "Start and supervise work across projects, or open one project with its own workspace, team and knowledge.",
    "projectsNext": "Open its workbench →",
    "projectOverview": "Project overview",
    "projectCurrent": "Language parity · ready for review",
    "docsProject": "Documentation",
    "noCurrentWork": "No active work",
    "projectBoundary": "Separate project context. One place to supervise.",
    "workbenchTitle": "Start with the result you need",
    "workbenchBody": "Ask a question or describe a change. Follow the current work, inspect the result and continue from the same place.",
    "workbenchNext": "Inspect its workflow →",
    "outcomeLabel": "Outcome",
    "outcomeExample": "Keep the English and Chinese demo aligned when switching languages.",
    "workbenchEvidence": "Both language checks recorded",
    "decisionTitle": "Review delivery",
    "decisionBody": "Prepared change and check evidence",
    "pipelinesTitle": "See the handoffs, checks and return paths",
    "pipelinesBody": "Reusable workflows connect responsible roles. Dependencies can split into parallel checks, join at a review, or return a finding for bounded rework.",
    "pipelinesNext": "Meet the responsible roles →",
    "prepareStage": "Prepare content",
    "checkEnglish": "Check English",
    "checkChinese": "Check Chinese",
    "roleDevelopment": "Development",
    "roleOwner": "Owner",
    "returnFinding": "A failed check returns its finding to Development.",
    "teamTitle": "Give each role a clear responsibility",
    "teamBody": "Choose the agents, skills and tools behind the roles. Runs retain the role revision they started with.",
    "teamNext": "See what the team draws on →",
    "teamForProject": "Team for this project",
    "developmentResponsibility": "Prepare the shared demo content",
    "qaResponsibility": "Check both languages independently",
    "ownerResponsibility": "Inspect evidence and accept delivery",
    "humanLabel": "Human",
    "knowledgeTitle": "Keep context that helps the next change",
    "knowledgeBody": "Select project documents, memory sections and verified lessons. Current role-relevant excerpts enter new work; earlier runs keep their frozen context.",
    "knowledgeNext": "Continue in the workbench →",
    "knowledgeInput": "Selected project context",
    "sourceTitle": "Website requirements",
    "sourceMetadata": "Project document · current source",
    "lessonLabel": "Reviewed lesson",
    "lessonBody": "Switch language without switching the example.",
    "lessonMetadata": "Linked to the check and source work",
    "tourSettings": "Settings holds project bindings. Team and Knowledge own their configuration.",
    "tourGuide": "Read the operating guide →"
  },
  "zh-CN": {
    "navComparison": "Codex 与 GWI",
    "comparisonEyebrow": "选择工作方式",
    "comparisonTitle": "直接用 Codex，或通过 GWI 推进",
    "comparisonIntro": "Codex 本身已有 Goal、技能、review 和子 agent。两种方式都依靠它推理和调用工具；GWI 增加的是项目层面的流程配置、监督与记录。",
    "comparisonWork": "工作环节",
    "comparisonDirect": "直接用 Codex",
    "comparisonGwi": "通过 GWI",
    "comparisonStart": "开始与调整",
    "comparisonStartDirect": "描述目标，让 Codex 在会话中规划、分派工作，并随结果调整。",
    "comparisonStartGwi": "描述目标，让协调者选择已有流程；也可直接运行已保存的流水线，保留决策和进度记录。",
    "comparisonSupervise": "跟进与介入",
    "comparisonSuperviseDirect": "查看会话、agent 动态和实际修改，再补充指令推进下一步。",
    "comparisonSuperviseGwi": "在同一工作台查看步骤、负责人、交接、交付物和待人工决策。",
    "comparisonCheck": "检查与交付",
    "comparisonCheckDirect": "让 Codex 做检查或 review，并遵循项目自己的验收和发布流程。",
    "comparisonCheckGwi": "用配置好的验证步骤和人工关卡组织证据、返修意见与交付决策。",
    "comparisonReuse": "复用与恢复",
    "comparisonReuseDirect": "复用项目指令和技能，恢复或分叉会话后继续工作。",
    "comparisonReuseGwi": "复用有版本记录的角色、流水线和项目知识；保留每次尝试，确认外部任务的进度后继续未完成的工作。",
    "comparisonFit": "临时修改或探索，直接用 Codex 更省事。需要反复执行、多次交接和人工验收时，再考虑 GWI。它需要本地运行 GWI 与 Multica，额外编排也有开销；速度和费用的改善仍需测量。",
    "comparisonReferences": "原生能力参考：",
    "comparisonNativeDocs": "Goal、review 与技能",
    "comparisonSubagents": "子 agent",
    "navigationLabel": "主导航",
    "workflowLabel": "示例流程",
    "resourcesLabel": "相关资源",
    "terminal": "终端",
    "skip": "跳到正文",
    "navWorkflow": "产品",
    "navSetup": "本地启动",
    "eyebrow": "本地项目迭代工作台",
    "title": "用 Codex 做项目，<br>在 GWI 跟进迭代。",
    "intro": "用 Codex 推进项目，在同一个本地工作台跟进实现、独立检查和交付决策。",
    "setup": "在本机运行 GWI",
    "guide": "查看使用指南",
    "heroNote": "本地保存配置和记录，选定的上下文会发送给模型服务。",
    "balance": "让 Codex 灵活调整做法，<br>让迭代有清晰的边界。",
    "principle": "了解产品思路 →",
    "startEyebrow": "在你的电脑上",
    "startTitle": "本地启动 GW-Iterator",
    "startBody": "GWI 将本地 Web 界面接入 Multica 和已登录的 Codex，无需注册 GWI 云端账号。",
    "requirements": "Node.js 24–26 · Git · curl · Docker Compose · Codex<br>操作 GitHub 还需要已登录的 gh CLI。",
    "platformNote": "原生执行已在 macOS 上验证，其他系统需要通过安装检查。",
    "setupDetails": "查看环境要求和安装检查 →",
    "copy": "复制",
    "copied": "命令已复制",
    "copyFailed": "请选中并复制上方命令。",
    "openLocal": "随后打开",
    "footer": "使用 Codex 和 Multica。GWI 源码采用 Apache-2.0，依赖遵循各自条款。",
    "source": "源码",
    "docs": "文档",
    "issues": "问题反馈",
    "notices": "第三方声明",
    "pageTitle": "GW-Iterator — 项目迭代工作台",
    "description": "接入 Codex 和 Multica 的本地项目迭代工作台。跟进工作、审阅修改、保留决策。",
    "tourEyebrow": "产品导览",
    "tourTitle": "看看一次改动如何推进",
    "tourNote": "同一个示例项目。<br>选择模块，查看它们如何配合。",
    "tourProject": "项目网站",
    "tourCase": "双语内容一致性",
    "tourExample": "交互示意",
    "tourViews": "产品模块",
    "moduleProjects": "项目",
    "moduleWorkbench": "工作台",
    "modulePipelines": "流水线",
    "moduleTeam": "团队",
    "moduleKnowledge": "知识",
    "projectsTitle": "先确定这是谁的工作",
    "projectsBody": "跨项目发起和监督工作，也可以进入一个项目，使用它的工作区、团队和知识。",
    "projectsNext": "进入它的工作台 →",
    "projectOverview": "项目概览",
    "projectCurrent": "双语内容一致性 · 等待审阅",
    "docsProject": "项目文档",
    "noCurrentWork": "暂无进行中的工作",
    "projectBoundary": "各项目保留自己的上下文，在同一处监督。",
    "workbenchTitle": "从你需要的结果开始",
    "workbenchBody": "提问或描述一项改动，查看正在执行的工作，审阅结果，再接着推进。",
    "workbenchNext": "查看这项工作的流水线 →",
    "outcomeLabel": "目标",
    "outcomeExample": "切换语言时，英文和中文演示应保持内容与操作一致。",
    "workbenchEvidence": "已记录两种语言的检查结果",
    "decisionTitle": "审阅交付",
    "decisionBody": "查看准备好的改动与检查证据",
    "pipelinesTitle": "看清交接、检查和返工路径",
    "pipelinesBody": "可复用的流程连接各个负责角色。步骤可并行检查、汇合审阅，检查未通过时再返回返工。",
    "pipelinesNext": "看看由哪些角色负责 →",
    "prepareStage": "准备内容改动",
    "checkEnglish": "检查英文",
    "checkChinese": "检查简体中文",
    "roleDevelopment": "研发",
    "roleOwner": "负责人",
    "returnFinding": "检查未通过时，将具体问题交回研发。",
    "teamTitle": "让每个角色有明确的职责",
    "teamBody": "选择角色使用的 agent、技能和工具。每次执行保留启动时的角色配置版本。",
    "teamNext": "看看团队会用到哪些知识 →",
    "teamForProject": "项目团队",
    "developmentResponsibility": "修改两种语言共用的演示内容",
    "qaResponsibility": "独立检查两种语言",
    "ownerResponsibility": "检查证据并验收交付",
    "humanLabel": "人类",
    "knowledgeTitle": "留下对下次改动有用的上下文",
    "knowledgeBody": "选择项目文档、记忆章节和已验证的经验。新工作使用与角色相关的有效摘录，旧执行保留当时的上下文。",
    "knowledgeNext": "回到工作台继续推进 →",
    "knowledgeInput": "选取的项目上下文",
    "sourceTitle": "项目网站需求",
    "sourceMetadata": "项目文档 · 当前有效",
    "lessonLabel": "审阅后的经验",
    "lessonBody": "只切换语言，不切换示例。",
    "lessonMetadata": "关联检查证据和来源工作",
    "tourSettings": "设置管理项目基本信息；团队和知识分别管理自己的配置。",
    "tourGuide": "阅读使用指南 →"
  }
};
const moduleTabs = [...document.querySelectorAll('[data-module]')];
function selectModule(id, focus = false) {
  if (!moduleTabs.some(tab => tab.dataset.module === id)) return;
  for (const tab of moduleTabs) {
    const selected = tab.dataset.module === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    if (selected && focus) tab.focus({preventScroll:true});
  }
}
for (const tab of moduleTabs) {
  tab.addEventListener('click', () => selectModule(tab.dataset.module));
  tab.addEventListener('keydown', event => {
    const current = moduleTabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? moduleTabs.length - 1 : event.key === 'ArrowRight' ? (current + 1) % moduleTabs.length : event.key === 'ArrowLeft' ? (current + moduleTabs.length - 1) % moduleTabs.length : undefined;
    if (next === undefined) return;
    event.preventDefault();
    selectModule(moduleTabs[next].dataset.module, true);
  });
}
for (const button of document.querySelectorAll('[data-open-module]')) button.addEventListener('click', () => selectModule(button.dataset.openModule, true));
let locale = new URL(location.href).searchParams.get('lang') === 'zh-CN' ? 'zh-CN' : 'en';
function renderLanguage() {
  document.documentElement.lang = locale;
  document.title = messages[locale].pageTitle;
  document.querySelector('meta[name="description"]').content = messages[locale].description;
  for (const node of document.querySelectorAll('[data-i18n]')) node.innerHTML = messages[locale][node.dataset.i18n];
  for (const node of document.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', messages[locale][node.dataset.i18nAria]);
  const toggle = document.getElementById('language');
  toggle.textContent = locale === 'en' ? '简体中文' : 'English';
  toggle.lang = locale === 'en' ? 'zh-CN' : 'en';
  document.getElementById('copy-status').textContent = '';
}
document.getElementById('language').addEventListener('click', () => {
  locale = locale === 'en' ? 'zh-CN' : 'en';
  const url = new URL(location.href);
  url.searchParams.set('lang', locale);
  history.replaceState(null, '', url);
  renderLanguage();
});
document.getElementById('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById('commands').textContent);
    document.getElementById('copy-status').textContent = messages[locale].copied;
  } catch {
    document.getElementById('copy-status').textContent = messages[locale].copyFailed;
  }
});
renderLanguage();
