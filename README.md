# 🎛️ PMO 审查循环按钮

[![npm version](https://img.shields.io/npm/v/@suifei/dsh-pmo-button.svg)](https://www.npmjs.com/package/@suifei/dsh-pmo-button)
[![license](https://img.shields.io/npm/l/@suifei/dsh-pmo-button.svg)](./LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)

> 输入框旁的一颗红↑按钮 —— 一键为当前会话挂载一位**常驻 PMO 审查官**（持久子代理）。
> 你的每一轮工作自动转发给它按 **STATUS 协议**审查：`CONTINUE` 自动推进、`DONE` 收工、`NEED_HUMAN` 找你。
> 全程无人工干预，让会话自己把工作循环推进到底。

---

## ✨ 特性

- **📍 原位按钮** — 输入框发送键旁的红↑控件：待命为圆形浅底红箭头，激活为红底白箭头 + 呼吸点动效；状态跟随会话，跨启停、跨重启、跨页面刷新持久。
- **🤖 持久审查子代理** — 每个会话一个固定 `childId` 的 continuable 子代理：跨启停、跨结算、跨冷恢复、**甚至跨上下文压缩**持续复用同一份记忆；自动继承主会话的模型与思考等级。
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

1. 刷新页面 → 输入框发送键旁出现红↑按钮；
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
│ conversation.input.right → 红↑按钮（8s 轮询同步宿主状态）│
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
npm test        # node --check 双端语法校验
```

本地调试以链接方式安装，配置热替换，改完 `cordis.patch.yml` 即时生效：

```sh
dsh plugin --profile <你的profile> add ./dsh-pmo-button
dsh --profile <你的profile> --dump-config   # 验证插件树
```

### 🎛️ 两层配置：全局 + 会话级

- **全局配置**：插件 → PMO 按钮 → 页面内的**配置面板**（分区布局：循环 / 审查官 / 身份与问候 / 日志 / 审查模型下拉与思考等级下拉）。所有字段**改后自动保存并热生效**，经 configEditor 用户配置层持久化，升级不丢。
- **会话级快捷菜单**：输入框红↑旁的 **▾** 钮，弹出当前会话专属的快捷设置（审查模型下拉 / 思考等级下拉 / 轮数上限），**只影响当前会话**，改完立即生效。
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

## 📄 License

[MIT](./LICENSE) © suifei
