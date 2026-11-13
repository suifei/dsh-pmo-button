# 测试

| 命令 | 测什么 | 需要 |
|---|---|---|
| `npm test` | 语法校验 + 假 ctx 回归（`test/review-gate.test.mjs`：转发票、载荷优先、线路 B、闸门），秒级 | `pnpm install --ignore-workspace` |
| `npm run test:live` | 插件装进**真实 dsh 运行时**（headless 配置）跑完整双线路，模型为本地剧本假模型 | 上一条 + `dsh` 命令可用 |

`test:live` 不碰你的环境：使用系统临时目录下独立的 `DSH_HOME`，不访问任何真实模型。`dsh` 不在 PATH 时用 `DSH_BIN` 指定，例如 `DSH_BIN="npx dsh" npm run test:live`。

结果写入 `test/out/`（已忽略，不进仓库）：

| 文件 | 内容 |
|---|---|
| `report.txt` | 12 项检查的 PASS/FAIL 与版本信息 |
| `pmo-button.log` | 插件日志 |
| `trace.jsonl` | 主会话 / 子代理会话的轮次边界与消息来源 |
| `requests.jsonl` | 假模型收到的每一次请求（角色 + 用户消息） |
| `dsh-stderr.txt` | dsh 进程的 stderr |

## 目录

```text
test/
├─ review-gate.test.mjs  假 ctx 回归：不依赖 dsh，覆盖转发票、线路 B 与闸门各分支
└─ live/
   ├─ run.mjs            建独立 profile → 装插件 → 跑 → 检查 → 出报告
   ├─ mock-llm.mjs       剧本假模型（Messages API / SSE）
   └─ pmo-testkit/       仅测试用的驱动插件：顶替 web 服务、点按钮、扮演用户
```

假模型剧本：主代理固定答"已处理"；审查官签到答一句确认，第一次审查答 `CONTINUE`，之后答 `DONE`。

---

# 实机采集任务（0.12.0 双线路）

自动测试覆盖不到三件事：**桌面端界面显示**、**真实模型是否守协议**、**Windows 环境**。请按下面跑一遍并回传。

## A. 自动回归（约 1 分钟）

```sh
git fetch origin && git checkout feat/dual-line-relay
pnpm install --ignore-workspace
npm test
npm run test:live
```

回传：`test/out/report.txt`。有 FAIL 或 SETUP FAILED 时，把整个 `test/out/` 目录一起发来。

## B. 桌面端实跑（真实模型）

1. 让桌面端加载本分支的插件（你本地是链接安装，切到分支后重启 dsh 即可），确认日志最新一行激活记录是 `[PMO 插件激活 v0.12.0]`，输入框下方诊断条显示 `v0.12.0`。
2. **新开一个会话**（要让它新建子代理），在一个空目录里。
3. 点亮 PMO 按钮，等审查官签到结束。**截图①**：此时的主会话。
4. 发送任务（原样）：

   ```text
   在当前目录新建 hello.js，导出函数 hello()，返回字符串 "hello"。
   再写 hello.test.js，用 node:test 验证返回值。
   完成标准：node --test 通过。
   ```

5. 不要干预，等按钮自动熄灭。
   - **截图②**：对话里第一条 PMO 审查消息的样子。
   - **截图③**：结束时的对话末尾（收尾那一轮）。
6. 回传本次运行的 `pmo-button.log` 片段（从 `[PMO 启动]` 到最后一行）。

并回答四个问题：

| # | 问题 | 预期 |
|---|---|---|
| 1 | 签到之后，主会话有没有多出消息或新轮次？ | 没有 |
| 2 | PMO 审查消息在对话里显示是否正常？有没有被渲染成你自己的输入气泡？ | 正常，且能与你的输入区分 |
| 3 | 对话里有没有空白轮次、空气泡或一直转圈的加载状态？ | 没有 |
| 4 | `DONE` 之后，主代理是只收尾，还是继续改了代码？ | 只收尾 |

日志里重点看这几行是否成对出现：`[轮次转发] … 已送达` → `[子代理报告]` → `[PMO审查] STATUS=…` → `[线路B] … 已送达主会话` → `[闸门] 已拦截 dsh 原生回传`。

## C. 可选：旧会话升级

打开一个 0.11.x 时期已有子代理的会话，点亮按钮。预期日志出现一行 `[身份提示词] 已随问候下发`（新版规程补发一次），再次启停不再重复。回传这段日志即可。
