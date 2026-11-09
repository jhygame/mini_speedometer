# 小程序 Speedometer

参考 Speedometer 3.1 的微信小程序响应基准，包含 Todo、新闻导航、编辑器和图表四类负载。项目使用 WXML、WXSS、JavaScript，Todo、新闻和图表支持 WebView/Skyline 对照，编辑器使用 WebView，测试数据均在本地生成。

## 运行

1. 在微信开发者工具中导入此项目的根目录。项目内的 `touristappid` 用于本地模拟器调试。真机预览时在开发者工具中选择有开发权限的小程序 AppID。
2. 编译后进入 Todo A 首页，默认「统一 setData」。在顶部选择 A/B/C 配置；B/C 还可选择「增量删除」。从「其他原生场景」进入新闻、编辑器或图表页面。各页面均支持手动体验，也可以点击「开始测试」，执行 2 轮预热和 10 轮正式测量。
3. 查看小程序场景分、95% 置信区间及阶段耗时中位数。Todo 展示步骤级 Sync/Async 中位数，其余场景展示单次响应 P50 和 P95。点击「复制原始 JSON」可导出有效轮次、逐轮分数、评分汇总、无效轮次原因、设备环境、计时时钟和操作耗时。
4. Todo 测试结束或停止后，可在结果区点击「查看计分计算过程」，展开逐轮 Sync + Async、三个步骤求和、1000 / 套件总耗时、最终均分及 95% 置信区间的公式代入。WebView 和 Skyline 共用此面板，新闻、编辑器和图表不显示此功能。

## Todo A/B/C 对照

| 配置 | 页面入口 | 渲染器 / 配置组件框架 | 支持模式 |
| --- | --- | --- | --- |
| A | `pages/todo/index` | WebView / exparser | 统一 setData（默认） |
| B | `pages/todo/glass` | WebView / glass-easel | 统一 setData（默认）、增量删除 |
| C | `pages/todo/skyline` | Skyline / glass-easel | 统一 setData（默认）、增量删除 |

- **主基准**：A/B/C 均选择统一模式。新增使用数组路径补丁、完成使用 `done` 路径补丁，删除每次通过 `setData` 提交剩余数组和剩余数。三种配置使用完全相同的业务算法、输入及更新补丁。A/B 比较组件框架迁移，B/C 比较渲染栈变化，A/C 比较整体迁移；这些不是对单独渲染器或 SoC 的隔离测量。
- **扩展基准**：只有 B/C 可选择增量删除。新增、完成不变，删除每次暂存一个数组 splice，再通过 `setData({ remaining }, callback)` 应用更新。仍倒序逐项删除 100 次，不是一调用清空；手动操作复用当前模式。扩展结果只能在相同模式内比较，不与主基准合并计分。
- 三个入口均通过 `Component` 注册，复用页面工厂、WXML 和样式；统一使用自定义导航和 320px 宽的 Todo 测试区，列表字号、行高、按钮尺寸使用 px。每步结束在计时之外校验逻辑、视图状态及区域宽度，宽度不匹配的轮次无效。滚动容器和视口仍受设备影响，真机应保持同一方向、显示设置及滚动位置。
- 切换配置通过 `wx.redirectTo` 打开独立页面，清空内容和报告；切换模式清空报告但保留手动内容。B/C 切换保留模式；增量模式需先切回统一模式才能进入 A。测试中不能切换。也可使用 `?mode=uniform` 或 B/C 的 `?mode=incremental` 直达；非法或不支持的参数明确报错，不能悄悄改成其他负载。
- A 显式配置 `componentFramework: "exparser"`、`glassEaselWebview: false`；B/C 配置 `componentFramework: "glass-easel"`、`glassEaselWebview: true`。全部设置 `usingComponents: {}`，应用保持 `lazyCodeLoading: "requiredComponents"`。统一使用基础库 3.8.12 或更高版本及支持的微信客户端验收，避免 WebView 灰度或 Skyline 回退污染结果。
- 开发者工具不要全局强制开启 glass-easel WXML 编译：`project.config.json` 和本机 `project.private.config.json` 的 `setting.useGlassEaselForWxml` 应为 `false`，由各页面的 JSON 选择框架，B/C 的页面级配置保持开启。否则 A 的 exparser 配置会与工具强制编译设置冲突。新增入口后，若工具报 WXML/页面 JSON 不存在而磁盘上文件齐全，先关闭并重新打开当前项目，再清除文件缓存并完整编译；仅热重载不能作为新路由打包的验收。
- 页面检查实际渲染器和数组增量接口：未知渲染器、渲染器与配置不符、B/C 缺失接口、A 暴露增量接口时均禁止测试，不进行算法回退。**组件框架字段是配置值，不是独立的实际框架查询结果**；JSON 分开记录 `configuredComponentFramework` 和 `frameworkEvidence.arraySpliceAvailable`。正式采样前仍需在开发者工具运行日志确认实际组件框架，并在真机确认运行栈。
- JSON 使用 `native-todo-v4`，记录 `variant`、`variantLabel`、`updateMode`、`comparisonGroup`、`workloadWidthPx`、导航方式及删除 API；`todo-abc-v1/uniform` 与 `todo-abc-v1/incremental` 为两个独立比较组。计分公式继续使用 `native-score-v3`，不因为三种入口而合成一个总分。

