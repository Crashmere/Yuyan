# 安装与运行

公网入口使用可信 IP 证书的 HTTPS，原有 /yuyan/ 路径保持。公网 HTTP 返回 308；API 客户端直接使用 HTTPS。Nginx 覆盖 `X-Forwarded-Proto`，公网入口统一校验设备凭据。证书、续期、回退和整机验收见 [共享 HTTPS 运维](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/https.md)（服务器副本 /opt/server-context/references/https.md）。本项目的后端与发布检查保留本机 HTTP，127.0.0.1:80 的代理检查入口不能从公网访问。公网已接入 ServerPortal 统一设备认证：先在 /portal/login 输入口令授权设备，随后使用同源 Secure/HttpOnly Cookie 访问；未授权 API 返回 401。本机发布检查与服务间调用保留。

操作 ali 前加载 server-operations 并显式读取 `/opt/AGENTS.md`。公开仓库不写正式公网地址；通过受信 SSH 别名取得现场信息。

图片上传与大文档保存共同经过设备认证：程序单张图片上限 25 MiB、JSON 上限 16 MiB，Nginx 上限 26 MiB。内部认证子请求不另设 body 上限；大请求在进入程序前返回 500 时，见[统一认证误拦大请求](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证误拦大请求)。

## 布局

文档模板与内容片段存放于既有 `meta` 表的 `template:<id>`，包含独立 revision、正文 JSON 和格式版本，无数据库迁移。备份仍为整个 SQLite 快照和全部登记图片，源文档删除不回收图片，模板可独立复用；恢复模板库需走原生备份恢复，知识库 Markdown 导出不包含模板库。链接选择、预览与文末反向链接从存活正文推导，不新增索引文件或数据目录。接口及交互见 DESIGN 第 24 节，门户 API 声明同步维护。

2026-10-01 在合成隔离实例验证模板冲突检测、非法结构拒绝、源文档彻底删除，以及原生备份/恢复后的模板内容和登记图片；反向链接随文档删除、恢复和知识库回收站状态变化。正式实例只读 roundtrip 检查 320 篇文档、212 个表格无差异；本次没有迁移或批量修改正式正文。

`/opt/yuyan/bin/yuyan` 为内嵌前端的 Linux amd64 程序。config 放本项目的 unit 与 Nginx location，data 放 `yuyan.db` 与 `assets/`（按内容寻址的图片），backups 放快照，docs 与 AGENTS.md 是受控文档副本，releases 留发布历史，current-commit 为程序来源。知识库分组保存在数据库现有 `meta` 表的 `book_groups` JSON 中，随一致性备份保留；旧库无需迁移，未配置时所有知识库均未分组。分组 API 与门户声明保持同步，分组不新增数据目录。

运行身份 yuyan，发布身份 yuyan-deploy；data/backups 为 0700，程序与配置由 root 管理。服务监听 127.0.0.1:18084，经共享 Nginx `/yuyan/` 访问，不增加公网端口。systemd 只允许写 data，内存上限 384 MiB（`GOMEMLIMIT=320MiB`），CPU 100%。图片由程序返回并带一年 `immutable` 缓存，Nginx 不直接读取 data，因此 data 保持 0700。

