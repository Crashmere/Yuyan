# Yuyan 维护入口

本项目为个人使用：在本地验证本次改动即可发布，不设全量回归门槛，不默认新增或保留永久测试。界面改动检查实际使用的电脑/手机场景；数据迁移、批量写入/删除和备份恢复先用隔离副本针对性验证。

GitHub 只备份源码和配置，推送不触发测试或部署。本机入口及回退见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)；共享流程由 server-operations 维护。

先读 [docs/README.md](docs/README.md)，再按任务读取设计与验证文档：改动某项能力前先读下方索引中的 DESIGN 章节；验证与上线核对记录写入 [docs/VERIFICATION.md](docs/VERIFICATION.md)，不写回 DESIGN。

Yuyan 平台能力新增、修改或删除时，必须在同一任务中同步维护个人技能仓库 `Crashmere/agent-config` 的 `skills/yuyan-doc/`，使用 personal-skill-management；更新范围和验证要求见 [yuyan-doc 同步维护](docs/README.md#yuyan-doc-同步维护)。所有技能脚本、参考资料和技能专用验证材料均归个人技能仓库，Yuyan 仓库只保留项目代码及维护约定。

## 架构

- Yuyan（语燕）是用户一人使用的网页知识库，功能参照语雀网页版中适合单人使用的部分：知识库与文档树、所见即所得编辑、阅读页。
- Go 内嵌 Vue + Tiptap 前端 + SQLite。正文以 Tiptap 文档 JSON 保存并记录格式版本号；Markdown 只用于导入和导出。启动缺库必须报错，只有 `init` 会建库。
- 前端是单页应用：Go 对所有页面地址返回 `internal/server/templates/shell.html`，由 `internal/server/app.go` 预加载首屏数据，预加载的键必须与前端请求的 API 路径完全一致；正文 HTML 仍由 Go 渲染。前端代码在 `web/src/app`（路由、布局、目录、页面）、`web/src/ui`（通用组件）、`web/src/editor`（编辑器，按需加载）。
- 首次加载的脚本预算见 DESIGN 12.3：只有阅读页随应用入口加载，其他页面按需加载，页面外壳按地址预载对应页面的分块；新增按需页面同步登记 `internal/server/app.go` 的 `routeViews`，否则服务启动报错。按需加载的功能尽量只放不依赖 Vue 的逻辑，如版本对比的 `web/src/app/versions/compare.ts`；改动后用构建清单核对首次加载的分块。
- ali 上位于 `/opt/yuyan`，`yuyan.service` 监听 127.0.0.1:18084，经共享 Nginx `/yuyan/` 访问；安装、发布、导入导出、备份与诊断见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 通用约束

- 文档格式只在用户要求时扩展；界面改动先读 DESIGN 第 12 节，只在 Markdown 能表达的范围内优化。导出时 Markdown 能表达的按 Markdown 写，例如代码块的标题和收起状态写在围栏信息串里；之外的能力写成 HTML，导入时读回，尽量不丢信息（`web/src/schema/markdown.ts`）。
- 修改正文格式时，同步编辑器节点视图、Go 静态渲染、HTML/Markdown 导入导出、搜索与历史摘要。新增的节点和属性写在正文 JSON 中，本身不需要数据库迁移；但使用后不能直接回退到不识别它们的程序。
- 改动格式定义、`editor/tables.ts` 或其他编辑器配置后，对正式实例运行 `roundtrip`（只读）确认现有文档不受影响；正式实例只做只读验证。
- 自行渲染子内容的代码块和图片画板节点视图必须经过 `editor/managedNodeView.ts`，向 ProseMirror 返回 `contentDOM=null`；Vue 渲染器默认给非叶节点创建脱离页面的内容容器，弹窗的无障碍属性变化触发祖先重解析时会把该容器读成空。此类视图只通过事务写正文；带代码块与画板的合成文档应覆盖弹窗打开、取消、应用和保存重开。
- 文档写入使用 revision 检测冲突，不能静默覆盖；图片按内容寻址且不可覆盖。上传占位是装饰，不写入文档。
- 按钮的提示写在 `data-tip` 上，由 `web/src/ui/tooltip.ts` 统一显示；不要用 `title` 或组件库的 Tooltip 做按钮提示。
- 当前公网使用 HTTPS 与 ServerPortal 统一设备认证，所有公网页面和 API 均由共享 Nginx 校验。应用写接口继续保留自身来源校验。
- 测试使用 `.local` 隔离数据，仓库只放合成样例，不提交真实笔记。本机 zsh 对 goenv 做了延迟加载，`make` 找不到 `go` 时在命令前加 `PATH="$HOME/.goenv/shims:$PATH"`。
- 导入目标必须是空实例，导入和导出先加 `--dry` 演练；导入后运行 `roundtrip` 确认每篇文档都能被编辑器原样接受；本地试用界面用 `seed` 向空实例写入合成数据。命令与 overrides 见 docs/OPERATIONS.md。
- 服务器上不安装 Node：前端在本机构建后嵌入程序。部署先读 server-operations，并显式读取 `ssh ali 'cat /opt/AGENTS.md'`；哪些事直接做、哪些先确认，只看 server-operations SKILL.md 的授权表。
- 仓库 public，不提交数据库、图片、备份、凭据或服务器公网地址。

## 能力索引

括号内是 DESIGN 章节，改动前先读；这里只列代码位置和必须保持的约束。

- **代码块**（16、21）：标题和收起状态由 `web/src/schema/codeBlock.ts` 定义，编辑器、静态渲染和 Markdown 共用；Go 端在 `internal/render/render.go`。CodeMirror 6 在 `web/src/code`，`web/src/editor/codeNodeView.ts` 与 `views/CodeBlockView.vue` 将代码变更、选区和撤销接入 ProseMirror；不单独保存正文或维护第二套撤销历史。JetBrains 键位与帮助共用 `web/src/code/keymap.ts`，缩进固定 4 个空格；格式化在按需加载的 `format.worker.ts` 中执行，异步结果核对源码版本与语言，前后隔开文档撤销历史。阅读页保留静态 HTML，按需加载语法折叠和放大视图。配色是 One Dark Pro：阅读页由 `internal/render/highlight.go` 生成，编辑器用 CodeMirror One Dark 和 `web/src/code/style.css`，改一边时对照另一边。
- **对齐**（19）：`web/src/schema/alignment.ts`，只支持图片、段落和表格。单元格 `cellAlign` 是列对齐 `align` 的独立覆盖；整表位置是 `blockAlign`，宽表格的定位仍由 `web/src/shared/tableFrame.ts` 处理。导出对齐时用 HTML 保留。
- **图片阴影、裁切与组合**（19、19.2–19.3）：阴影边框为可选 `image.shadow`（`web/src/schema/imageStyle.ts`）。几何定义在 `schema/imageGeometry.ts`，`imageBoard` 包含真实图片节点，原图保持不可变；画板改尺寸与整体缩放是两个独立操作。
- **颜色、图片说明与表格结构**（23.1–23.4）：`schema/colors.ts` 与 `internal/doc/colors.go` 共用纯色规则、浅深语义色与固定文字渐变；`textColor` 为文字标记，文字背景色用 `highlight.color`，`backgroundColor` 为单元格属性，默认高亮仍导出 `==文字==`。文字色在高亮/链接内部渲染，静态渲染器的反向 mark 顺序由 `markdown.ts` 统一处理。图片说明用 `image.caption` 与 `schema/imageCaption.ts`，独立于 alt/title。表格保留实际表头和跨行跨列结构，不强制首行表头。含这些格式的容器整体导出 HTML 并读回。
- **格式刷**（23.5）：`editor/formatPainter.ts` 管理临时采样和单次/连续模式，使用 `selectionContent.ts` 的真实选区范围；只复制文字视觉标记和段落样式，保留目标链接、图片与代码内容，每次应用单独撤销；顶部格式刷和清除格式共用 `FormatIcon.vue` 的图标。
- **折叠块与高亮块**（23.6）：格式与固定色板在 `schema/blockContainers.ts`，折叠节点视图/键盘行为在 `editor/blockContainers.ts`，高亮色板在 `HighlightBlockToolbar.vue`。折叠视图的 `contentDOM` 真实挂载并由 ProseMirror 管理，不使用 managedNodeView；收起前移走正文内光标，定位隐藏内容和搜索命中时展开。
- **分栏**（23.7）：`schema/columns.ts` 定义 `columns(widths)` 与 `column`，`editor/columns.ts` 使用真实 contentDOM 管理内容，拖柄位于其外。减少栏数与取消分栏必须按栏顺序保留全部块；栏宽是比例权重，手机纵向显示；结构校验随格式同步维护。
- **附件与素材回收**（23.8）：块节点 `attachment` 与 `schema/attachment.ts`；上传/下载在 `internal/server/attachments.go`，预览与压缩包目录在 `attachment_preview.go`、`attachment_archive.go`，阅读卡片在 `app/content/attachmentPreview.ts`。复用 `assets` 表与目录，非图片用 `.bin`，文件原子发布且不可覆盖；卡片名称独立于存储对象，导出 HTML 保留可移植下载链接。附件不设上传大小上限：PutAttachment 接收 io.Reader，边写数据目录临时文件边算哈希；仅附件代理关闭大小检查和请求体缓冲，接收使用空闲期限；图片接口仍限制 25 MiB。未引用的图片与附件连续一小时后回收，引用来源包括正文（含回收站）、历史、模板/片段和媒体链接，重新引用或上传重置计时，状态存于 `meta.asset_gc:*`。备份和上传发布共用 assets 目录跨进程共享锁，清理持排他锁；先提交素材记录删除及重试标记，再删除文件；正在上传的临时文件持锁，异常遗留超过一小时后清理。诊断用 `gc --dry-run`，旧版备份程序不得与新回收程序并行。下载始终强制 attachment，预览内容接口只允许经内容识别的位图/PDF/音视频，HTML/SVG 显示源码，压缩包不解压落盘；PDF.js 的字体/CMap/解码资源由 Vite 随程序打包。清单版本 2 备份图片及附件，恢复兼容版本 1；导出包包含真实文件，不能把导出的 Markdown 附件当成笔记。修改时同步门户声明。
- **链接、模板与片段**（24）：链接复用 `/docs/<id>#<slug>` 与阅读渲染的锚点；`internal/server/links.go` 从存活正文推导关系。模板存于 `meta` 的 `template:<id>`，独立 revision 和现有 JSON 格式；`editor/templates.ts` 闭合选区结构并通过单次事务插入。原生备份覆盖模板和图片，不从源文档删除动作回收模板引用的资源。
- **阅读页增强**（6.2、15）：在 Go 渲染的正文上由前端补充的行为集中在 `web/src/app/content`：`enhance.ts`（代码、表格、公式、图表、图片占位；宽表格的框在 `web/src/shared/tableFrame.ts`，编辑器也用）、`folds.ts`（按标题折叠，展开用 `reveal()`）、`matches.ts`（搜索高亮）。滚动到正文中某处之前先调用 `reveal()`，否则目标可能在折叠的节里。
- **搜索与斜杠菜单**（13.1、14、12.6）：拼音由服务端 `internal/server/pinyin.go` 用 go-pinyin 词典生成（随 `/api/titles`、`/api/books` 返回，含多音字），前端 `web/src/shared/searchMatch.ts` 只负责匹配；不要在前端再引入拼音字典或用排序规则推算。斜杠插入菜单通过 `editor/insertSearch.ts` 共用匹配器；固定项目的逐字拼音、英文关键词与 Markdown 别名随 `editor/commands.ts` 维护，空查询仍显示最近使用。
- **编辑器界面与大纲**（12.6、17）：`EditorPane.vue` 通过 `context.ts` 向工具栏、浮层和节点视图提供编辑器实例与界面回调；`tables.ts` 在表格变化后统一列宽和列默认对齐，保留表头与合并结构。阅读页和编辑页的大纲共用 `web/src/app/content/OutlinePanel.vue`（外观、固定与折叠）和 `outline.ts`（当前节的判定）。
- **历史版本**（13.2）：快照保留 30 天，每天北京时间 03:00 清理，不保底保留；`store/version_retention.go` 负责补跑、事务清理及历史 ID 高水位。首次保存记录“编辑前”，恢复时同事务记录“恢复前”，均适用 30 天期限；正常离开编辑页等待正文和快照完成。历史最后引用移除后，附件重新计时一小时；当前正文、回收站正文和模板继续保护素材。诊断使用 `history-gc --dry-run`。摘要由 `internal/doc/changes.go` 比较相邻快照生成，不依赖外部模型或数据库迁移。
- **数据库布局与迁移**（26.1）：`internal/store/migrate.go` 按顺序执行布局步骤，`meta.layout`/`min_layout` 与正文格式版本 `meta.schema` 分开；`store.go` 的建表常量同时供 `init` 和迁移使用，大字段放在最后。每步一个事务，外键检查通过才提交；表重建按列名复制，不能丢列。兼容旧程序的步骤不提高 `min_layout`，因此 SQL 必须写明列名。`Open`（serve/check/restore）会迁移，备份用 `OpenAsIs` 保持原布局；发布时由新程序在备份之后的 `check` 中迁移，耗时较长的步骤先在正式备份副本上计时。
- **知识库分组**（12.5）：用现有 `meta.book_groups` 保存，GET/PUT `/api/book-groups` 带 revision 冲突检查；分组显示共用 `bookSections`，彻底删除知识库时同步清理归属。

## 门户资源同步

- 门户展示名称使用英文品牌名 `Yuyan`，不附加中文；名称由 deploy/portal.json 维护。

- 修改网站图标或认证时，同时核对 iPhone 的 apple-touch-icon、构建后路径及匿名 GET/HEAD；只允许明确的品牌图标/公开 manifest 例外，页面、API 和用户媒体仍须认证。统一排障与验收见 server-operations 的 common-issues；实际启用状态以 current-state 为准。

- 本项目的 `deploy/portal.json` 是 ServerPortal 资源声明的维护源，记录目录用途、数据库、运行用户、端口、unit、访问路径、API 与备份类型。新增/迁移/删除数据根、接口或运行材料时，必须同步修改声明、对应 docs 与共享应用清单。
- 声明部署在 `/opt/yuyan/config/portal.json`，root 管理；本机发布共用 server-operations 校验器，发布前预检，发布后通过受限 SSH 自动同步并核对门户加载哈希。`registry.d/yuyan.json` 自动登记链接，更新无需重启门户。
- 统一认证由共享 Nginx 与门户负责，不在本项目另存设备白名单；本机调用和发布健康检查按共享约定保留。生产已启用设备认证；变更后同步 server-operations current-state。
- 门户只读展示不替代本项目原生一致性备份；备份格式或媒体生命周期变化时，针对受影响的备份与恢复契约做隔离验证。真实业务数据、凭据和备份仍不得进入 Git。

本机发布自动预检和同步同提交的 `deploy/portal.json`；仅更新声明运行 `make portal`，保留业务程序版本。

网页默认拦截 Tab / Shift+Tab 控件切换并取消焦点高亮；只保留用户明确要求的例外。维护与验证按 [server-operations 网页键盘与焦点约定](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/conventions.md#网页键盘与焦点) 执行。

可编辑画板为独立 `drawing` 原子块，使用固定 Excalidraw 引擎、不可变包与派生预览；所有格式/API、依赖保护、未知版本与回退约束见 [docs/WHITEBOARD.md](docs/WHITEBOARD.md)。素材依赖必须在发布事务及 GC 中展开；新增画板能力同步 yuyan-doc。不得把图片嵌入画板称作矢量化或未经实测宣称节省空间。
