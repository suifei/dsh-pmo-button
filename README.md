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
- **🔐 一次性行为** — 身份提示词每会话仅下发一次（子代理确认接收后才落标志，失败自动补发）。
- **🧹 绝对无害** — 纯观察者架构：不注入模型上下文之外的任何旁路，停止/卸载即时恢复原状，不影响会话正常流程。

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
4. 审查官的 `STATUS` 结论自动回流本会话：`CONTINUE` 继续推进，`DONE` 自动熄灭按钮收工，`NEED_HUMAN` 按其指示交还给你；
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
| `greet` | `hi` | 每次启动发给子代理的问候文本 |
| `rolePrompt` | （内置审查规程原文） | 身份提示词；每会话仅发一次，置空禁用 |
| `maxRounds` | `20` | 自上次用户输入以来的审查轮数上限（0 = 不限），超出自动熄灭 |

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
2026-11-13T22:10:18  [PMO审查] STATUS=CONTINUE（来自子代理）
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
│ session/event 监听：turn 缓冲 → turn/end 落日志+转发   │
│ pmo-state.json：启用集/子代理/身份标志/审查轮数 持久化   │
└──────────────┬───────────────────────────────────┘
               │ ctx.subagents（spawn，delivery:'parent'）
┌──────────────▼─ 持久子代理（continuable）───────────┐
│ 固定 childId · 冷恢复 · 压缩摘要 · STATUS 结束语       │
└─────────────────────────────────────────────────┘
```

- **为什么状态放在宿主侧？** 按钮状态与审查循环属于会话级事实：宿主持久化让它们跨页面刷新、跨 dsh 重启、跨多端一致。
- **为什么走同源 HTTP 路由而不是 RPC？** 与市场类插件的成熟约定一致：包私有前缀路由 + `webServer.register({kind:'prefix'})`，桌面壳准入实测对 GET 最友好。
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

## 📄 License

[MIT](./LICENSE) © suifei