Nginx location 对 HTML、JSON、JS、CSS 开启 gzip：服务器下行只有约 0.5 MB/s，最长的文档页面约 970 KB，压缩后约 300 KB。Go 把 `.js` 返回为 `text/javascript`，`gzip_types` 必须列出它，见共享的 [Go 程序返回的 JavaScript 没有被 Nginx 压缩](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#go-程序返回的-javascript-没有被-nginx-压缩)。请求体上限 26 MiB（程序单张图片上限 25 MiB）。

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

2026-09-28 批量操作验证：隔离接口检查通过，含中途注入失败后的事务回滚、旧目录选择返回 409、复制内链与初始快照、跨库移动及回收站恢复。Chromium 桌面、200 px 深色侧栏和 WebKit 375 px 手机视口通过；勾选、范围选择、导出、链接、操作对话框、编辑中复制/移动及当前文档删除已验证。模拟保存失败时没有发出批量写请求，草稿与选择均保留。

图片工具扩展使用正文内的裁切参数与 `imageBoard` 节点，不改数据库表或图片存储，不生成破坏性裁切文件，复制、资源计数、备份继续使用原图片。新增节点在 Go 与编辑器同时启用，Markdown 导出以 HTML 保留裁切和画板布局。已写入组合的文档不兼容不认识 `imageBoard` 的旧程序，程序回退需先核对内容格式；不自动删除或降级正文。

Markdown 之外的格式第一批（DESIGN 第 23 节）增加 `textColor`、`image.caption` 与单元格 `backgroundColor`，表头和合并使用已有节点及跨度属性。没有数据库迁移、新 API、媒体目录或备份格式变化，门户资源声明沿用；不改写既有文档。Markdown 无法表示的格式连同所在列表/引用等容器导出为 HTML 并读回。使用文字颜色后，旧程序可能拒绝新标记；图片说明与底色也可能被旧编辑器丢弃，回退前必须确认内容兼容，不自动降级正文。第一批构建、36 项往返、桌面编辑和手机阅读验证通过，详情见 DESIGN 23.3。

颜色工具优化（DESIGN 23.4）以 `highlight.color` 保存文字背景色，以 `textColor.gradient` 保存固定渐变名并保留纯色回退值；默认高亮格式不变。彩色高亮与渐变随 HTML 导出读回，旧编辑器可能丢弃新增属性。最近自定义颜色和上次使用颜色只存于浏览器的 `yuyan:colors`，清除浏览器数据会重置偏好，不影响已保存的文档。此改动不涉及数据迁移或门户声明。45 项颜色往返检查、原第一批 36 项检查、桌面交互与 Chromium/WebKit 375×667 触屏和浅深色阅读通过；顶部工具栏与正文对齐，色板保持在窄屏范围内。

格式刷（DESIGN 23.5）复用已有文字标记、标题和段落对齐；采样及连续模式仅为编辑器临时状态，不写入正文或浏览器存储。单次应用沿用正文 revision 检测、自动保存与独立撤销，无 schema、数据库、API、媒体或门户声明变化。桌面实际拖选、表格列选择、混合内容、空段落、撤销/重做、保存重开与 WebKit 375×667 触屏验证通过。

裁切放大预览与拖动切分线使用现有几何参数，无格式或数据库迁移。2026-09-28 在 Chromium、WebKit 桌面及 375×667 手机视口验证：用颜色分区合成图核对预览实际像素，同源不同裁切、组合图片、未裁切图片和竖长图切换正确；缩小窗口至 375×320 仍按比例适配。左右/上下切分线拖动、滑块同步、多线边界限制、均分、指针取消、已有裁切上的互补切分、相邻代码保留和撤销通过；手机长图弹窗可滚动至确认按钮。原有 210 项几何检查通过，首次加载脚本约 119.5 KiB gzip。

弹窗曾触发代码块清空：Vue 节点视图把脱离页面的 `contentDOM` 交给 ProseMirror，弹窗隐藏背景无障碍内容时，祖先 DOM 重解析误读为空正文，随后裁切因文档已变而中止。代码块与图片画板现使用统一托管视图，内容只通过文档事务更新。2026-09-28 已在 Chromium、WebKit 桌面与 375×667 视口复现修复前故障，并验证修复后的裁切、切分、批量参数、画板、快捷键弹窗、祖先属性重解析、代码输入/撤销及保存重开。已保存的受损内容从历史版本定位恢复；恢复真实文档另行确认，并按 revision 检测避免覆盖新的编辑。

2026-09-28 图片工具验证：隔离实例通过裁切、互补切分、四种范围的批量参数、组合拖动/尺寸/缩放/排列/图层、取消、撤销及保存阅读检查；混合正文、列表、引用、表格中的组合保持相邻内容，链接在图层调整与解除组合后保留。合成文档通过 Go/Tiptap 渲染一致性、Markdown 往返以及 210 组互补切分几何检查，含边缘极窄裁切；大幅缩小画板后可恢复超出部分，整体缩放到上限保持比例，替换图片清除旧裁切并使用新原图尺寸。Chromium 桌面和 WebKit 375×667 阅读/裁切通过；正式实例只读 roundtrip 检查 318 篇文档、185 个表格，无差异。首次加载脚本约 118.4 KiB gzip，图片工具留在编辑器分块。验证材料仅存在本机 `.local`。

## 正式导入

导入只做一次，目标必须是空实例；工具在开发电脑上运行。公网已要求设备 Cookie，现有命令行工具使用受信 SSH 隧道：先在另一个终端运行 `ssh -N -L 127.0.0.1:18199:127.0.0.1:18084 ali`，确认本地端口空闲。直接后端没有 /yuyan/ 前缀；通过隧道的导入仍需单独确认真实数据写入。

```sh
npm --prefix web run import -- --source <笔记仓库副本> --server http://127.0.0.1:18199/ \
  --overrides .local/import-overrides.json --report .local/import-prod.md --dry
# 去掉 --dry 正式导入，完成后检查每篇文档都能被编辑器原样接受：
npm --prefix web run roundtrip -- --server http://127.0.0.1:18199/
```

`roundtrip` 只读取服务器。它检查每篇文档能被编辑器 schema 原样接受，并且编辑表格时不会调整现有列宽或列默认对齐；表头与合并结构原样保留（见 DESIGN.md 第 23 节）。修改编辑器配置后，发布前对线上实例运行一次；2026-10-01 Esc 选区交互调整后核对：320 篇文档、214 个表格全部通过。

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

每篇改动的文档先保存一个版本再写入，写入时核对 revision；重复运行不会再改动。单篇文档要撤回时，在它的历史里恢复迁移前的版本。2026-09-27 已对正式实例运行，62 篇文档中的 313 个全部转换（结果见 DESIGN.md 第 16 节），以后不需要再运行：Markdown 导入会直接把 `[!code]` 转为代码块。

## 存量加粗修复

`migrate-strong` 修复原始 Markdown 中因标点边界而漏识别或配对错位的加粗。它不重新导入整篇文档，也不在阅读或编辑时扫描星号。必须取得当初导入提交的 Markdown，并按数据库只读查询得到的 `docs.source_path` 对应到文档 ID，放入私有目录，文件名为 `<id>.md`；不要使用修复后从 Yuyan 导出的 Markdown 作为原始来源。正文、预览报告和原始笔记只放 `.local` 或其他不受 Git 跟踪的位置。

```sh
# 通过受信 SSH 隧道访问实例。生成预览只有 GET 请求，报告必须写到新文件。
npm --prefix web run migrate-strong -- --server http://127.0.0.1:18199/ \
  --source-dir "$PWD/.local/strong-source" --preview "$PWD/.local/strong-preview.json"
# 审阅报告并取得真实数据修改授权后，先创建应用一致性备份，再应用同一份报告。
npm --prefix web run migrate-strong -- --server http://127.0.0.1:18199/ \
  --apply "$PWD/.local/strong-preview.json"
```

预览记录每个段落修改前后的 JSON、文档 revision 和内容哈希。写入前先核对全部文档，任一篇在预览后发生变化就停止，重新生成预览；每篇先保存历史快照，再通过带 `baseRevision` 的正常保存 API 写入。写入途中遇到冲突立即停止，已成功的文档可在历史记录中恢复；重新生成预览不会再次改动已修复的段落。只修改配对星号与 bold，无法仅作这些修改、与现存内容不一致或同文档中转义后无法区分的段落会跳过。

2026-09-28：解析、导出再导入的 30 项针对性检查通过；Chromium/WebKit 的粘贴、保存、重开和桌面/375 px 阅读通过，隔离实例验证历史快照与 revision 冲突保护。用户确认后已按预览修复正式实例的 47 篇、392 段，8 段未满足自动修复条件而保留原样。执行前已创建 `before-strong-repair` 一致性备份；逐篇核对修复后的正文与预览完全一致，修复前的内容均保留在历史快照中，未遇到 revision 冲突。修复后只读 roundtrip：318 篇文档、185 个表格全部通过；阅读页 HTML 的加粗显示已核对。

## 导出

导出工具在开发电脑上运行，把全部知识库导出为 Obsidian 可以直接打开的文件夹（Markdown 表达不了的内容写成 HTML，例如设置了列宽行高的表格，见 DESIGN.md 第 18 节）：每个知识库一个文件夹，分组是文件夹，文档是 Markdown 文件，有子文档的文档是同名的 Markdown 文件加同名文件夹；图片放在根目录的 `attachments/`，用相对路径引用。只读取服务器，不做任何修改。先建立上文的受信 SSH 隧道，再使用回环地址。

```sh
npm --prefix web run export -- --server http://127.0.0.1:18199/ --dry          # 只转换和检查，不写文件
npm --prefix web run export -- --server http://127.0.0.1:18199/ --out ~/YuyanExport
```

目标文件夹必须是新的、空的，或者是之前的导出结果。再次导出到同一文件夹时会刷新 Markdown，只下载缺少或校验不符的图片，并删除上次导出而本次已不存在的文件；导出之外的文件不会被改动，因此中断后重新运行即可继续。`.yuyan-export/` 里是清单和报告，报告列出下载失败的图片、指向回收站中文档的链接，以及因含有非法字符或同级重名而改过名的文件。全部图片约 340 MB，按服务器约 0.5 MB/s 的下行速度约需 12 分钟；2026-09-26 对正式实例演练，315 篇文档全部转换成功，1,511 张图片都存在。

`npm --prefix web run seed -- --server <本地实例>/yuyan/` 向空的本地实例写入合成示例数据，用于试用界面和导出；它拒绝写入已有知识库的实例。

## 备份与恢复

每天 Asia/Shanghai 04:00 加 0–5 分钟随机延迟，保留 14 份 daily。备份 unit 的可写目录必须是整个 /opt/yuyan，原因见共享的 [systemd 沙箱下照片硬链接备份失败](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#systemd-沙箱下照片硬链接备份失败)。备份包含 SQLite 一致性快照（`VACUUM INTO`）、图片硬链接和 SHA-256 清单。before-deploy / manual 不自动轮换；2026-09-27 已另取包含本项目数据库与全部已登记图片的全应用归档，下载到维护电脑并校验，见 [共享备份说明](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/current-state.md#手工数据归档)。当前没有自动异机同步；需要可供 Obsidian 使用的内容副本时，使用上节的导出工具。

```sh
systemctl status yuyan-backup.timer
systemctl start yuyan-backup.service
journalctl -u yuyan-backup.service -n 50 --no-pager
runuser -u yuyan -- /opt/yuyan/bin/yuyan backup --data /opt/yuyan/data --out /opt/yuyan/backups/manual-UNIQUE
```

备份目标目录必须不存在。备份里的图片是硬链接，与正式图片共用同一份数据，不能原地修改。只有带完整 manifest.json 的目录才可恢复。

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