## 其他场景及运行环境

- 新闻和图表仍提供 WebView/Skyline 切换，WebView 页面保留原组件框架。两种入口继续复用页面工厂、WXML 和样式，测试中禁止切换，切换前需复制要保留的报告。本次 A/B/C 与双模式仅涉及 Todo。
- 微信当前不支持 Skyline `editor`，故没有编辑器 Skyline 页面；从 Skyline Todo 进入编辑器会明确打开 WebView 页面，不以其他组件替代原编辑器负载。
- 开发者工具使用支持 Skyline 和 glass-easel 的近期版本，在本地设置开启 Skyline 渲染调试，基础库选择 3.8.12 或更高版本。真机还需满足相应微信客户端支持条件；其他 Skyline 页面配置的 3.8.0 下限不代表 Todo 增量更新可在该版本运行。
- 配置已关闭 Skyline AB 灰度。低版本、桌面环境或强制渲染设置仍可能导致实际引擎与配置不同，应以页面显示的实际渲染器及 JSON 的 `environment.renderer` 为准；`configuredRenderer` 保存配置，`rendererFallback` 标记已知的不一致，未知实际引擎记为 `unknown`，不冒充 Skyline 结果。
- Skyline Canvas 按官方支持说明需使用真机验证，不应把开发者工具中的 Canvas 不支持当作设备性能结果。真实导航、组件布局、滚动和 Canvas 帧回调需在微信环境验收。

运行全部自动化测试：在本仓库目录执行 `node --test tests/*.test.js`。

## 负载与计时终点

| 场景 | 测试步骤 | 计时终点 |
| --- | --- | --- |
| Todo | 新增 100 项、完成全部、倒序删除全部。每步同步连续提交 100 次更新，不逐项等待回调；统一模式删除提交剩余数组，增量模式删除提交 splice 指令及剩余数。 | 全部 `setData` 回调、`wx.nextTick` 后的视图尺寸查询回调 |
| 新闻 | 分别切换美国、世界、政治栏目。每个步骤先展开和收起菜单 25 轮，再切换含 16 篇本地样稿的列表。 | 每次菜单或栏目更新的 `setData` 回调 |
| 编辑器 | 在原生 `editor` 中载入 240 行代码、应用语法着色、载入 160 段富文本、加粗全文。原生编辑器初始化在计时前完成。 | `EditorContext.setContents` 成功回调 |
| 图表 | 12 个步骤覆盖两种堆叠柱状图、点图、散点图与提示、股票图的平移与缩放、指标图的选点与选区。 | Canvas 2D 绘图命令后的下一次 `Canvas.requestAnimationFrame` 回调 |

新闻使用同一套原生页面对应 Next 和 Nuxt 两个浏览器变体。代码着色由本地固定规则生成，和富文本一起通过原生编辑器应用格式。四组图表均绘制在同一 Canvas 2D 上，图表报告记录画布尺寸与像素比。每个计时终点代表该负载采用的框架确认点，实际触摸到屏幕呈现需要单独测量。

Todo 的 `native-todo-v4` 保留批量操作、步骤级 Sync/Async 结构：Sync 从步骤业务逻辑开始计时，到 100 次更新提交同步返回。统一模式删除每次调用 `setData({ items: nextItems, remaining }, callback)`；增量模式每次调用 `spliceArrayDataOnPath(['items'], index, 1, [])` 暂存删除，再调用 `setData({ remaining }, callback)` 将删除及计数一起应用并注册更新确认回调，不提交剩余列表。两种模式均不逐项等待；增量模式不为无回调参数的 `applyDataUpdates()` 假设一个完成回调。Async 从 Sync 结束，到全部更新回调返回、`wx.nextTick` 后读取 `.screen` 的 `boundingClientRect` 回调。每步 `elapsedMs = syncMs + asyncMs`；步骤开始前的调度、结束后的校验及字节估算不计时。每次运行固定选定的模式，不在计时期间切换算法。

这不是浏览器计时接口的完全复刻：原版使用合成 DOM 事件、RAF/定时器及同步 `getBoundingClientRect` 强制布局；小程序调用同一 Todo 业务补丁逻辑，没有派发真实组件事件，也没有同步强制布局 API。此处采用原生更新周期及异步视图尺寸查询作为替代终点，Async 包含通信和查询回调等待，不是纯绘制耗时，也不保证物理屏幕已呈现。WebView 和 Skyline 使用同一原生协议。

