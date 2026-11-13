# 🎛️ PMO 审查循环按钮

<p align="center"><img src="logo.svg" width="96" alt="dsh-pmo-button · 红鲸鱼"></p>

[![npm version](https://img.shields.io/npm/v/@suifei/dsh-pmo-button.svg)](https://www.npmjs.com/package/@suifei/dsh-pmo-button)
[![license](https://img.shields.io/npm/l/@suifei/dsh-pmo-button.svg)](./LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)

> 输入框旁的一枚**红鲸鱼胶囊** —— 为 AI 会话挂载一位**“资深项目总监”**：常驻 PMO 审查官（持久子代理）。
> 你的每一轮工作自动转发给它按 **STATUS 协议**审查：`CONTINUE` 自动推进、`DONE` 收工、`NEED_HUMAN` 找你。
> 全程无人工干预，让会话自己把工作循环推进到底。

---

## ✨ 特性

- **📍 鲸鱼胶囊** — 输入框发送键旁的 56×32 内联 SVG：浅色底始终不变；待命为灰鲸 + 上箭头，激活为红鲸游动（X/Y/摆尾三层 `animateTransform`）+ 流光虚线圈 + 箭头呼吸；右区 chevron 打开会话级设置，四态（待命/激活 × 收起/展开）齐备。
- **🤖 持久审查子代理** — 每个会话一个固定 `childId` 的 continuable 子代理：跨启停、跨结算、跨冷恢复、**甚至跨上下文压缩**持续复用同一份记忆；自动继承主会话的模型与思考等级。
- **🧬 异构评审** — 审查官是独立会话，可配置不同的 `provider`/模型/思考等级（全局或会话级）与独立上下文做交叉验证；不是“同一个模型再想一遍”，详见下文与 goal 的差异。
- **📝 轮次日志** — 每轮结束把 `[PMO]` 用户原话（图片附件自动解析出内容寻址仓库路径）、`[主代理]` 完整答复、`[注入]` 系统项分级写入日志，带模型显示名 + 思考等级前缀与 usage 统计。
- **🔄 STATUS 自动循环** — `CONTINUE` 推进 / `DONE` 收工 / `NEED_HUMAN` 交还用户；非 `CONTINUE` 自动熄灭按钮，`maxRounds` 兜底防无限循环。
- **🔀 双线路接管** — 去程（主会话 → 审查官）与回程（审查官 → 主会话）都由插件投递；dsh 原生的子代理回传被闸门拦截，签到确认、旁路对话不再唤醒主会话，审查结论只进主会话一条、带 `pmo-review` 来源标记。
- **🔐 身份提示词** — 每会话下发一次，文本变更后自动补发一次（子代理确认接收后才落指纹，失败自动重试）。
- **🧹 作用范围** — 监听两路 `session/event`，并挂一个 `agent/pre-step` 闸门：只丢弃本插件子代理发往主会话的原生通知，其它消息原样放行；卸载插件即恢复 dsh 原生行为。

## 📦 安装

```sh
# 从 npm
dsh plugin --profile <你的profile> add @suifei/dsh-pmo-button

# 或从 GitHub 源码
dsh plugin --profile <你的profile> add github:suifei/dsh-pmo-button
```

依赖 DeepSeek Harness 默认 base 组合（`subagent` / `spawn-in-process` / `session-persistence` / `session-query` / `compaction` 均为默认挂载），无需额外配置。

## 🚀 使用

1. 刷新页面 → 输入框发送键旁出现鲸鱼胶囊（左半开关，右半设置）；
2. **点击启动** → 自动创建（或复用）持久子代理「PMO 子代理」，下发一次性身份提示词 + 问候；
3. 正常对话干活 —— 每轮结束自动转发给审查官；
4. 审查官的 `STATUS` 结论由插件送回本会话：`CONTINUE` 继续推进，`DONE` 自动熄灭按钮并让主代理一句话收尾，`NEED_HUMAN` 熄灭并把待决事项转达给你；
5. 随时 **再点一下** 停止转发；重新点亮恢复循环。用户重新发言也会自动解除停摆。

### STATUS 协议

| STATUS | 含义 | 按钮行为 |
|---|---|---|
| `CONTINUE` | 工作未完，按"下一步"继续 | 保持点亮，循环推进 |
| `DONE` | 目标达成，无遗留问题 | **自动熄灭**（回声静默） |
| `NEED_HUMAN` | 需要用户决策/澄清/授权 | **自动熄灭**，结论中写明需要你决定什么 |

## 🆚 与 Goal 的差异：同一张嘴，还是另一双眼睛？

DSH 的 **goal** 与 **PMO 按钮**都会让会话“自己往下走”，但实现路径不同。读 `dsh-goal` / `dsh-goal-round-driver` / `dsh-tool-goal` 的源码（dsh `0.2.2-rc.1`）可以确认：

- goal 是**同会话、同代理、同模型**的事件溯源目标：`dsh-goal` 把目标状态写进会话日志（`goal/change`）；`dsh-goal-round-driver` 在 agent 空闲、目标 armed、轮数未耗尽时，向**同一会话**追加一条 user 角色的 `<goal_round>` 消息，让同一个代理再跑一轮；`dsh-tool-goal` 提供 `get_goal/create_goal/update_goal` 与完成 / 阻塞的权威检查。
- PMO 是**另一个会话的独立审查子代理**：有自己的上下文、可配置不同模型 / 思考等级，读主代理的转发块并只读取证，用 `STATUS` 决定循环是否继续。

| 维度 | goal | PMO 按钮 |
|---|---|---|
| 思考主体 | 同一会话 / 同一代理 / 同一模型 | 独立的持久审查子代理（另一个会话） |
| 上下文 | 同一份会话历史；每轮追加一条 `<goal_round>` user 消息 | 审查官自己的上下文 + 本轮转发块（用户原话 / 主代理答复 / 注入，按预算裁剪）+ 自主只读取证 |
| 目的 | 记住目标并自动续跑，直到完成 / 暂停 / 阻塞 | 判断这一轮是否偏离用户原话、越界、漏项、把猜测当事实，并给出下一步 |
| 循环驱动 | `dsh-goal-round-driver` 在整代理空闲、armed、轮数未耗尽时排队一轮；只有真正进入模型历史的 goal round 消耗轮数 | 审查官返回 `STATUS`：`CONTINUE` 推进、`DONE` 收工、`NEED_HUMAN` 交还 |
| 完成 / 停止 | 模型在 goal round 里自判；`complete` 需直接人类输入或当前 goal round 的权威；`blocked` 需同一阻塞条件持续若干轮（默认 3） | 审查官给 `STATUS`；缺 STATUS / 异常结束按 `NEED_HUMAN` 停转 |
| 轮数 | `maxGoalRounds` 属于 goal（部署默认 256） | `maxRounds` 属于会话（默认 20） |
| 模型 | 就是主会话的模型 | 可全局 / 会话级换 provider、model、思考等级 |
| 状态 | 会话日志内的目标（`goal/change`，phase / revision / roundsStarted） | `pmo-state.json`（启用集 / 子代理 / 轮数 / 模型指纹）+ 子代理会话 |
| 控制 | goal service 的 pause / resume / complete / block / clear + 轮数 | 按钮启停、`DONE`/`NEED_HUMAN` 自动熄灭、`maxRounds`、会话级模型 / 思考 / 轮数覆盖 |
| 权威 | 目标由用户 / 代理定义；完成 / 暂停 / 编辑需直接人类或 goal round 权威 | 审查意见以“代表用户授权”注入；`NEED_HUMAN` 是刹车 |
| 适用 | 长任务的目标管理与续跑 | 对每一轮迭代做独立、可异构的评审与导航 |

### 最大差异：异构评审（你的判断）

PMO 的审查官是**另一个会话**：可以配置不同的 provider / 模型 / 思考等级（全局或会话级），并且只拿到本轮转发块 + 自己的工作区取证。它不是“同一个模型再想一遍”，而是**换一个模型、换一份上下文、换一套证据路径**来评估同一轮迭代。

这带来的是“去相关”：同模型自审容易共享同一套盲区与合理化路径；换模型 / 换上下文更容易发现“自述与事实不一致”“越界加功能”“把猜测当事实”。

### 源码里最值得注意的一句

`dsh-goal-round-driver` 的 README 把边界写得很清楚：

> **No independent evaluator** — the model-facing goal policy decides when evidence is sufficient for completion… evaluator-backed certification remains deferred.
>
> **Same-session execution only** — this package deliberately does not spawn a fresh agent, fork a session prefix, or implement Ralph-style independent attempts; that workflow belongs to its own plugin layer.

这正好是 PMO 补的缺口：**同一个会话里没有独立评估器**。PMO 用另一个会话、另一份上下文、可选的另一个模型来做这件事；它不是 goal 的替代，而是 goal 缺失的“另一双眼睛”。

### 其他差异

- **目标是“继续做”，审查是“判断做得对不对”**：goal 不评价质量，只负责让同一代理继续；PMO 不定义目标，只判断这一轮是否偏离用户原话。
- **goal round 是同一会话里的一条 user 消息**：它进入主代理的历史；PMO 的转发块是发给另一个会话的独立消息。前者增加主上下文，后者不污染主上下文（但会消耗审查官上下文）。
- **完成权威不同**：goal 的 `complete` 只认直接人类输入或当前 goal round；PMO 的 `DONE` 只是审查意见，不能代替 goal 的 complete。组合时，PMO 说 `DONE` 后仍需用户（或 goal round）去 complete 目标。
- **轮数含义不同**：goal round 是“再来一轮工作”；PMO 的轮数是“再审一次”。两者都会占用回合与 token，组合时要一起看预算。
- **恢复行为不同**：goal 在 resume / fork 后默认 disarmed，需人类 resume；PMO 的 DONE 闸门、按钮启停、会话级覆盖是另一套恢复 / 停止语义。
- **证据是被裁剪的**：审查官看不到完整会话，只看转发块（按预算优先保留用户原话与主代理答复）；它必须自己读工作区补证据。这既强制了证据化，也带来“转发块缺内容会误判”的风险。
- **记忆是分开的**：审查官有自己的持久记忆（跨启停、冷恢复、压缩），能核对主代理是否执行了上一轮的“下一步”；goal 的记忆就是主代理自己的上下文。

### 好处与问题

**好处**：
- 补上 goal 的独立评估器缺口：同一会话里模型自判，PMO 换会话、换模型、换证据路径做交叉验证；
- 去自证偏差；独立上下文；可异构模型与成本选择；
- 强制证据；每轮都有可执行的“下一步”；可随时停 / 换模型 / 换角色。

**问题与边界**：
- 成本与延迟翻倍（两套模型、两轮往返）；
- 评审材料只有转发块，裁剪 / 摘要会丢证据，审查官必须自己取证；
- 异构模型可能不懂代码库或协议，产生误判 / 噪音；同模型继承则回到同盲区；
- 审查官上下文会增长 / 漂移，换模型会重置审查记忆；
- STATUS 依赖模型守约；缺 STATUS 在 0.12.0 按 `NEED_HUMAN` 停转，仍可能误停；
- “代表用户授权”有越权风险，需要 `NEED_HUMAN` 与人工兜底；
- **不能替代 goal 的完成权威**：PMO 的 `DONE`/`NEED_HUMAN` 不改变 goal 的 phase，用户仍需 complete / pause / block；
- **组合时的轮次竞争**：goal round 只在整代理空闲且 descendants settle 后开始；PMO 的 review 回合 / 子代理会占用空闲窗口；两者同时开时要一起控制 `maxRounds` 与 `maxGoalRounds`。

### 怎么配合

- 用 **goal** 定“做什么、做到什么时候”（目标、轮数、完成 / 阻塞）；用 **PMO** 审“这一轮是否真的做对、是否偏离用户原话”；
- PMO 的 `NEED_HUMAN` 可以作为你去 pause / block goal 的信号；PMO 的 `DONE` 不自动 complete goal，仍需按 goal 的完成权威收口；
- 两者同时开启时，把 `maxRounds`（评审轮数）与 `maxGoalRounds`（工作轮数）都设小一点，避免双重循环把预算打穿。

## ⚙️ 配置

| 字段 | 默认值 | 说明 |
|---|---|---|
| `logFile` | `~/.dsh/logs/pmo-button.log` | 轮次日志路径（默认在 Harness home 下，可改绝对路径） |
| `maxChars` | `4000` | 日志单块截断阈值（转发块为 2×） |
| `provider` | `spawn` | 子代理提供方（`ctx.subagents` 注册名） |
| `childLabel` | `PMO 子代理` | 持久子代理标签 |
| `greet` | 待命签到文本（明示"非审查请求"，要求只回确认） | 每次启动发给子代理的签到问候 |
| `rolePrompt` | （内置审查规程原文） | 身份提示词；每会话发一次，文本变更后补发一次，置空禁用 |
| `maxRounds` | `20` | 自上次用户输入以来的审查轮数上限（0 = 不限），超出自动熄灭 |
| `childModelProvider` | （空 = 继承主会话） | 子代理提供方覆盖，如 `deepseek-official` |
| `childModel` | （空 = 继承主会话） | 子代理模型覆盖，如 `deepseek-v4.1-flash` |
| `childReasoningEffort` | （空 = 继承主会话） | 子代理思考等级覆盖，如 `max` |

### 🔀 异构审查（审查方 ≠ 执行方）

三个 `childModel*` 字段留空时，子代理**自动继承主会话**的提供方/模型/思考等级；全部留空即"同模型互审"。想要"盲区不同"的异构审查，把三项指向另一个模型即可：

```yaml
config:
  childModelProvider: deepseek-official
  childModel: deepseek-v4.1-flash
  childReasoningEffort: max
```

> 前提：该提供方已在 Harness 中配置好凭据；id 以模型选择器目录为准。指定的模型/等级会写入子代理持久描述符——**冷恢复按描述符还原，不会漂回主会话模型**。

## 📜 日志格式

```text
────────────────────────────────────────────────
2026-11-13T22:07:29  [轮次结束] session=session-8e3e… turn=33 reason={"kind":"completed"}
[PMO] 把登录页的报错修一下，用户名过长时布局炸了
[图片] bug.png（1920x1080, image/png, 284.5KB）=> C:\Users\<you>\.dsh\attachments\v1\objects\28\2845…
[注入:time-context] Time sampled while preparing turn 12, …
[GLM-5.3-Flash Max]

修复说明：用户名长度未约束容器宽度，已加 ellipsis 与 title…（完整答复，多段以 --- 分隔）
(usage: in=12500 out=890)
2026-11-13T22:07:29  [轮次转发] turn=33 已送达 child=d407cf5b-5f3…（第 3/20 轮审查）
────────────────────────────────────────────────
2026-11-13T22:10:18  [子代理报告] child=d407cf5b-5f3… turn=7 reason={"kind":"completed"} 审查
STATUS: CONTINUE …（审查官结束语全文）
2026-11-13T22:10:18  [PMO审查] STATUS=CONTINUE（来自子代理）
2026-11-13T22:10:18  [线路B] STATUS=CONTINUE 已送达主会话 session=session-8e3e…
2026-11-13T22:10:19  [闸门] 已拦截 dsh 原生回传 1 条 session=session-8e3e… turn=34 step=1
```

## 🧱 架构

```text
┌─ 客户端 client.js（web）────────────────────────────┐
│ conversation.input.right → 鲸鱼胶囊（左开关/右设置，8s 轮询）│
│ conversation.composer.dock → 活性指示条                │
└──────────────┬───────────────────────────────────┘
               │ 同源 fetch /pmo-button/{state,toggle,ping}
┌──────────────▼─ 宿主 index.js ─────────────────────┐
│ webServer 路由（启停/查询/诊断）                       │
│ 线路A：主会话 session/event → turn/end 落日志+转发     │
│ 线路B：子代理 session/event → 闸门(STATUS) → followup  │
│ agent/pre-step 闸门：丢弃 dsh 原生子代理回传           │
│ pmo-state.json：启用集/子代理/身份指纹/审查轮数 持久化   │
└──────┬──────────────────────────────▲────────────┘
       │ A: subagents.sendMessage      │ B: 子代理 turn/end
┌──────▼──────── 持久子代理（continuable）──┴─────────┐
│ 固定 childId · 冷恢复 · 压缩摘要 · STATUS 结束语       │
└─────────────────────────────────────────────────┘
```

- **为什么状态放在宿主侧？** 按钮状态与审查循环属于会话级事实：宿主持久化让它们跨页面刷新、跨 dsh 重启、跨多端一致。
- **为什么走同源 HTTP 路由而不是 RPC？** 与市场类插件的成熟约定一致：包私有前缀路由 + `webServer.register({kind:'prefix'})`，桌面壳准入实测对 GET 最友好。
- **为什么回程要插件接管，而不是用 `delivery:'parent'`？** dsh 原生回传由子代理管理器直接投进主会话：插件无法过滤签到确认、无法在 `DONE`/`NEED_HUMAN` 时拦住唤醒、一次回复还可能产生两条通知。接管后回程只有一个入口（`agent.followup`），停机条件有了落点。
- **为什么还需要 `agent/pre-step` 闸门？** `delivery:'caller'` 只对创建那一次 Activation 生效；之后每次 `sendMessage` 触发的冷恢复在 `dsh-subagent` 内部固定回落为 `'parent'`（`coldResume` 不传 delivery），原生结算通知仍会发出，只能在进入模型前丢弃。
- **为什么轮次数据从事件流缓冲而不是读会话文件？** JSONL 持久层为 zstd 压缩 + 批量落盘；`session/event` 是官方唯一 post-commit 观察面，实时且零依赖。

## 🛠️ 开发

```sh
git clone https://github.com/suifei/dsh-pmo-button.git
cd dsh-pmo-button && pnpm install --ignore-workspace
npm test            # 语法校验 + 假 ctx 回归（test/review-gate.test.mjs）
npm run test:live   # 真实 dsh 运行时 + 剧本假模型，跑完整双线路（见 test/README.md）
```

本地调试以链接方式安装，配置热替换，改完 `cordis.patch.yml` 即时生效：

```sh
dsh plugin --profile <你的profile> add ./dsh-pmo-button
dsh --profile <你的profile> --dump-config   # 验证插件树
```

### 🎛️ 两层配置：全局 + 会话级

- **全局配置**：插件 → PMO 按钮 → 页面内的**配置面板**（分区：审查模型（模型 / 思考等级）/ 运行（轮数 / 截断阈值 / 提供方 / 标签）/ 身份与问候（问候 / 身份提示词）/ 日志）。所有字段**改后自动保存并热生效**，经 configEditor 用户配置层持久化，升级不丢。
- **会话级快捷菜单**：胶囊右区的 chevron，弹出当前会话专属的快捷设置（审查模型下拉 / 思考等级下拉 / 轮数上限；轮数留空显示"继承全局（N 轮）"），**只影响当前会话**，改完立即生效。
- **优先级**：会话级覆盖 > 全局默认 > 继承主会话模型。
- **注意**：会话级变更审查模型会在下次启动时**重置子代理**（新模型写入持久描述符，审查记忆清零——菜单中均有提示）。

### 📶 签到与审查分离（协议）

- PMO 启动时发送的是**签到**（非审查请求）：子代理只回复一句确认并待命，**禁止输出 STATUS**；
- 只有**转发票**（头部明示"审查请求"或"续轮审查请求"）才触发规程审查与 STATUS 输出；
- **转发票闸门（v0.11.2）**：每个会话只有两种情形允许转发——本轮含真实用户输入，或审查官上一轮给出整行 `STATUS: CONTINUE`。子代理结算通知、系统提醒等注入本身**不授予转发票**，所以"子代理沉默/只回执 → 父会话被通知唤醒 → 再转发"的回声链最多走一轮，不会无限空转；
- **载荷优先（v0.11.2）**：转发块先放 `[用户]` 与 `[主代理]`，`[注入]` 只吃剩余预算且每块限长 800 字符；注入再多也不会把审查对象挤出转发块；
- STATUS 识别采用**整行锚定**（容忍 markdown 加粗）——行文中提及"STATUS: DONE"不会误触发停机；
- 审查回复缺 STATUS 行或审查官轮次异常结束，一律按 `NEED_HUMAN` 处理：循环停转并告知用户；
- 停机（DONE/NEED_HUMAN/轮数上限）后：按钮熄灭、回声静默，**用户重新发言或点亮按钮即恢复循环**（轮数计数同步清零）。

## 📌 版本

- **0.12.2** — 会话级菜单与全局配置面板统一为同一份 effort 选择器：两者都只按 `llm.resolveModelInfo()` 的模型能力列项；模型留空时只能继承（不再出现硬编码 `minimal/low/medium/high/max`）；保存时清掉与模型不匹配的 effort。
- **0.12.1** — 修复：会话级审查模型/思考等级变更后立即重置审查官（此前要等下次点亮，出现“选了 qwen 却仍跑 deepseek-official，旧 key 401”）；思考等级改为按 `llm.resolveModelInfo()` 的模型能力动态列出（qwen 不再出现 `max`，`high → xhigh` 仍由 provider 别名处理）；全局配置同样校验模型/effort 组合；子代理创建日志记录实际审查模型。
- **0.12.0** — 双线路接管（线路 B + `agent/pre-step` 闸门）、身份提示词变更补发、会话级设置菜单、鲸鱼胶囊控件（四态 + 游动动效）、配置面板重构（模型 / 思考等级 / 提供方 / 身份提示词）、模型目录修复 + `/providers`；Windows 真机与 12 项 live 回归全过。
- 0.11.x — 签到/审查分离、整行 STATUS、DONE 闸门、转发票闸门、载荷优先。

## 🗺️ 下一步计划：审查角色提示词模板

目标：让“换一个模型 / 上下文”进一步变成“换一个审查视角”。双线路与 STATUS 协议不变，只替换身份提示词与推荐模型 / 思考等级。

这也承接 goal 的边界：goal 把 evaluator-backed certification 列为 deferred；角色模板让这个独立评估器更专精（架构 / 安全 / 测试…），但它仍是评审，不改变 goal 的完成权威。

计划内置模板（可选，不改变协议）：

- **PMO（默认）**：证据、偏离、漏项、越界；只给最重要的一步。
- **架构审查官**：边界、耦合、可演进性、契约与数据流。
- **安全审查官**：权限、注入、凭据、不可逆操作、供应链。
- **测试 / QA 审查官**：复现、边界、回归、证据可复核。
- **性能审查官**：复杂度、热路径、内存 / IO、基准。
- **产品 / 验收审查官**：对照用户原话与验收标准，砍范围、防镀金。
- **极简挑刺官**：只报会阻塞交付的问题，避免噪音。

交互计划：

- 全局配置面板增加“审查角色”下拉 + 自定义提示词 textarea（切换模板即改 `rolePrompt`；文本变更会自动补发一次身份提示词）；
- 会话级菜单增加“审查角色”选择，和模型 / 思考等级 / 轮数一样只影响当前会话；
- 每个模板可带推荐的 provider / model / effort（不强制，留空继承）；
- 模板只改“角色 / 关注点”，不改 STATUS 契约、只读约束、`NEED_HUMAN` 规则；自定义模板保存前做关键条款校验，防止删掉“必须输出 STATUS”等硬约束。

状态：**计划中，尚未实现**；当前可用“身份提示词”textarea 手动达到同样效果。

## 📄 License

[MIT](./LICENSE) © suifei
