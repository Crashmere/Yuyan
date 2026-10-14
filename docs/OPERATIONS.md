# 安装与运行

公网入口使用可信 IP 证书的 HTTPS，原有 /yuyan/ 路径保持。公网 HTTP 返回 308；API 客户端直接使用 HTTPS。Nginx 覆盖 `X-Forwarded-Proto`，公网入口统一校验设备凭据。证书、续期、回退和整机验收见 [共享 HTTPS 运维](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/https.md)（服务器副本 /opt/server-context/references/https.md）。本项目的后端与发布检查保留本机 HTTP，127.0.0.1:80 的代理检查入口不能从公网访问。公网已接入 ServerPortal 统一设备认证：先在 /portal/login 输入口令授权设备，随后使用同源 Secure/HttpOnly Cookie 访问；未授权 API 返回 401。本机发布检查与服务间调用保留。

操作 ali 前加载 server-operations 并显式读取 `/opt/AGENTS.md`。公开仓库不写正式公网地址；通过受信 SSH 别名取得现场信息。

图片/附件上传与大文档保存共同经过设备认证：附件接口不设上传大小上限并采用流式接收；图片接口仍限制单张 25 MiB，JSON 上限 16 MiB，其他业务请求的 Nginx 上限为 26 MiB。内部认证子请求不另设 body 上限；大请求在进入程序前返回 500 时，见[统一认证误拦大请求](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证误拦大请求)。

## 历史版本保留

阅读模式的“最近修改”按需调用只读 `/api/docs/{id}/recent-changes`，沿用保留历史寻找最近编辑/恢复前基线。没有历史时显示不可比较，不补写快照；无数据库迁移、素材生命周期或备份契约变化。接口与显示契约见 DESIGN.md 13.2，资源声明随同程序发布。

所有文档历史（含回收站文档的历史）保留 30×24 小时，每天北京时间 03:00 删除达到期限的快照，不保留最低版本数。当前正文、回收站正文、模板与片段不变；历史可以完全清空。任务由应用现有每分钟维护循环执行，先清理历史，再扫描附件；成功时间存于 meta 的 version_retention:last_run，服务停机后启动补跑，同一时段重启不重复，失败在下一轮重试。无需 cron、额外 unit 或数据库迁移。

`yuyan history-gc --dry-run --data <数据目录>` 只读返回 cutoff、nextRun、eligible、deleted、ran，不删除记录或写入调度状态；不带 --dry-run 则立即按同一 30 天规则清理并记录本次成功时间。正式诊断使用只读形式。日志 version retention 记录删除数和下一次执行时间；只删除数据库行，不自动 VACUUM，释放的页由后续写入复用。

清理前解析候选快照，历史删除、媒体宽限期重置及调度成功标记同事务提交，解析或 SQL 失败全部回滚。历史最后引用的图片/附件从引用消失后重新开始一小时计时，旧上传日期不触发立即删除。现存正文、回收站、模板或其他历史仍引用的文件继续保留。

编辑器首次保存携带 sessionRevision，在同一事务记录新“编辑前”快照，保护取消编辑的正文与媒体；最新快照已是相同状态的会话边界且距过期超过一周时沿用它（DESIGN.md 13.2）。取消时移除本会话快照。恢复版本同事务记录“恢复前”、校验 revision、更新正文及记录结果。两类保护快照同样保留 30 天。meta 的 version_sequence 保存 ID 高水位，历史清理、取消与彻底删除后不重用旧版本链接；缺失版本返回 404 / version_not_found。

原生备份继续保存完整 SQLite（含保留历史与调度状态）和登记素材；已有备份不受历史清理影响，daily/发布前/手工备份仍按各自策略保留。恢复备份后，下次服务启动会按当前时间补做过期清理；需要提取更早的历史时，先在隔离恢复目录用只读工具查看，不启动服务。程序回退不会恢复已清理的记录或文件，且旧版写入不维护历史 ID 高水位；回退需选择理解本策略的版本，真实恢复仍按原生备份流程确认时点。

## 附件与备份兼容

附件上传不设文件大小上限。仅 /yuyan/api/attachments 的 Nginx 子 location 设置 client_max_body_size 0 和 proxy_request_buffering off，继承现有设备认证、Host/来源转发与空闲超时；其他请求保留 26 MiB 限制。应用流式接收至 data/assets/.upload-*、增量计算 SHA-256，完整表单与文件成功后发布并登记；不使用 /tmp 缓存整文件、不整文件读入内存。仅附件接收改用两分钟读空闲超时，持续上传不受普通请求的两分钟总期限影响。复用 assets 表与目录，无数据库迁移或权限变化。附件下载走 /attachments/{id}，强制作为文件下载并支持 Range；不在图片路由开放 .bin。原始文件不可覆盖。未引用图片与附件按下述一小时规则自动回收，原生备份包含快照时仍登记的所有素材。

