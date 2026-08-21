# dsh-calendar —— DSH Web GUI 日历待办插件

## 项目概览 (Project Overview)
一个可热插拔的 DeepSeek Harness (DSH) Web GUI 客户端插件：侧边栏「日历」入口，点击后中间列切换为日历视图；支持周视图时间网格**拖选时间段**建任务、**艾森豪威尔紧急/重要矩阵**、**子任务**、任务可**钉住执行会话与 LLM provider**、**Host 定时调度**（受限每日/每周重复物化副本 + 一次性到时自动执行）。采用 **Host 权威架构**：任务账本、定时调度、执行结算全部在 DSH Host 进程内，浏览器只是同源异步视图。

- 核心技术：TypeScript + React 18 + CSS Modules；Cordis 4 / DSH rc.6 SDK；tsdown（官方 client bundle 预设，产物为 `window.__ModuleLoader__.load({id, factory})`）；vitest + jsdom。
- 运行形态：DSH profile-bundle 双面插件（`package.json` 声明 `dsh.bundle.patch` + `dsh.client`）。

## 构建与测试命令 (Build & Test Commands)
- 安装依赖: `pnpm install`
- 类型检查: `pnpm typecheck`（`tsc --noEmit`）
- 构建: `pnpm build`（`tsc -p tsconfig.build.json && tsdown` → `lib/index.js` + `lib/client.js` + `lib/types`）
- 监听构建: `pnpm watch`（`tsdown --watch`，配合 client HMR）
- 测试: `pnpm test`（vitest run）；单个: `pnpm test -- -t "测试名"`
- 挂载: `dsh plugin --profile web add link:<本目录>`（自动对账 `dsh.profile.bundles`）
- 卸载: `dsh plugin --profile web remove @magma27/dsh-calendar`
- 组合验证: `dsh --profile web --dump-config`
- 生效: 挂载/卸载后需重启 dsh web 进程（页面刷新不够）

## 代码风格与规范 (Code Style & Guidelines)
- **必须做**:
  - 类型导入使用 `import type`（client bundle purity gate 会拒绝跨插件值导入）
  - 组件使用命名导出；领域层（`src/core/`）纯函数、无 cordis/运行时依赖，便于单测
  - client 只用 `--dsw-*` token，不硬编码颜色；深色模式随 `body[data-ds-dark-theme]` 自动适配
  - 所有长生命周期资源（route/timer/listener/DOM/React root）归当前 fiber，用 `ctx.effect(() => disposer, label)` 清理
  - 用户可见文案全部进 `src/client/locales.ts`（zh/en）
  - 定时/执行相关逻辑只允许在 Host 半边；浏览器只渲染 + 提交 action
- **禁止做**:
  - 不要使用 `any` 类型
  - 不要在 client 值导入 `@deepseek-ai/dsh-host-*` 包——只共享 `src/core/` 与 `src/protocol.ts` 的类型
  - 不要手写 `window.__ModuleLoader__` 协议——统一走 `build/tsdown.client.ts` 预设构建
  - 不要在浏览器端直接修改任务数据——一切经 `POST /api/calendar/action` 提交，以 Host snapshot 为准
  - 不要用 `process.cwd()` 存放数据——账本固定 `$DSH_HOME/calendar/ledger-v1.json`
  - **不要访问任何未在 `inject` 中声明的 Cordis 服务**（客户端半边尤其如此）：访问未注入的服务（如 `ctx.sessions`、`ctx.workspaces`、`ctx.connection`）会在 apply 时抛 `cannot get property X without inject`，导致整包加载失败、GUI 无法进入。确需某服务时，先在 `inject` 中声明，或在 Host 半边读取并用 HTTP 暴露给浏览器（本插件的首选方式）

## 防御性约定 (Defensive Rules)
- 客户端 `apply(ctx)` 内**只能**使用 `inject` 声明的服务 + 纯 DOM/transport；任何运行时可变的 DSH 域数据（会话标题、工作区、模型目录等）一律由 Host 半边经 `/api/calendar/*` 读取，浏览器只 fetch
- 客户端 `apply` 的失败策略：DOM 挂载/数据拉取失败一律 `console.error` 后放行，**绝不 throw**，避免外部插件拖垮整个 GUI
- 修改任何客户端 `apply` 引用的服务或新增对 `ctx.*` 的访问前，先核对 `inject` 列表；不确定的服务宁可经 Host 暴露
- 每次改动后以 `pnpm typecheck && pnpm build && pnpm test` 为基线；涉及 apply/挂载的改动再补一条「客户端不引用未 inject 服务」的静态检查或评审

## 目录结构与职责 (Project Structure)
- `src/index.ts` + `src/host-*.ts`: Host 半边（host-ledger 账本、host-scheduler 定时调度、host-runner 执行、host-routes HTTP/SSE、SystemPrompt 段）
- `src/core/`: 纯函数领域层（tasks 任务模型 / calendar 网格数学 / repeat 重复规则+节假日 / store 账本解析），host 与 client 共享
- `src/client/`: 浏览器半边（视图组件、host-api HTTP transport、sidebar-entry / calendar-mount DOM 挂载、设置卡、locales）
- `src/protocol.ts`: Host↔浏览器共享的 action/snapshot 判别联合协议
- `build/`: 官方 client-bundle tsdown 预设（`tsdown.client.ts` + `web-platform.ts`，复制自 deepseek-harness / dsh-web-ui）
- `tests/`: vitest（core / host / client）
- `memory-bank/DESIGN.md`: 设计规范；`memory-bank/development-plan.md`: 开发计划
- `memory-bank/`: 项目记忆（设计 / 架构 / 计划 / 进度 / 验收）
- `scripts/dsh-calendar.js`: mount/unmount/status 辅助 CLI

## 测试指南 (Testing Instructions)
- 纯函数测试优先（core 四模块：calendar / schedule / tasks / store）
- Host 测试用 fake ApiProxy（host-runner / host-ledger / host-service）
- Client 测试用 jsdom（transport / apply-guard / DOM 挂载）
- 真实组合：`dsh plugin --profile <scratch> add link:<本目录>` → `dsh --profile <scratch> --dump-config` 断言出现 `ui-calendar` 层
- 验证基线：`pnpm typecheck && pnpm build && pnpm test`

## 安全注意事项 (Security Considerations)
- 定时执行会真实消耗 LLM API 额度；任务 Prompt 是发给 agent 的文本数据
- 执行钉子（工作区/会话/provider/预设/权限）失败即关闭，**绝不在错误设置下运行**
- `/api/calendar/*` 仅限 DSH loopback 同源 + 严格校验；POST 仅 JSON、载荷上限；禁止 shell 命令/可执行路径
- 账本原子写入（临时文件 + fsync + 原子 rename）；损坏文件改名 `.corrupt-*` 保留、以空账本启动
- requestId 指纹幂等，避免 Host 重启后重复执行
- 所有提交、push、发布需用户明确授权

## Git 工作流 (Git Workflow)
- 分支命名: `feature/<里程碑>`（如 `feature/m2-calendar-ui`）
- 提交信息: 遵循 Conventional Commits（`feat:`/`fix:`/`chore:`/`test:`/`docs:`）
- 每个里程碑完成时提交一次，并附带测试通过记录