## 评分

评分模块位于 `miniprogram/utils/score.js`。Todo 每轮先将三个步骤的 `elapsedMs`（毫秒）相加为套件总耗时 T，单独运行一个 Todo 套件时 G = T，S = 1000 / G；对应原版先求套件总耗时、再跨套件取几何平均的单套件情况。当前没有跨四个场景的综合运行器。

新闻、编辑器和图表继续对当前场景各阶段耗时取几何平均 G，再计算 S = 1000 / G。所有场景最终对正式轮次的分数取算术平均。95% 置信区间使用 Student t 分布，当前覆盖 2 至 10 个轮次样本；单个样本不显示区间。

当前四个场景分别运行。Todo 的 T = t1 + t2 + t3；其余场景若本轮有 M 个阶段，G = (t1 * t2 * ... * tM)^(1/M)，所有阶段等权。阶段中位数和操作 P50/P95 不参与计分，初始化、重置和阶段结束后的校验不计入分数。

- 分数越高越好，无百分制上限；当前输出是单场景分数，不是四个场景的综合分，不应横向比较不同场景的分数。
- 只有完成 10 轮正式测量才标记为正式分数；停止或未完成时，有效样本的均值标记为临时分数，无有效样本时不显示分数。
- 预热、失败轮次以及包含非有限或负的阶段耗时的轮次不参与计分。Todo 与原版一样要求套件总耗时大于零，允许低精度时钟下单个步骤为零；其余场景要求每阶段大于零。无效轮次进入补测流程；原始阶段耗时不经过显示精度舍入再计分。
- Todo JSON 的 `scoring` 使用 `native-score-v3`、聚合方式 `suite-total`；逐轮 `scoring` 保存 `phaseTimesMs`、`suiteTotalMs`、单元素 `suiteTotalsMs`、`geomeanMs` 和分数。其余场景仍使用 `native-score-v2`、`phase-geomean`。顶层均保存轮次分数、均值及置信区间半宽 `delta`。
- Todo 顶层 `scoring.calculation` 额外保存分数总和、离差平方和、样本方差、标准差、标准误、自由度、t 临界值及置信区间上下界，直接来自同一次评分计算。计算过程面板在测量结束后生成，默认折叠，新测试开始时清空，不改变计时边界或评分算法。面板使用有效正式轮次的原始样本，不使用阶段中位数；显示保留 4 位小数，极小或极大值改用科学计数法，原始 JSON 保留计算精度。无有效轮次时不生成分数，只有一轮时不生成置信区间，未完成时明确标注临时分数。
- 旧 Todo `native-todo-v1` 为逐项等待，`native-todo-v2` 为批量操作且删除提交剩余数组，`native-todo-v3` 为 glass-easel 增量删除；当前 `native-todo-v4` 增加 A/B/C、模式身份及统一布局约束。评分公式仍为 `native-score-v3`，但比较条件已改变，不能与历史协议分数直接比较，需重新测量。旧评分 `native-score-v1` 使用耗时之和，`native-score-v2` 使用阶段几何平均。
- 小程序与浏览器的负载及完成确认点不同，公式相同不代表分数可直接比较。

在工作区根目录运行评分与运行器测试：`node --test mini_speedometer/tests/score.test.js`。

## 结果与复现

- Todo 每个步骤只记录一组 Sync/Async/总耗时，摘要中的步骤样本数为正式轮次数；其余场景从首项开始计时，到末项回调结束，包含连续操作之间的调度，P50、P95 汇总同一阶段的操作样本。阶段中位数按轮计算，Sync/Async 各自的中位数之和不一定等于总耗时中位数。
- Todo 每步记录 `setDataCalls`、`spliceArrayCalls`、`payloadKind` 和 `estimatedPayloadBytes`。新增、完成各有 100 次 `setData`、0 次 splice；统一删除有 100 次 `setData`、0 次 splice，估算剩余数组补丁；增量删除有 100 次 splice 和 100 次仅含 `remaining` 的 `setData`，估算 `{ patch, splice: { path, index, deleteCount, inserts } }` 描述。固定 100 项时新增约 9,074 B、完成约 3,780 B；统一删除约 254,096 B，增量删除描述约 9,290 B。估算均在计时之后进行，描述形状不同，不是实际通信量。Todo 与编辑器在自动测试结束后恢复测试前内容。
- 每类负载最多额外尝试 3 轮以补足失败轮次。切后台或手动停止会保留此前有效轮次。真机比较使用同一场景和协议，按机型、系统、微信版本、基础库及实际渲染器区分。浏览器版 Speedometer 使用独立的计分协议。
