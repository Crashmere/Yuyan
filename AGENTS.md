# Yuyan 维护入口

先读 [docs/README.md](docs/README.md)，再按任务读取设计与验证文档。

- Yuyan（语燕）是用户一人使用的网页知识库，功能参照语雀网页版中适合单人使用的部分：知识库与文档树、所见即所得编辑、阅读页。
- Go 内嵌 Vue + Tiptap 前端 + SQLite。正文以 Tiptap 文档 JSON 保存并记录格式版本号；Markdown 只用于导入和导出。启动缺库必须报错，只有 `init` 会建库。
- 前端是单页应用：Go 对所有页面地址返回 `internal/server/templates/shell.html`，由 `internal/server/app.go` 预加载首屏数据，预加载的键必须与前端请求的 API 路径完全一致；正文 HTML 仍由 Go 渲染。前端代码在 `web/src/app`（路由、布局、目录、页面）、`web/src/ui`（通用组件）、`web/src/editor`（编辑器，按需加载）。
- 界面改版（阶段 D）按 docs/DESIGN.md 第 12 节进行，只在 Markdown 能表达的范围内优化；开发前先读该节。文档格式只在用户要求时扩展。导出时，Markdown 能表达的按 Markdown 写，例如代码块的标题和收起状态写在围栏信息串里（第 16 节）；Markdown 之外的能力写成 HTML，导入时读回，尽量不丢信息，例如设置了列宽行高的表格（`web/src/schema/markdown.ts`，第 18 节）。阶段 E 第一批（搜索面板、版本对比等）见第 13 节，第二批小功能见第 14 节，第三批见第 15 节，第四批（语雀式代码块与 `[!code]` 迁移）见第 16 节，第五批（大纲按语雀方式收起）见第 17 节，第六批（统一按钮提示、取消编辑、表格宽高等）见第 18 节。
- 代码块的标题和收起状态由 `web/src/schema/codeBlock.ts` 定义，编辑器、静态渲染和 Markdown 共用；Go 端在 `internal/render/render.go`。代码编辑用 CodeMirror 6，实现在 `web/src/code`，`web/src/editor/codeNodeView.ts` 与 `views/CodeBlockView.vue` 将代码变更、选区和撤销接入 ProseMirror；不单独保存正文或维护第二套撤销历史。JetBrains 键位与帮助共用 `web/src/code/keymap.ts`，缩进固定 4 个空格；格式化在按需加载的 `format.worker.ts` 中执行，异步结果核对源码版本与语言，前后隔开文档撤销历史。阅读页保留静态 HTML，按需加载语法折叠和放大视图。配色是 One Dark Pro：阅读页由 `internal/render/highlight.go` 生成，编辑器用 CodeMirror One Dark 和 `web/src/code/style.css`，改一边时对照另一边。块内折叠和换行偏好只存在本机浏览器，不扩展文档格式；交互与边界见 DESIGN 第 21 节和 `web/e2e/code.spec.ts`。
- 对齐的格式定义在 `web/src/schema/alignment.ts`（DESIGN 第 19 节），只支持图片、段落和表格。单元格 `cellAlign` 是列对齐 `align` 的独立覆盖；整表位置是 `blockAlign`，宽表格的定位仍由 `web/src/shared/tableFrame.ts` 处理。导出对齐时用 HTML 保留，两端渲染与导入同时更新。
- 阅读页在 Go 渲染的正文上由前端补充的行为集中在 `web/src/app/content`：`enhance.ts`（代码、表格、公式、图表、图片占位；宽表格的框在 `web/src/shared/tableFrame.ts`，编辑器也用）、`folds.ts`（按标题折叠，展开用 `reveal()`）、`matches.ts`（搜索高亮）。滚动到正文中某处之前先调用 `reveal()`，否则目标可能在折叠的节里。
- 搜索面板的拼音由服务端 `internal/server/pinyin.go` 用 go-pinyin 词典生成（随 `/api/titles`、`/api/books` 返回，含多音字），前端 `web/src/app/search/match.ts` 只负责匹配；不要在前端再引入拼音字典或用排序规则推算。
- 按钮的提示写在 `data-tip` 上，由 `web/src/ui/tooltip.ts` 统一显示；不要用 `title` 或组件库的 Tooltip 做按钮提示。阅读页和编辑页的大纲共用 `web/src/app/content/OutlinePanel.vue`（外观、固定与折叠）和 `outline.ts`（当前节的判定）。
- 首次加载的脚本预算见 DESIGN 12.3。再增加按需加载的 Vue 组件时，Rolldown 会把 Vue 等共用代码拆出主包（首次加载多 2–4 KB）；按需加载的部分尽量只放不依赖 Vue 的逻辑，如版本对比的 `web/src/app/versions/compare.ts`。改动后用构建清单核对首次加载的分块。
- 编辑器扩展（`web/src/schema`）与 Go 渲染器（`internal/render`）必须一一对应；新增或修改节点时同时更新两端，并运行 `make parity` 刷新一致性快照。
- 编辑器界面（`web/src/editor`）：`EditorPane.vue` 通过 `context.ts` 向工具栏、浮层和节点视图提供编辑器实例与界面回调；`tables.ts` 在表格结构变化后恢复 Markdown 表格的形状，改动它或其他编辑器配置后，对正式实例运行 `roundtrip`（只读）确认现有文档不受影响；上传占位是装饰，不写入文档。编辑器交互以 `web/e2e/editor.spec.ts` 的结果为准：IDE 浏览器工具会给页面元素加标记属性，ProseMirror 会因此重新读取选区（节点选区变成文本选区、正文里的菜单被关闭），这类现象不是产品问题；页面里可以用 `document.querySelector('.ProseMirror').editor` 取得编辑器实例。
- 文档写入使用 revision 检测冲突，不能静默覆盖；图片按内容寻址且不可覆盖。
- 当前公网使用 HTTPS、无登录。所有写接口集中在 `/api/` 下同一个中间件入口，以后在那里接入登录。
- 修改后运行 `make test`；前端改动还要 `npm --prefix web run build`。测试使用 `.local` 隔离数据，仓库只放合成样例，不提交真实笔记。本机 zsh 对 goenv 做了延迟加载，`make` 找不到 `go` 时在命令前加 `PATH="$HOME/.goenv/shims:$PATH"`。
- 导入：`npm --prefix web run import -- --source <笔记仓库> --server <实例地址>/yuyan/ --overrides .local/import-overrides.json --report <报告文件>`，先加 `--dry` 演练；目标必须是空实例，overrides 的内容见 docs/OPERATIONS.md。导入后运行 `npm --prefix web run roundtrip -- --server <实例地址>/yuyan/`，确认每篇文档都能被编辑器原样接受。导出用 `npm --prefix web run export -- --server <实例地址>/yuyan/ --out <文件夹>`（先加 `--dry`）；本地试用界面用 `npm --prefix web run seed` 向空实例写入合成数据。
- ali 上位于 `/opt/yuyan`，`yuyan.service` 监听 127.0.0.1:18084，经共享 Nginx `/yuyan/` 访问；安装、发布、导入、备份与诊断见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。推送 main 会自动测试并发布，纯文档提交加 `[skip ci]`。
- 服务器上不安装 Node：前端在 CI 构建后嵌入程序。部署先读 server-operations，并显式读取 `ssh ali 'cat /opt/AGENTS.md'`；哪些事直接做、哪些先确认，只看 server-operations SKILL.md 的授权表。
- 仓库 public，不提交数据库、图片、备份、凭据或服务器公网地址。