服务启动和每分钟扫描全部正文（包括回收站和已删除知识库下的文档）、历史版本、模板/片段，以及其中的图片、附件和媒体链接。启动后首轮解析全部内容，之后只解析上次扫描以来新增或修改的行；解析在取得回收锁前完成，扫描期间保存与其他请求不必等待。首次确认无引用后，连续一小时仍无引用才删除 assets 记录和文件；新上传从成功登记开始计时，重新引用或重复上传同一文件重置计时。已有无引用文件首次扫描时开始计时，不按旧上传日期立即删除。上传成功后放弃编辑、彻底删除文档/知识库或模板，只有在所有引用均消失后才进入回收；单纯删除卡片但历史仍引用时保留。嵌套容器和组合画板同样计入引用。

回收状态保存在既有 meta 的 asset_gc:*，重启不丢计时，无数据库迁移。删除决策在同一写事务中重新核对全部引用；解析或事务失败时不删除文件。先提交登记删除及重试标记，再 unlink，异常退出后继续完成；重新保存已回收附件返回明确的重新上传提示，正文不被覆盖。登记失败留下的完整孤立文件也先观察一小时。正常取消/失败清理未完成上传；异常退出留下的 .upload-* 超过一小时且没有上传进程持锁后清理，长时间持续上传不会被误删。

原生备份和上传发布持 assets 目录的跨进程共享锁，回收持排他锁，保证快照登记和文件硬链接一致；已有备份中的文件不会随源文件清理而丢失，实际释放空间仍取决于这些备份何时按自身策略轮换。诊断只读运行 `yuyan gc --dry-run --data <数据目录>`，返回 referenced、pending、eligible 及可回收字节数，不写计时、不删文件；`gc` 不带该参数执行同样的一小时规则，没有绕过宽限期的选项。服务日志记录任务启动、回收数量/字节和失败原因。

阅读卡片点击打开预览，只有独立下载按钮触发下载。只读元信息/文本/目录接口为 `/api/attachments/{id}/preview`，位图、PDF 与音视频内容走 `/attachments/{id}/content`，均受现有认证保护；内容接口按文件签名限制类型，HTML/SVG 只能以文本预览或下载。压缩包只列目录，不解压落盘或读取其他分卷；支持格式与读取限制见 DESIGN 23.8。PDF.js 及字体、CMap、解码资源在本机随前端构建，版本化资源位于 `static/assets/pdfjs-<版本>/`，打开 PDF 后才加载，不向第三方传送文件。无服务器新运行时、持久化目录或备份格式变更。

附件下载与媒体预览内容输出采用两分钟写空闲超时，不再因总下载时间超过普通响应期限而中断；Range 保持。

原生备份清单版本为 2，覆盖所有登记图片及 .bin 附件并核对 SHA-256；恢复同时接受旧版本 1 的图片备份。门户 media 备份沿用原生快照中的整个 assets 目录，无需修改共享收集器。使用附件之后，程序回退必须选择支持 attachment 节点与 .bin 备份的版本，旧程序无法安全保存此类文档或完成备份。保存过大于 25 MiB 的附件后，回退还必须选择已取消附件正文大小校验的版本。启用回收后，备份必须使用带目录共享锁的新程序；不能让不识别锁的旧备份进程与回收并行。整体回退到旧程序会停止自动回收，但不会恢复已回收文件；恢复文件需选择保留该文件的原生备份并按恢复流程操作。文件名及资源路径的导入导出规则见 DESIGN 23.8。

## 可编辑画板

画板格式、API 与编辑契约见 [WHITEBOARD.md](WHITEBOARD.md)。包与图片都在 `data/assets/`，包 MIME 为 `application/vnd.yuyan.drawing+json`、扩展名 `.bin`；无数据库表、数据目录、权限或服务器运行时变更。上传包限 12 MiB，沿用普通代理限制；不套用不限大小的附件 location。引擎和字体随本机前端构建内嵌，许可证在版本化字体目录的 `licenses/`。

保存含画板的文档要求 `X-Yuyan-Features: drawing-v1`；旧标签页提示刷新，新网页与 yuyan-doc 自动携带。回退必须选支持 drawing 的程序。未知引擎/包禁止编辑，预览经独立校验后仍可读、原文件可下载；GC 遇到未知/损坏包停止该轮清理，不猜测图片引用。

v2 备份保持不变，画板包与依赖图片均随已登记素材保存。包在未引用宽限期内继续保护图片；包回收后图片才开始自身一小时计时。历史/模板引用保留，备份硬链接不受源文件回收影响。隔离生命周期检查覆盖去重、包宽限期、正文/历史/模板保护、缺包拒绝保存、v2 备份恢复，以及先回收包后回收图片。

