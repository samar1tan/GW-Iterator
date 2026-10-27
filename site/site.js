const messages = {
  en: {
    navigationLabel:'Main navigation', workflowLabel:'Example workflow', resourcesLabel:'Resources', terminal:'Terminal', skip:'Skip to content', navWorkflow:'Workflow', navSetup:'Run locally', eyebrow:'LOCAL PROJECT ITERATION', title:'A local workbench<br>for projects using Codex.', intro:'Use Codex to move a project forward. Follow the implementation, independent checks and delivery decisions in one local workbench.', setup:'Run GWI locally', guide:'Read the guide', heroNote:'Configuration and run history are stored locally. Selected context goes to your model provider.', balance:'Room for Codex to adapt.<br>Clear boundaries for the work.', principle:'Read the product approach →', exampleLabel:'ILLUSTRATIVE EXAMPLE', exampleTitle:'A website fix, from request to review', exampleNote:'An authored example of the workflow.<br>No project or run data is included.', exampleProject:'Project website', exampleWork:'Language parity', exampleState:'Ready for review', request:'“Keep the English and Chinese demo aligned when I switch languages.”', stage1:'Understand the mismatch', stage1sub:'Product · scope and expected result', stage2:'Prepare the change', stage2sub:'Development · shared demo content', stage3:'Check both languages', stage3sub:'QA · behavior, copy and layout', stage4:'Review delivery', stage4sub:'Owner · inspect the result', prepared:'PREPARED CHANGE', changeTitle:'One case. Two languages.', changeBody:'Both pages use the same example, commands and evidence. Only the displayed language changes.', caseEn:'Compare two historical states', caseZh:'比较两个历史状态', check1:'Equivalent content and interactions', check2:'Language switch preserves the investigation', check3:'Changed pages checked at desktop and narrow widths', artifact:'Change preview · Check results · Delivery record', exampleFooter:'If a check fails, return the finding to its owner and continue from that step.', workEyebrow:'FROM PROJECT TO DELIVERED WORK', workTitle:'Use the workbench.<br>Adjust the process when it matters.', point1:'Start with the outcome', point1body:'Describe the work or select a reusable pipeline. State the concrete result before execution starts.', point2:'Follow work across roles', point2body:'Inspect stages, handoffs, changes and checks. People and agents use the same recorded work.', point3:'Continue with context', point3body:'Keep completed work and earlier attempts. Continue using Codex account availability and observed task trends, without estimating a token quota.', point4:'Keep the useful knowledge', point4body:'Connect selected project documents and reviewed lessons. Pipeline and role revisions remain inspectable.', startEyebrow:'ON YOUR MACHINE', startTitle:'Run GW-Iterator locally', startBody:'GWI connects a local web interface to Multica and your authenticated Codex installation. It does not require a hosted GWI account.', requirements:'Node.js 24–26 · Git · curl · Docker Compose · Codex<br>GitHub operations also require an authenticated gh CLI.', platformNote:'Native execution is verified on macOS. Other hosts must pass the setup checks.', setupDetails:'Prerequisites and setup checks →', copy:'Copy', copied:'Commands copied', copyFailed:'Select and copy the commands above.', openLocal:'Then open', footer:'Built with Codex and Multica. GWI source: Apache-2.0; dependencies have their own terms.', source:'Source', docs:'Docs', issues:'Issues', notices:'Notices', pageTitle:'GW-Iterator — A workbench for project iteration', description:'A local workbench for project iteration with Codex and Multica. Follow work, review changes, and keep decisions together.'
  },
  'zh-CN': {
    navigationLabel:'主导航', workflowLabel:'示例流程', resourcesLabel:'相关资源', terminal:'终端', skip:'跳到正文', navWorkflow:'工作流程', navSetup:'本地启动', eyebrow:'本地项目迭代工作台', title:'用 Codex 做项目，<br>在 GWI 跟进迭代。', intro:'用 Codex 推进项目，在同一个本地工作台跟进实现、独立检查和交付决策。', setup:'在本机运行 GWI', guide:'查看使用指南', heroNote:'本地保存配置和记录，选定的上下文会发送给模型服务。', balance:'让 Codex 灵活调整做法，<br>让迭代有清晰的边界。', principle:'了解产品思路 →', exampleLabel:'流程示意', exampleTitle:'一次网站修复，从提出问题到审阅交付', exampleNote:'此处为独立编写的流程示例，<br>未使用真实项目或运行数据。', exampleProject:'项目网站', exampleWork:'双语内容对齐', exampleState:'等待审阅', request:'“切换语言后，英文和中文演示的内容应当一致。”', stage1:'确认内容差异', stage1sub:'产品 · 明确范围和预期结果', stage2:'完成修改', stage2sub:'研发 · 统一演示内容', stage3:'检查两种语言', stage3sub:'QA · 行为、文案与布局', stage4:'审阅交付', stage4sub:'负责人 · 查看实际结果', prepared:'本次修改', changeTitle:'同一个案例，两种语言。', changeBody:'两个页面使用相同的案例、命令和证据，切换的只是显示语言。', caseEn:'Compare two historical states', caseZh:'比较两个历史状态', check1:'内容和交互一致', check2:'切换语言保留当前探索进度', check3:'已检查桌面和窄屏下的页面', artifact:'修改预览 · 检查结果 · 交付记录', exampleFooter:'检查未通过时，将具体问题交回对应角色，从需要修复的步骤继续。', workEyebrow:'从项目目标到实际交付', workTitle:'先用起来，<br>需要时再调整流程。', point1:'从目标开始', point1body:'描述要做的事，或选择可复用的流水线。启动前说明这次具体要完成什么。', point2:'跟进角色间的工作', point2body:'查看步骤、交接、修改和检查结果。人类和 agent 围绕同一份工作记录协作。', point3:'带着上下文继续', point3body:'保留已完成的工作和先前尝试，结合 Codex 剩余额度与任务执行趋势继续，无需估算 token 数量。', point4:'保留有用的项目知识', point4body:'连接选定的项目文档和经过审阅的经验，保留可追溯的流水线与角色版本。', startEyebrow:'在你的电脑上', startTitle:'本地启动 GW-Iterator', startBody:'GWI 将本地 Web 界面接入 Multica 和已登录的 Codex，无需注册 GWI 云端账号。', requirements:'Node.js 24–26 · Git · curl · Docker Compose · Codex<br>操作 GitHub 还需要已登录的 gh CLI。', platformNote:'原生执行已在 macOS 上验证，其他系统需要通过安装检查。', setupDetails:'查看环境要求和安装检查 →', copy:'复制', copied:'命令已复制', copyFailed:'请选中并复制上方命令。', openLocal:'随后打开', footer:'使用 Codex 和 Multica。GWI 源码采用 Apache-2.0，依赖遵循各自条款。', source:'源码', docs:'文档', issues:'问题反馈', notices:'第三方声明', pageTitle:'GW-Iterator — 项目迭代工作台', description:'接入 Codex 和 Multica 的本地项目迭代工作台。跟进工作、审阅修改、保留决策。'
  }
};
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
