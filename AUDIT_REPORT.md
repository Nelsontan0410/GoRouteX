# GoRouteX Audit + Debug 报告与修复计划

> Plan 模式下只能写本文件。批准后第一步：建分支 `audit/fixes-2026-10`，把本文件内容原样写入仓库根目录 `AUDIT_REPORT.md` 作为第一个 commit（`docs: add audit report`）。

## 阶段 1：项目地图
- 用途：新加坡/马来西亚货车配送路线规划 SaaS（订单导入 → 规划 → 派车 → 司机执行/GPS 跟踪），Stripe 订阅收费。
- 技术栈：纯静态 HTML/原生 JS（无框架、无打包）+ Firebase Auth/Firestore（客户端 SDK）+ Netlify Functions（Node ESM，esbuild）+ Stripe + Google Maps JS/Directions。
- 入口：`index.html`（营销）、`login.html`、`app.html`（主应用，13,997 行，内联脚本约 12.7k 行）、`order-hub.html`、`dispatch.html`、`settings.html`、`driver-tracking.html`（`/driver.html` 重写到此页）。
- 核心模块：`firebase-config.js`（2,399 行：auth/stops/history/session/billing）、`route-engine.js`、`route-safety.js`、`lorry-restrictions.js`、`route-storage.js`（IndexedDB），以及 `orders/`、`planning/`、`driver/`、`dispatch/`、`settings/`。
- 服务端：`netlify/functions/` 共 12 个函数（Stripe checkout/webhook/portal/cancel/sync/reconcile/价格刷新，driver-login（bcrypt PIN），driver-accounts，dispatch）。
- 数据与规则：`firestore.rules`（214 行）。
- 环境变量：`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`BILLING_FX_API_KEY`、Firebase Admin 凭据、价格刷新 token。客户端硬编码了 Google Maps key（`app.html:1179`）。
- 构建：`node scripts/build-site.mjs` 输出到 `dist`，按黑名单复制根目录文件。测试：`node --test tests/*.test.mjs`（35 个测试文件）。没有 lint、type-check 和 README。
- **基线：未能运行。** 本机没有 Node.js（`node`、`deno`、`bun` 都不存在），所以测试、build、`npm audit` 都没跑，结果全部待验证。

## 阶段 4A：摘要
**健康度 6/10。** 服务端安全基础扎实：所有 Netlify 函数都验证 Firebase ID token 或 Stripe 签名，价格由服务端选择，webhook 有事务幂等，没有硬编码服务端密钥。主要风险有两类：
1. **收费绕过**：Firestore 规则用黑名单保护套餐字段，漏掉了两个到期字段；套餐限额也只在前端执行。
2. **数据丢失**：stops 立即保存在并发时会丢；订单保存整体覆盖文档；多处 last-write-wins。

`app.html` 是 14k 行的单体脚本，还有不少死代码，可维护性差。

问题数：Critical 0 / High 4 / Medium 13 / Low 12。

## 阶段 4B：问题清单
| ID | 严重度 | 类别 | 位置 | 问题 | 根因 | 建议修复 | 工作量 | 置信度 |
|---|---|---|---|---|---|---|---|---|
| H1 | High | 安全/收费 | firestore.rules:51-95,101 | 用户可以自己写 `subscriptionExpiresAt` 或 `accessExpiresAt`，创建账号时也能把 `trialEndsAt` 设成 2099 年，试用永不过期。客户端和 driver-domain 的到期判断都会读这几个字段。 | 规则用的是黑名单（`protectedPlanFields`），漏掉了两个到期字段；`trialEndsAt` 在创建时只校验类型，不校验值。 | 把这两个字段加进黑名单；创建时要求 `trialEndsAt <= request.time + duration.value(N,'d')`。 | S | 确认 |
| H2 | High | 数据丢失 | firebase-config.js:923-935, 705-723 | 已有写入在进行时，再调用 `saveStopsCache({immediate:true})`，会直接返回旧的 promise。旧写入的 `.finally` 随后把 `_stopsPendingWrite` 清成 false，新的 stops 就不会被写入。 | flush 时没有区分“正在写入”和“又有新的脏数据”。 | 增加一个 dirty 代计数器 `_stopsGen`：写入开始时记下当前代；finally 里如果代号变了，就再写一次，而不是清掉 pending 标志。 | S | 确认 |
| H3 | High | 数据完整性 | orders/order-store.js:10 | 对已有订单直接 `ref.set(data)`，没有 merge，会覆盖司机在事务中写入的 `executionStatus`、`driverRouteId`、`executionUpdatedAt`。Order Hub 用旧副本编辑后，送达结果会被回滚。 | 整文档覆盖，且没有字段所有权划分。 | 已有订单改用 `set(data,{merge:true})`，并从 `data` 里剔除执行相关字段；或者改用事务。 | S | 代码确认，回滚场景高度可疑 |
| H4 | High | 收费 | netlify/functions/stripe-webhook.js:55,108-117 | `incomplete`（例如放弃了 3DS 验证）被当作宽限期，给了 `planStatus:'active'` 和 3 天付费权限；`incomplete_expired` 会抛异常，导致 Stripe 一直重试，最终把事件标记为 failed。 | 状态映射没有区分“从未付过款”和“续费失败”。 | `incomplete` 不授予付费权限，保持原套餐；`incomplete_expired` 按 canceled 处理（降级）。 | S | 确认 |
| M1 | Medium | 收费 | billing-cancel-subscription.js:40 | 取消订阅的幂等 key 固定。取消 → 在 Portal 恢复 → 24 小时内再次取消，Stripe 会回放缓存的旧响应，实际并未取消。 | 幂等 key 没有包含请求维度。 | key 末尾加上时间戳或 `crypto.randomUUID()`。 | S | 待验证（取决于 Portal 是否允许恢复） |
| M2 | Medium | 收费可靠性 | stripe-webhook.js:147 | 事件处于 processing 且不到 10 分钟时，重复投递直接返回 200 duplicate。如果函数在处理中途崩溃，Stripe 不会再重试，这个事件就永久丢失。 | 进行中的事件也返回了 2xx。 | 进行中的事件返回 409，让 Stripe 稍后重试。 | S | 确认 |
| M3 | Medium | 授权 | netlify/functions/dispatch.js:113-127 | `sync-order` 使用的 `orderIds` 来自司机自己可写的 execution 文档，没有和 `dispatchRoutes` 快照比对，司机可以把租户下任意订单标成 DELIVERED 或 FAILED。 | 信任了客户端可写的数据。 | 取 `dispatchRoutes` 快照里对应 stop 的 orderIds 做交集。 | M | 确认（agent 读码） |
| M4 | Medium | XSS | app.html:8115-8128 | `customer.Name` 和地址标签未经转义直接拼进 `innerHTML`，导入的表格数据可以注入脚本。 | 缺少转义。 | 使用文件中已有的 escape 工具（同文件 12452 行附近的写法）。 | S | 确认 |
| M5 | Medium | 收费 | app.html:2350-2361；planning-persistence.js:275 | Basic 套餐的“每日规划次数”只记在 localStorage，清掉就能重置。 | 限额只在前端执行。 | 需要你决策，见 D2。 | M | 确认 |
| M6 | Medium | 数据丢失 | firebase-config.js:606-680 | 每次修改都把整个 stops 列表覆盖写回云端。多个 tab 或设备同时使用时，旧列表会删掉对方新增的 stop。chunk 写入（655-676）也不是原子操作。 | last-write-wins，没有版本号。 | 加 `version` 字段并用事务比较版本（CAS），冲突时重新加载。 | M | 确认 |
| M7 | Medium | 数据丢失 | route-storage.js:524-580,555-575 | 后台从云端水合 IndexedDB 时会 `clear()` 掉用户刚写的本地数据；云端返回 `success:false` 时仍然标记为已迁移，以后不会再重试。 | 先检查后写入，中间有 await；失败分支判断有误。 | 写入前再检查一次本地数据；`success:false` 时记为 `cloud-failed`。 | S | 确认 |
| M8 | Medium | 一致性 | planning-persistence.js:39-52,109 | selection 每次变化都发一次不 await 的整体 `.set()`，乱序完成会留下旧值；`session.updatedAt` 是 Timestamp 对象，存进 localStorage 后变成字符串，解析为 0，“本地较新”保护因此失效。 | 没有防抖和顺序控制，时间类型错误。 | 加防抖，丢弃过期序号的写入；存 `toMillis()`。 | S | 109 行确认，乱序高度可疑 |
| M9 | Medium | 稳健性 | billing-reconcile.js:10-49 | 循环外层没有 try/catch，一个 profile 抛错就会中断整次 hourly 任务；`.limit(250)` 没有排序，用户多了以后部分过期用户永远处理不到。 | 缺少逐项错误隔离。 | 逐项 try/catch，加上 `orderBy('graceEndsAt')`。 | S | 确认 |
| M10 | Medium | 安全 | driver-login.js:10,16-22,53 | 锁定只按用户名计数，任何人输错 5 次就能把某个司机锁 15 分钟；没有按 IP 的限流；登录成功会清零失败计数。 | 限流维度单一。 | 增加按 IP 的计数，锁定改为按 用户名+IP 计算。 | M | 确认 |
| M11 | Medium | 规则 | firestore.rules:139,204-207,160-190 | profile 可以写入任意新字段；兜底规则允许读写所有子集合，没有 schema 或大小限制；司机写 execution 时不校验字段；`points` 的写入用的是 `request.resource.data.routeId`，而不是父 session 的 routeId。 | 黑名单加通配规则。 | 先修 points 规则（S）；改成白名单 `hasOnly` 需要你决策，见 D3。 | M/L | 确认 |
| M12 | Medium | 性能 | route-safety.js:629-630 | 在 document 上监听 input/change，每次按键都重绘全部限行 marker。 | 没有防抖。 | 防抖 200ms，并只响应相关输入。 | S | 确认 |
| M13 | Medium | 配置 | app.html:1179；driver-tracking.html:244 | Google Maps key 硬编码。如果在 GCP 上没有做 HTTP referrer 和 API 限制，可能被盗刷。 | — | 在 GCP 控制台确认限制（不需要改代码）。 | S | 待验证 |
| L1 | Low | 性能/死代码 | whatsapp-fix.js:148 | 每 2 秒跑一次 interval，但它读的是 `dataset.phone`，而 ui.js 设置的是 `phoneNumber`，所以永远什么都不做。 | 字段名不一致。 | 删除该文件和 `app.html:1135` 的引用。 | S | 确认 |
| L2 | Low | 死代码 | sheets-sync.js、simple-sync.js、auth.js、directions-service.js；firebase-config.js:1395-1462；planning-persistence.js:319；manual-assignment-page.js:94 | 这些代码没有调用方，却仍然被发布到 dist。 | 历史遗留。 | 删除。 | S | 确认 |
| L3 | Low | 构建 | scripts/build-site.mjs:9-23 | 根目录文件按黑名单复制；子目录列表写死，只复制 .js 和 .css；也不检查 HTML 引用的资源是否存在。 | — | 改成白名单，并加引用完整性检查。 | M | 确认 |
| L4 | Low | 全局冲突 | firebase-config.js:1302 与 planning-persistence.js:54 | 两个文件都定义了全局 `loadSessionFromCloud`，后加载的覆盖前者，换了加载顺序就会出错。 | 经典脚本共享全局作用域。 | 把 planning 那份重命名。 | S | 确认 |
| L5 | Low | 稳健性 | driver-accounts.js:80-99 | resetPin/setStatus 是多步非原子写入，中途失败会导致 sessionVersion 不一致，或 Auth 已被禁用而 Firestore 仍显示 ACTIVE。 | — | 调整顺序或加补偿回滚。 | S | 确认 |
| L6 | Low | 一致性 | dispatch.js:6,171 | `key()` 用 `_` 拼接 ID，可能撞键；没有已保存的计划时会退回使用客户端提交的 planSnapshot。 | — | 改用不会出现在 ID 中的分隔符；拒绝客户端 snapshot（需确认是否有流程依赖它）。 | S | 确认 |
| L7 | Low | 信息泄露 | dispatch.js:60-62；firebase-admin.js:58-65 | 响应带 Server-Timing 等内部计数头；jsonResponse 没有设置 `Cache-Control: no-store`。 | — | 移除内部头，加上 no-store。 | S | 确认 |
| L8 | Low | 收费 | stripe-webhook.js:158-198 | 没有处理退款和争议事件。 | — | 业务决策，见 D4。 | M | 待验证 |
| L9 | Low | 性能 | order-store.js:11-12 | 导入和删除都是逐条事务或逐条请求。 | — | 改用 batch，每批 ≤ 500 条。 | S | 确认 |
| L10 | Low | 可维护性 | app.html（14k 行，`printSummaryPage3` 约 327 行）；firebase-config.js（2.4k 行） | 单体文件。 | — | 逐步抽成模块，见“不建议现在修”。 | L | 确认 |
| L11 | Low | 配置 | _headers:25；google-apps-script.js | 有一条指向不会部署的 demo 页的规则；Apps Script 模板信任客户端传入的 username，不能直接部署。 | — | 删除这条规则，模板加警告注释。 | S | 确认 |
| L12 | Low | 测试 | — | 无法验证基线；webhook 状态映射、规则（emulator）、stops 并发都没有测试。 | — | 随各项修复一起补测试。 | M | 确认 |

阶段 3 Debug 小结：TODO 只有 1 条（`app.html:6080`，录音功能）。调试遗留：`window.debugWhatsApp`（4513）、`forceShowOptimizationSuggestion`（8218）、会打印地址的 console.log（8073-8077）。H2 的复现步骤：添加 stop 触发写入，在写入完成前（慢网下）再执行一次立即保存，然后刷新页面，第二次修改丢失。

## 阶段 4C：依赖关系
- 修任何东西之前，先装好 Node（D1），拿到测试基线。
- H1、M11 都改 `firestore.rules`，要一起部署，部署前先用 emulator 验证。
- H2 和 M6 是同一段 stops 写入代码，先修 H2（小改），M6 的版本控制在它之上做。
- M7、M8 都涉及本地/云端合并，M8 的时间戳修复是 M7 判断正确的前提。
- H4、M2 都改 webhook，可以同批，但要分开 commit。
- L2 删除死代码会改到 `app.html` 的 script 引用，必须排在 L3 构建白名单之前。

## 阶段 5：执行计划
每一项一个 commit，每批改完都跑 `node --test tests/*.test.mjs` 和 `node scripts/build-site.mjs`，失败就停下汇报。

**P0（安全/数据丢失）**
1. H1：`firestore.rules` 的 `protectedPlanFields` 加入 `subscriptionExpiresAt` 和 `accessExpiresAt`；创建规则（约 101 行）限制 `trialEndsAt <= request.time + duration.value(<试用天数>,'d')`。风险：如果有合法的客户端流程写这些字段会被拒，需要先 grep 客户端确认。回滚：revert 后重新部署 rules。验证：用 firebase emulator 做规则单测（需要 `firebase-tools`）。commit：`fix(rules): protect expiry fields and bound trialEndsAt on create`
2. H2：在 `firebase-config.js` 的 `startStopsWrite` 和 `flushStopsCacheWrites` 里加 `_stopsGen` 代计数器，写入完成后如果代号变了就再写一次。补一个单测，mock `writeStopsToFirestore`。commit：`fix(stops): don't drop immediate saves during in-flight write`
3. H3：`orders/order-store.js` 的 `saveOrder` 在已有订单分支改为 merge，并剔除 `executionStatus`、`driverRouteId`、`executionUpdatedAt`。验证：`tests/order-hub.test.mjs`，并新增一个用例。commit：`fix(orders): preserve driver execution fields on order edit`
4. H4：`stripe-webhook.js` 的 `applySubscription` 把 `incomplete` 映射为不授权，`incomplete_expired` 改走降级。验证：`tests/stripe-billing-v1.test.mjs`，加用例。commit：`fix(billing): don't grant access for incomplete subscriptions`

**P1（核心功能）**：M1、M2、M3、M4、M9。改法见上表，每项一个 commit，验证用对应的 billing/dispatch 测试。
- commit message 草稿：`fix(billing): unique idempotency key per cancel request`、`fix(webhook): return 409 for in-flight events`、`fix(dispatch): validate sync-order ids against dispatched snapshot`、`fix(app): escape route suggestion names`、`fix(billing): isolate reconcile failures per profile`

**P2（稳健性/性能/测试）**：M6、M7、M8、M10、M11（只做 points 规则）、M12、L5、L7、L9、L12。

**P3（清理）**：L1、L2、L3、L4、L6、L11，以及删除调试遗留的 console 输出。

**快速收益清单**：H1、H2、H4、M2、M4、M9、L1（每项改动 ≤ 10 行）。M13 只需在 GCP 控制台操作一次。

**需要你决策的问题**
- D1：本机没有 Node。是否允许安装（例如 `brew install node`）来跑测试和 build？不装的话，所有修复都只能静态审查。
- D2（M5）：每日规划次数是否要在服务端执行（Netlify 函数加计数，或规则配合计数文档）？还是接受只在前端限制？
- D3（M11）：profile 和子集合是否改成白名单 schema？这是大改动，需要先梳理所有客户端写入的字段。
- D4（L8）：退款或争议时是否自动收回权限？
- D6（N1）：`package-lock.json` 和 `pnpm-lock.yaml` 同时存在，确认 Netlify 用的是哪个，删掉另一个。
- D5（L6）：是否还有流程依赖“未保存的计划也能直接派车”？

**不建议现在修**
- L10：拆分 app.html。没有测试保护，回归风险高，等 P0-P2 稳定、测试补齐后再做。
- M6：stops 的完整 CAS 版本控制。涉及数据格式迁移，先用 H2 止血，再单独设计。
- D3 的白名单规则全面改造：需要先梳理字段清单。

## 实施规则（批准后）
建分支 `audit/fixes-2026-10`，不动 main。每批改完立即验证，失败就停。一个修复一个 commit。不做计划外改动，新发现追加到 AUDIT_REPORT.md。每批完成后给 ≤ 10 行的摘要。

## 实施中新增发现
| ID | 严重度 | 类别 | 位置 | 问题 | 建议修复 | 工作量 | 置信度 |
|---|---|---|---|---|---|---|---|
| N1 | High | 依赖安全 | package-lock.json | `npm audit --omit=dev`：1 critical（websocket-driver）、4 high（@fastify/busboy、@grpc/grpc-js、form-data、protobufjs），都是间接依赖，`fixAvailable: true`（非大版本升级）。 | `npm audit fix`，然后跑测试和 build | S | 确认 |

N1 补充：`pnpm-lock.yaml` 本来就是已修复的版本（`pnpm audit --prod` 只有 1 个 moderate），只有 `package-lock.json` 过期。仓库同时有两个 lockfile，建议只保留一个（见 D6）。

基线（安装 Node v24.21.0 到 `~/.local/node` 后测得）：测试 207/207 通过，build 成功（dist 共 100 个文件）。

### 实施备注
- L7：dispatch 的 `Server-Timing`、`X-Dispatch-Counts`、`X-Dispatch-Response-Bytes` 是有意加的性能埋点，`dispatch/dispatch-board.js:23` 会读它们，且只返回给已登录用户，所以保留不删，只给 `jsonResponse` 加了 `Cache-Control: no-store`。
- M6：stops 完整的版本控制（CAS）按“不建议现在修”暂缓，H2 已先止血。
- L6：暂不修。`key()` 的格式也被用来查找已派出的路线（`dispatch.js:237`），改格式后旧派车记录查不到，可能被重复派车，需要先做数据迁移；而碰撞只发生在同一租户内。读取客户端 planSnapshot 的回退逻辑等 D5 决定后再处理。
- L3：`sample-route.csv`、`app-dashboard-static.png` 没有被引用，但可能有外部链接在用，所以没删；build 新增了引用完整性检查。
- 调试遗留：只删了正常流程中自动打印客户地址/坐标的 `console.log`（`showOptimizedRouteSuggestion`）。`debugWhatsApp`、`forceShowOptimizationSuggestion`、`checkCoordinateData` 只在手动调用时运行，而且错误提示会让用户去控制台排查，所以保留。
- 新发现 N2（Low，待验证）：`app.html` 中 `showOptimizedRouteSuggestion` 的错误分支把 `errorAnalysis` 和 `solutions` 未转义直接写入 `messageBarPg2.innerHTML`，内容可能包含地址名。没有在本次修复。

## 决策结果（2026-10-04）
- D2 → 选 A，已实现：新增 `route-plan-usage` 函数，在服务端按“用户 + 新加坡日期”计数，套餐按服务端判断的有效套餐计算，计数存放在客户端无法访问的顶层集合 `routePlanUsage`。限制：Basic 的路线只保存在用户设备上，所以这只能防止“清除浏览器数据”这类绕过，挡不住直接修改前端 JS；函数不可用时允许继续保存。
- D3 → 暂缓，等其他事项完成后再提醒。
- D4 → 选 B，维持现状，退款和争议手动处理。
- D5 → 保留现状。L6 关闭不修：本地存储模式的用户在服务器上没有已保存的计划，派车时要靠客户端提交的快照。
- D6 → 只保留 `pnpm-lock.yaml`，`package-lock.json` 已删除。