导出目录保留 `<ID>.yuyan.json`、对应 SVG/PNG 及原图片；重导必须保留同目录图片，缺包或哈希不符即失败。项目导入仅面向空实例，先 dry-run；不能向真实非空库重导覆盖。画板下载按钮可临时生成独立 `.excalidraw`、SVG、PNG。

高分屏 SVG 保存修复：Excalidraw 的默认导出倍率取自屏幕像素密度，2/3 倍屏幕会使 SVG 宽高与 viewBox 不一致，连空白画板新画一个矩形也被拒绝。预览现固定 `exportScale: 1`，同时使用 XMLSerializer 处理不换行空格并规范化画框裁切属性；服务端安全校验保持不变。此前仅调整视口的检查没有覆盖屏幕倍率，后续导出修改必须显式设置 deviceScaleFactor。旧标签页先下载可编辑文件保留未应用内容，再刷新并恢复草稿或导入；本机 Agent 缓存用 preview-setup 更新。

## 图片显示版本

阅读页和编辑器按显示宽度与屏幕像素密度加载较窄的显示版本，规则与接口见 DESIGN 26.3。版本在 `data/derived/images/`（每张原图一个 `<id>.json` 清单和若干 `<id>-<宽>.<jpg|png>`，由服务写入），是可以整体删除的派生缓存：不进原生备份，恢复、迁移或删除后由服务自动补齐。新上传和正在阅读的图片优先，其余在启动 1 分钟后从新到旧逐张处理，最多占用半个 CPU。原图、导出、备份和 yuyan-doc 不受影响；无数据库迁移、权限或 Nginx 变更，版本文件沿用 `/yuyan/assets/` 路由与设备认证。

只读诊断 `yuyan images --data <数据目录>` 汇总已处理数、有版本数、各原因计数、版本占用的空间，以及有版本的图片在手机和 2 倍屏桌面上估计的传输量。原因：small（小于 128 KiB）、animated、palette、cmyk、hdr、orientation（PNG/WebP 自带方向）、profile（色彩配置异常）、large（超过解码限度）、decode、none（没有值得保留的版本）、error。日志 `display versions: backfill done` 记录一轮补齐的处理数与有版本数，单张失败记录 `display versions` 及原因。完全重建时停服务、删除 `data/derived/images` 后启动；运行中删除也安全，缺失的文件改为返回原图，打开页面时重新生成。

## 布局

文档模板与内容片段存放于既有 `meta` 表的 `template:<id>`，包含独立 revision、正文 JSON 和格式版本，无数据库迁移。备份仍为整个 SQLite 快照和全部登记图片、附件，源文档删除后仍保留模板引用的图片，模板可独立复用；恢复模板库需走原生备份恢复，知识库 Markdown 导出不包含模板库。链接选择、预览与文末反向链接从存活正文推导，不新增索引文件或数据目录。接口及交互见 DESIGN 第 24 节，门户 API 声明同步维护。

`/opt/yuyan/bin/yuyan` 为内嵌前端的 Linux amd64 程序。config 放本项目的 unit 与 Nginx location，data 放 `yuyan.db`、`assets/`（按内容寻址的图片与附件，非图片附件扩展名为 `.bin`）与 `derived/images/`（图片显示版本，可删除、不备份），backups 放快照，docs 与 AGENTS.md 是受控文档副本，releases 留发布历史，current-commit 为程序来源。知识库分组保存在数据库现有 `meta` 表的 `book_groups` JSON 中，随一致性备份保留；旧库无需迁移，未配置时所有知识库均未分组。分组 API 与门户声明保持同步，分组不新增数据目录。

运行身份 yuyan，发布身份 yuyan-deploy；data/backups 为 0700，程序与配置由 root 管理。服务监听 127.0.0.1:18084，经共享 Nginx `/yuyan/` 访问，不增加公网端口。systemd 只允许写 data，内存上限 384 MiB（`GOMEMLIMIT=320MiB`），CPU 100%。图片由程序返回并带一年 `immutable` 缓存，Nginx 不直接读取 data，因此 data 保持 0700。

