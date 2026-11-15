# dsh-pmo-button

DeepSeek Harness（DSH）插件：在输入框旁挂载一位常驻 **PMO 审查官**（持久子代理），
每一轮工作自动转发给它按 `STATUS: CONTINUE | DONE | NEED_HUMAN` 协议审查，把会话循环推进到底。

## 安装

```sh
dsh plugin --profile desktop add @suifei/dsh-pmo-button
dsh plugin --profile web add @suifei/dsh-pmo-button
```

要求 DSH `>=0.2.2-rc.1 <0.3.0`。

## 文档

- 中文说明：[packages/dsh-pmo-button/README.md](packages/dsh-pmo-button/README.md)
- English: [packages/dsh-pmo-button/README.en.md](packages/dsh-pmo-button/README.en.md)
- 配置项、日志格式、架构与版本记录都在上述文档中。

## 仓库结构

```
packages/dsh-pmo-button/   插件包（src / test / locale / cordis.patch.yml）
scripts/                   typert 生成与客户端打包
tsconfig.host.json         宿主侧 TS 工程
tsconfig.client.json       客户端 TS 工程
```

## 开发

```sh
pnpm install
pnpm run build        # typert 产物 + 宿主 tsc + 客户端 IIFE
pnpm test             # 构建 + 单测
```

## License

MIT © suifei