Nginx location 对 HTML、JSON、JS、CSS 开启 gzip：服务器下行只有约 0.5 MB/s，最长的文档页面约 970 KB，压缩后约 300 KB。Go 把 `.js` 返回为 `text/javascript`，`gzip_types` 必须列出它，见共享的 [Go 程序返回的 JavaScript 没有被 Nginx 压缩](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#go-程序返回的-javascript-没有被-nginx-压缩)。附件上传路由单独取消大小上限并关闭请求体缓冲，其他请求上限 26 MiB（程序单张图片上限 25 MiB）。修改此文件后需将同提交 deploy/nginx-location.conf 同步到 /opt/yuyan/config/nginx-location.conf，nginx -t 通过后平滑 reload；make deploy 不自动同步 Nginx 配置。

当前公网使用 HTTPS 与统一设备认证，授权设备可以查看和修改内容；版本历史、回收站和每日备份用于恢复。

发布后旧标签页的动态模块 404 排查见共享 [发布后旧标签页的动态模块加载失败](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#发布后旧标签页的动态模块加载失败)。本应用的构建清单位于 `/static/manifest.json`，页面外壳使用 `no-cache`，带哈希的脚本长期缓存。界面提供全局刷新入口；编辑时先保存，保存冲突或失败不会刷新。浏览器回归通过实际拦截 Mermaid 核心分块、图表类型分块和编辑页分块的 404，核对桌面与 375 px 提示、源码和预览保留、保存期间继续输入以及冲突草稿。

## 首次安装

先核对端口、身份、目录与现有全部服务健康。服务器不需要新的系统软件。

```sh
# 本机 make release 后取 .local/releases/<commit>/program，核对 manifest，再上传安装材料。
bash deploy/install.sh /path/to/yuyan-linux-amd64
ln -s /opt/yuyan/config/nginx-location.conf /etc/nginx/app-locations/yuyan.conf
nginx -t
systemctl reload nginx
bash deploy/setup-deploy.sh /path/to/yuyan-deploy.pub
```

install 拒绝覆盖现有目录或身份，显式初始化正式空库，开启服务与备份 timer，并通过 unit 取得首份备份。setup-deploy 建立只能执行 `deploy`、`portal-check` 和 `portal` 三种固定的 commit/SHA-256 命令 的 yuyan-deploy，sudo 仅允许 root 管理的发布脚本。安装后核对五个应用的直连、代理与深链接。

## 数据库布局迁移

表的列顺序有独立的布局版本（`meta.layout`，缺省为 1），设计见 DESIGN 26.1。新程序打开旧布局时自动迁移，`serve`、`check`、`restore` 都会触发；`backup`、`daily` 只原样复制，不迁移。发布时脚本停服，先用旧程序备份，再由新程序 `check` 完成迁移；失败时放回旧程序，数据库停在迁移前或迁移后的兼容布局，不需要恢复备份。

```sh
yuyan migrate --dry-run --data /path/to/data   # 报告当前布局与待执行步骤
yuyan migrate --data /path/to/data             # 执行并报告耗时
```

第 2 步（`docs`、`doc_versions` 大字段后置）于 2026-10-14 随发布执行，此前的程序仍可在新布局上运行，回退不受影响。迁移后文件约增加被重建表的大小，这些空闲页由后续写入复用，备份不包含它们，不需要手工 VACUUM。以后新增步骤时，先在最新 before-deploy 备份的服务器副本上以 yuyan 身份计时，必须在发布检查的 60 秒时限内完成；副本用完即删。`min_layout` 高于某个程序支持的布局时，该程序拒绝打开数据库，回退前用 `migrate --dry-run` 或报错信息确认。

## 发布与回退

日常更新、声明同步和程序回退统一使用 [本机发布说明](DEPLOYMENT.md)。

## 本地开发

先运行 `npm --prefix web ci` 安装锁定依赖。

```sh
make build
# 首次使用新的隔离目录时才初始化，不覆盖现有目录。
bin/yuyan init --data .local/dev-data
bin/yuyan serve --data .local/dev-data --with-prefix
```

在隔离实例验证本次功能；编辑器/文档格式变化按需使用 roundtrip 检查。没有全量回归或永久测试要求。导入、导出和 roundtrip 工具见后续章节。服务器只运行内嵌前端的 Go 程序。

折叠块与高亮块新增正文节点 `foldBlock`、`foldTitle`、`foldContent`、`highlightBlock`（DESIGN.md 23.6），沿用现有 JSON、revision 和一致性备份，不迁移数据库、不增加 API 或存储目录。导出以 HTML 保存容器、折叠状态和底色，导入可读回；启用新块后，程序回退版本必须能识别这些节点。验证使用合成嵌套内容覆盖折叠、改色、弹窗、撤销、保存重开与格式往返，并对正式实例执行只读 roundtrip。

分栏新增 `columns(widths)` 与 `column` 正文节点（DESIGN.md 23.7），无数据库迁移、新 API、媒体目录或备份格式变化。HTML 导出保留栏宽与内容顺序；写入分栏后，回退版本必须支持这些节点，不能用旧编辑器静默展开或丢弃布局。验证使用隔离合成文档覆盖减少栏数、取消分栏、跨栏拖动、撤销、窄屏及导入导出，正式实例仅执行只读 roundtrip。

代码块标题显隐使用 `codeBlock.titleHidden`，`title` 保留原文字，隐藏后保存重开、HTML 复制粘贴和 Markdown 导入导出均可恢复标题（DESIGN.md 第 16 节）。属性默认 false，旧文档保持原样，无数据库迁移、API、媒体或备份格式变化；旧程序不识别此属性，回退后可能重新显示隐藏的标题。此前被旧“隐藏标题栏”操作清空的标题不会凭空恢复，原文字可从已有历史版本查看，本次不改写真实文档。

目录批量操作通过 `POST /api/docs/batch` 完成复制、移动与移入回收站，参数和交互见 DESIGN.md 12.5，门户声明包含该接口。使用现有表、文档格式、历史快照和图片存储，无数据库迁移；真实文档由用户在界面选择后操作。维护时在隔离合成实例检查父子选择、目录变化冲突、跨库移动、复制层级/内链/历史，以及中途失败的事务回滚；不在正式文档上试删或试复制。

图片工具扩展使用正文内的裁切参数与 `imageBoard` 节点，不改数据库表或图片存储，不生成破坏性裁切文件，复制、资源计数、备份继续使用原图片。新增节点在 Go 与编辑器同时启用，Markdown 导出以 HTML 保留裁切和画板布局。已写入组合的文档不兼容不认识 `imageBoard` 的旧程序，程序回退需先核对内容格式；不自动删除或降级正文。

Markdown 之外的格式第一批（DESIGN 第 23 节）增加 `textColor`、`image.caption` 与单元格 `backgroundColor`，表头和合并使用已有节点及跨度属性。没有数据库迁移、新 API、媒体目录或备份格式变化，门户资源声明沿用；不改写既有文档。Markdown 无法表示的格式连同所在列表/引用等容器导出为 HTML 并读回。使用文字颜色后，旧程序可能拒绝新标记；图片说明与底色也可能被旧编辑器丢弃，回退前必须确认内容兼容，不自动降级正文。验证记录见 [VERIFICATION.md](VERIFICATION.md) 第 23 节。

颜色工具优化（DESIGN 23.4）以 `highlight.color` 保存文字背景色，以 `textColor.gradient` 保存固定渐变名并保留纯色回退值；默认高亮格式不变。彩色高亮与渐变随 HTML 导出读回，旧编辑器可能丢弃新增属性。最近自定义颜色和上次使用颜色只存于浏览器的 `yuyan:colors`，清除浏览器数据会重置偏好，不影响已保存的文档。此改动不涉及数据迁移或门户声明。

格式刷（DESIGN 23.5）复用已有文字标记、标题和段落对齐；采样及连续模式仅为编辑器临时状态，不写入正文或浏览器存储。单次应用沿用正文 revision 检测、自动保存与独立撤销，无 schema、数据库、API、媒体或门户声明变化。

裁切放大预览与拖动切分线使用现有几何参数，无格式或数据库迁移。

弹窗曾触发代码块清空：Vue 节点视图把脱离页面的 `contentDOM` 交给 ProseMirror，弹窗隐藏背景无障碍内容时，祖先 DOM 重解析误读为空正文，随后裁切因文档已变而中止。代码块与图片画板现使用统一托管视图，内容只通过文档事务更新。已保存的受损内容从历史版本定位恢复；恢复真实文档另行确认，并按 revision 检测避免覆盖新的编辑。

## 正式导入

导入只做一次，目标必须是空实例；工具在开发电脑上运行。公网已要求设备 Cookie，现有命令行工具使用受信 SSH 隧道：先在另一个终端运行 `ssh -N -L 127.0.0.1:18199:127.0.0.1:18084 ali`，确认本地端口空闲。直接后端没有 /yuyan/ 前缀；通过隧道的导入仍需单独确认真实数据写入。

```sh
npm --prefix web run import -- --source <笔记仓库副本> --server http://127.0.0.1:18199/ \
  --overrides .local/import-overrides.json --report .local/import-prod.md --dry
# 去掉 --dry 正式导入，完成后检查每篇文档都能被编辑器原样接受：
npm --prefix web run roundtrip -- --server http://127.0.0.1:18199/
```

`roundtrip` 只读取服务器。它检查每篇文档能被编辑器 schema 原样接受，并且编辑表格时不会调整现有列宽或列默认对齐；表头与合并结构原样保留（见 DESIGN.md 第 23 节）。修改编辑器配置后，发布前对线上实例运行一次。

overrides 文件记录需要人工选择的项（同名不同图），不入库。2026-09-26 的正式导入只有一项：`{"images": {"AI记录/Gradle 入门.md|img-001.png": "AI记录/attachments/img-001.png"}}`；本地文件已删除，重新导入空实例时按此重建。

## 代码 Callout 迁移

`migrate-code` 把 `[!code]` Callout 改回带标题栏的代码块（规则见 DESIGN.md 第 16 节）。它在开发电脑上运行，通过 SSH 隧道写入正式实例；需要先发布认识代码块标题的程序。正式实例的程序本身不带 `/yuyan/` 前缀（由 Nginx 去掉），所以隧道地址写到端口为止。它会改写真实文档，所以先做一次手动备份：

```sh
ssh ali 'runuser -u yuyan -- /opt/yuyan/bin/yuyan backup --data /opt/yuyan/data --out /opt/yuyan/backups/manual-$(date -u +%Y%m%dT%H%M%SZ)-before-code-migration'
ssh -N -L 18199:127.0.0.1:18084 ali &                                    # 隧道，完成后结束
npm --prefix web run migrate-code -- --server http://127.0.0.1:18199/ --dry   # 只报告
npm --prefix web run migrate-code -- --server http://127.0.0.1:18199/
npm --prefix web run roundtrip -- --server http://127.0.0.1:18199/
```

每篇改动的文档先保存一个版本再写入，写入时核对 revision；重复运行不会再改动。单篇文档要撤回时，在它的历史里恢复迁移前的版本。2026-09-27 已对正式实例运行，62 篇文档中的 313 个全部转换（结果见 VERIFICATION.md 第 16 节），以后不需要再运行：Markdown 导入会直接把 `[!code]` 转为代码块。

## 存量加粗修复

先区分来源：中文标点紧邻加粗已由共享转换器兼容；标记内空白、缺失结束标记、公式中的未转义乘号仍可能成为普通文字。保存成功或原生 JSON 回读一致只能证明存储完整，不能证明 Markdown 的格式意图被识别。

新导入通过 `markdownToDoc` 的 `issue` 回调取得未解析 `**` 的源文件行列；yuyan-doc 的 `validate/create --format markdown` 会在写入前报 `conversion_error`。先核对原文，在工作副本修正界定符；字面星号使用转义或代码。不要全局删除星号、自动补齐不明确的闭合范围，或将原样内容转成 JSON 绕过诊断。代码/公式/HTML 和已转义的字面内容保持原义。

已经通过 yuyan-doc 导入的文档，用该技能 `read --out` 保存最新快照，按原始导入资料定位后对段落制作 `replace` 补丁，保留其他 marks、链接、媒体及块属性；先 `edit --dry-run`，再保存并检查 `verified:true`。缺闭合或与乘号混淆的段落需根据原文明确加粗范围。修复后的导出 Markdown 已包含转义，不能作为恢复原格式意图的证据。批量修复先在隔离实例验证局部内容保留、历史和 revision 冲突保护。

`migrate-strong` 修复原始 Markdown 中因标点边界而漏识别或配对错位的加粗。它不重新导入整篇文档，也不在阅读或编辑时扫描星号。必须取得当初导入提交的 Markdown，并按数据库只读查询得到的 `docs.source_path` 对应到文档 ID，放入私有目录，文件名为 `<id>.md`；不要使用修复后从 Yuyan 导出的 Markdown 作为原始来源。正文、预览报告和原始笔记只放 `.local` 或其他不受 Git 跟踪的位置。

该迁移工具只对比严格 CommonMark 与中文标点兼容规则，不负责修正源文件中的空白、未闭合或公式歧义；两种解析都失败时应按上述局部补丁流程处理，不能重复运行旧迁移来解决。

```sh
# 通过受信 SSH 隧道访问实例。生成预览只有 GET 请求，报告必须写到新文件。
npm --prefix web run migrate-strong -- --server http://127.0.0.1:18199/ \
  --source-dir "$PWD/.local/strong-source" --preview "$PWD/.local/strong-preview.json"
# 审阅报告并取得真实数据修改授权后，先创建应用一致性备份，再应用同一份报告。
npm --prefix web run migrate-strong -- --server http://127.0.0.1:18199/ \
  --apply "$PWD/.local/strong-preview.json"
```

预览记录每个段落修改前后的 JSON、文档 revision 和内容哈希。写入前先核对全部文档，任一篇在预览后发生变化就停止，重新生成预览；每篇先保存历史快照，再通过带 `baseRevision` 的正常保存 API 写入。写入途中遇到冲突立即停止，已成功的文档可在历史记录中恢复；重新生成预览不会再次改动已修复的段落。只修改配对星号与 bold，无法仅作这些修改、与现存内容不一致或同文档中转义后无法区分的段落会跳过。

## 资料导入后的语义排版修复

Typora 资料可能用行内代码的粉红色来强调普通文字。共享解析器按语法保留 `code`，存储成功不代表这类视觉意图已迁移。使用 yuyan-doc 时先按原文和上下文列出分类清单，将已确认的自然语言改为原生 `textColor`（如 `#d63384`），保留真实 SQL、命令、标识符、字符串和语法模板；一个代码标记同时包住说明与标识符时拆开处理。不能用“包含中文”作为全局替换规则，也不要修改网页统一代码配色。

对包含独立段落或 SQL 编辑区的混合截图，先核对并转写成正文、表格或代码块，再裁剪工作副本并通过 `upload` 换成新素材，保留示意图自身的标签、箭头及图例。阅读遮罩 `crop` 不会减少上传文件内容；用户要求实际去掉文字区时不要用遮罩代替物理裁剪。新节点使用新文件的 `sourceWidth/sourceHeight`、合理显示宽度和 `height:null`。

正文修改仍走技能 `read/edit` 的完整快照、revision 保护和保存回读；批量内容先隔离验证，再 `edit --dry-run`。保留私有分类与裁剪清单，不把用户原文、OCR 或截图提交到项目仓库。针对性核验既有正文次序、真实代码、表格与链接不变，并检查对应段落的原生颜色及图片比例。详细处理规则维护在 yuyan-doc 的 editing/format 参考中，项目不复制另一套转换脚本。

## 导出

导出工具在开发电脑上运行，把全部知识库导出为 Obsidian 可以直接打开的文件夹（Markdown 表达不了的内容写成 HTML，例如设置了列宽行高的表格，见 DESIGN.md 第 18 节）：每个知识库一个文件夹，分组是文件夹，文档是 Markdown 文件，有子文档的文档是同名的 Markdown 文件加同名文件夹；图片与附件放在根目录的 `attachments/`，用相对路径引用。只读取服务器，不做任何修改。先建立上文的受信 SSH 隧道，再使用回环地址。

```sh
npm --prefix web run export -- --server http://127.0.0.1:18199/ --dry          # 只转换和检查，不写文件
npm --prefix web run export -- --server http://127.0.0.1:18199/ --out ~/YuyanExport
```

目标文件夹必须是新的、空的，或者是之前的导出结果。再次导出到同一文件夹时会刷新 Markdown，只下载缺少或校验不符的图片、附件，并删除上次导出而本次已不存在的文件；导出之外的文件不会被改动，因此中断后重新运行即可继续。`.yuyan-export/` 里是清单和报告，报告列出下载失败的图片与附件、指向回收站中文档的链接，以及因含有非法字符或同级重名而改过名的文件。全部图片约 340 MB，按服务器约 0.5 MB/s 的下行速度约需 12 分钟；2026-09-26 对正式实例演练，315 篇文档全部转换成功，1,511 张图片都存在。

`npm --prefix web run seed -- --server <本地实例>/yuyan/` 向空的本地实例写入合成示例数据，用于试用界面和导出；它拒绝写入已有知识库的实例。

## 备份与恢复

每天 Asia/Shanghai 04:00 加 0–5 分钟随机延迟，保留 14 份 daily。备份 unit 的可写目录必须是整个 /opt/yuyan，原因见共享的 [systemd 沙箱下照片硬链接备份失败](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#systemd-沙箱下照片硬链接备份失败)。备份包含 SQLite 一致性快照（`VACUUM INTO`）、图片/附件硬链接和 SHA-256 清单。before-deploy 按共享发布保留策略轮换，manual 不自动清理；2026-09-27 已另取包含本项目数据库与全部已登记图片的全应用归档，下载到维护电脑并校验，见 [共享备份说明](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/current-state.md#手工数据归档)。本应用脚本不主动异机同步；服务器另有阿里云文件备份，范围、30 天保留与恢复限制见[主机云备份](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/current-state.md#云备份)；需要可供 Obsidian 使用的内容副本时，使用上节的导出工具。

```sh
systemctl status yuyan-backup.timer
systemctl start yuyan-backup.service
journalctl -u yuyan-backup.service -n 50 --no-pager
runuser -u yuyan -- /opt/yuyan/bin/yuyan backup --data /opt/yuyan/data --out /opt/yuyan/backups/manual-UNIQUE
```

备份目标目录必须不存在。备份里的图片与附件是硬链接，与正式素材共用同一份数据，不能原地修改。只有带完整 manifest.json 的目录才可恢复。

```sh
yuyan restore --from /path/to/backup --data /path/to/new-restore-directory
yuyan check --data /path/to/new-restore-directory
# 先检查 19084 空闲，再启动隔离恢复实例
yuyan serve --data /path/to/new-restore-directory --listen 127.0.0.1:19084 --with-prefix
```

restore 校验清单中的每个文件，拒绝已有目标，图片复制为独立文件。生产恢复前确认时点和可能丢失的后续修改，停服务，保留当前目录，恢复到新目录并校验后再切换，重启验证。程序回退不等于数据库回退。

## 诊断

```sh
systemctl status yuyan yuyan-backup.timer
journalctl -u yuyan -n 100 --no-pager
curl --fail http://127.0.0.1:18084/healthz
curl --fail http://127.0.0.1/yuyan/healthz
systemctl show yuyan -p MemoryCurrent -p MemoryPeak -p NRestarts
du -sh /opt/yuyan/data /opt/yuyan/backups
runuser -u yuyan -- /opt/yuyan/bin/yuyan images --data /opt/yuyan/data
```

`MemoryCurrent` 包含页缓存：正式导入后程序本身约 30 MiB，另有约 320 MiB 可回收的文件缓存。判断内存问题时看 `/sys/fs/cgroup/system.slice/yuyan.service/memory.stat` 的 anon 与 `memory.events` 的 oom_kill，不能只看接近上限。

缺库或损坏时查备份和权限，不能通过 init 创建空库掩盖错误。文档提交推送后运行 `~/agent-config/skills/server-operations/scripts/sync-docs.sh Yuyan`。

## ServerPortal 接入材料

`deploy/portal.json` 是本应用资源说明的维护源。本机发布使用 server-operations 校验器检查，再将同一声明与二进制保存到同一本地版本目录；发布前执行 `portal-check`，发布后执行 `portal`，通过现有受限 SSH 安装到 `/opt/yuyan/config/portal.json` 并核对采集器实际加载的 SHA-256。`config/portal-source.json` 记录声明来源提交；它与程序的 current-commit 各自表示不同材料的版本。

门户从 `/opt/serverportal/registry.d/yuyan.json` 的受控链接发现本应用，声明成功更新后自动加载，无需重启。首次正常 本机发布也会建立链接，无需再编辑门户中央应用列表。普通发布可更新本应用的声明，其他 unit/env/Nginx/发布脚本仍由管理员安装。

源码或数据库行为变更不能使用该选项代替程序发布。

数据根、媒体、备份格式、unit、端口或访问路径变化时，同一提交维护声明及对应文档，更新共享清单并核对资源覆盖。文件、媒体、数据库表和 systemd 状态由门户自动读取；目录用途、API 说明和权限边界须由维护 agent 明确更新。共同协议、失败处置与新应用接入见 [门户维护](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/portal.md)。

门户 /portal/ 已统一保护公网访问，发布脚本通过回环检查应用健康，本机发布公网检查预期未授权返回 401。设备授权永久有效至主动撤销，Cookie 经共享 Nginx 随有效请求续期；本应用若新增 add_header，必须保留共享 Set-Cookie 转发，规则及验收见共享门户维护文档。门户备份使用本应用原生一致性快照；真实完整链恢复验收按用户要求暂缓，不因本次维护自动继续下载或恢复。

## 手机桌面图标

门户中的应用名为 `Yuyan`，维护源为 deploy/portal.json；中文产品说明不加入门户展示名称。

源码已补充 /yuyan/static/apple-touch-icon.png 的 180×180 PNG 和共用页面 head 声明，Nginx 规则仅放行它与 favicon.svg 的 GET/HEAD。图形源为 web/public/favicon.svg；维护电脑已有 libvips 时运行 node web/scripts/generate-icons.mjs 重新生成。页面、API 和用户媒体继续使用设备认证。共同原因、部署状态与手机验收见[共享排障记录](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证后-iphone-桌面图标缺失)。

## 当前发布入口

本项目为个人使用：在本地验证本次改动即可发布，不设全量回归门槛，不默认新增或保留永久测试。界面改动检查实际使用的电脑/手机场景；数据迁移、批量写入/删除和备份恢复先用隔离副本针对性验证。

完整流程见 [本机发布与回退](DEPLOYMENT.md)。GitHub 只保存源码；本机 `make release` 构建，`make deploy` 更新生产，文档单独同步。

## 发布材料自动清理

服务器每天北京时间 05:00 按[发布材料自动保留](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/retention.md)保留最近 3 次成功发布、最近 5 份完整发布前备份，并保护当前版本、对应备份和待核对失败批次。共享实现、锁、回执、预览及停用命令由 server-operations 维护；本项目 deploy 保留发布脚本的 recovery 标记和每日备份的 flock 入口。首次安装先按共享文档建立 /run/lock/ali-release-retention.lock，再启用 backup timer。daily、manual、业务数据、门户 exports 和维护电脑构建材料不在此自动清理范围。
