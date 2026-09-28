# 安装与运行

公网入口使用可信 IP 证书的 HTTPS，原有 /yuyan/ 路径保持。公网 HTTP 返回 308；API 客户端直接使用 HTTPS。Nginx 覆盖 `X-Forwarded-Proto`，公网入口统一校验设备凭据。证书、续期、回退和整机验收见 [共享 HTTPS 运维](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/https.md)（服务器副本 /opt/server-context/references/https.md）。本项目的后端与发布检查保留本机 HTTP，127.0.0.1:80 的代理检查入口不能从公网访问。公网已接入 ServerPortal 统一设备认证：先在 /portal/login 输入口令授权设备，随后使用同源 Secure/HttpOnly Cookie 访问；未授权 API 返回 401。本机发布检查与服务间调用保留。

操作 ali 前加载 server-operations 并显式读取 `/opt/AGENTS.md`。公开仓库不写正式公网地址；通过受信 SSH 别名取得现场信息。

## 布局

`/opt/yuyan/bin/yuyan` 为内嵌前端的 Linux amd64 程序。config 放本项目的 unit 与 Nginx location，data 放 `yuyan.db` 与 `assets/`（按内容寻址的图片），backups 放快照，docs 与 AGENTS.md 是受控文档副本，releases 留发布历史，current-commit 为程序来源。

运行身份 yuyan，发布身份 yuyan-deploy；data/backups 为 0700，程序与配置由 root 管理。服务监听 127.0.0.1:18084，经共享 Nginx `/yuyan/` 访问，不增加公网端口。systemd 只允许写 data，内存上限 384 MiB（`GOMEMLIMIT=320MiB`），CPU 100%。图片由程序返回并带一年 `immutable` 缓存，Nginx 不直接读取 data，因此 data 保持 0700。

Nginx location 对 HTML、JSON、JS、CSS 开启 gzip：服务器下行只有约 0.5 MB/s，最长的文档页面约 970 KB，压缩后约 300 KB。Go 把 `.js` 返回为 `text/javascript`，`gzip_types` 必须列出它，见共享的 [Go 程序返回的 JavaScript 没有被 Nginx 压缩](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#go-程序返回的-javascript-没有被-nginx-压缩)。请求体上限 26 MiB（程序单张图片上限 25 MiB）。

当前公网使用 HTTPS 与统一设备认证，授权设备可以查看和修改内容；版本历史、回收站和每日备份用于恢复。

发布后旧标签页的动态模块 404 排查见共享 [发布后旧标签页的动态模块加载失败](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#发布后旧标签页的动态模块加载失败)。本应用的构建清单位于 `/static/manifest.json`，页面外壳使用 `no-cache`，带哈希的脚本长期缓存。界面提供全局刷新入口；编辑时先保存，保存冲突或失败不会刷新。浏览器回归通过实际拦截 Mermaid 核心分块、图表类型分块和编辑页分块的 404，核对桌面与 375 px 提示、源码和预览保留、保存期间继续输入以及冲突草稿。

## 首次安装

先核对端口、身份、目录与现有全部服务健康。服务器不需要新的系统软件。

```sh
# 取同一提交成功的 CI artifact yuyan-linux，核对 SHA-256 后，与已提交的 deploy/ 一起上传到独立暂存目录。
bash deploy/install.sh /path/to/yuyan-linux-amd64
ln -s /opt/yuyan/config/nginx-location.conf /etc/nginx/app-locations/yuyan.conf
nginx -t
systemctl reload nginx
bash deploy/setup-ci.sh /path/to/yuyan-deploy.pub
```

install 拒绝覆盖现有目录或身份，显式初始化正式空库，开启服务与备份 timer，并通过 unit 取得首份备份。setup-ci 建立只能执行 `deploy`、`portal-check` 和 `portal` 三种固定的 commit/SHA-256 命令 的 yuyan-deploy，sudo 仅允许 root 管理的发布脚本。私钥只放入 GitHub production 环境的 SSH_PRIVATE_KEY，SSH_KNOWN_HOSTS 取自受信连接并与本机记录比对指纹；传递后删除本地私钥。安装后核对五个应用的直连、代理与深链接。

## 发布与回退

推送 main 后，CI and deploy 的 verify 作业构建并测试，deploy 作业把同一产物 gzip 压缩后经受限 SSH 身份交给 `/opt/yuyan/bin/deploy-release.sh`。纯文档提交加 `[skip ci]`。

发布脚本上传时限 600 秒（GitHub runner 到服务器的跨境上传有时只有几十 KB/s），解压后校验大小与 SHA-256；随后停服、做 before-deploy 备份、以运行身份执行候选 `check`、原子替换并做健康检查（直连 `/healthz` 与代理后的首页资源链接）。失败时恢复旧程序，不回滚数据库。`bash deploy/test-release.sh` 在 CI 中用模拟服务覆盖这些失败分支。

上传超时（exit code 124，最新发布目录 result 为 failed 且没有 metadata）按共享的 [GitHub 上传过慢时的备用发布](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#github-上传过慢时的备用发布) 处理。Yuyan 的参数：产物取自失败的 CI and deploy run 本身，artifact `yuyan-linux`（文件 `yuyan-linux-amd64`）；上传时必须压缩：`gzip -9 -c yuyan-linux-amd64 | ssh ali '/opt/yuyan/bin/deploy-release.sh <commit> <sha256>'`，SHA-256 为未压缩程序的值；验收 `/yuyan/healthz` 与 `/yuyan/`，不写测试数据。

## 本地开发

```sh
npm --prefix web ci
make test
make build
bin/yuyan init --data .local/data
bin/yuyan serve --data .local/data --with-prefix
npm --prefix web run seed -- --server http://127.0.0.1:18084/yuyan/   # 可选：写入合成示例数据
```

本机 zsh 对 goenv 做了延迟加载，`make` 找不到 `go` 时在命令前加 `PATH="$HOME/.goenv/shims:$PATH"`。测试只写 .local；仓库只放合成样例。

`make e2e` 构建程序后，在临时目录启动新实例、写入合成示例数据，再用 Playwright + Chromium 运行 `web/e2e` 中的浏览器测试：首页、目录、回收站，编辑器交互、中文输入法模拟、长文档和编辑后的导出，以及搜索面板、从搜索结果定位、图片占位、版本对比、大纲的位置、收起、折叠和当前节的判定，目录的全部折叠与展开，统一的按钮提示，结构内全选，连按两次 E 进入编辑、连按两次 Esc 保存并回到阅读、全局快捷键面板与左下角外观菜单入口，取消编辑，表格拖动调整宽高与宽表格滚动、菜单滚动提示、按标题折叠、语雀式代码块（标题栏的显示与隐藏、收起与展开、编辑标题）、离开页面时取消图片加载和手机尺寸下的大纲抽屉。首次运行前执行一次 `npx --prefix web playwright install chromium`。CI 中这一步不通过就不发布。

`web/e2e/writing.spec.ts` 覆盖 Esc 单按提示与双按保存、输入和输入法中断、长按忽略、弹层关闭优先、延迟保存和冲突保留草稿；快捷键面板在首页、回收站、阅读页、编辑正文和标题框均可打开，代码块保留行注释。标题升降核对混合选区、H1/H6 整批禁用、保留正文和文字格式、一步撤销与保存；表格不连续选区另有单元测试。列表在阅读/编辑、1360 px/375 px 下检查七层循环、混合嵌套、起始序号、任务复选框与横向溢出。

Tab 回归验证编辑页正文、标题框、工具栏、侧栏、查找框和弹窗都不发生控件焦点跳转；列表缩进/取消缩进、表格前后单元格及末尾新增行、普通/放大代码块缩进仍正常。返回阅读页后恢复 Tab 导航。

阅读与编辑之间的位置衔接测试覆盖桌面点击、375×667 窄屏连按两次 E、异步加载、前面存在折叠章节和长代码块、继续输入不跳动，以及直接打开编辑页和从文首进入。退出编辑覆盖“完成”、无改动直接“取消”、放弃增删块后的修改，以及浏览器返回时展开目标所在的章节、Callout 和长代码；恢复到退出时的位置，不跳回最初的阅读位置或搜索匹配处。

阅读页标题级别在合成文档中核对一至六级标题、没有可折叠内容的标题、鼠标悬停与键盘聚焦、折叠和展开，检查复制文字与标题位置不受标记影响。视觉核对包含 1360 px 桌面、深色主题和 375×667 触屏；窄屏标记与箭头留在原有左侧留白内，不产生横向溢出。

统一选区工具栏测试通过外围格子和真实鼠标拖动选择行列，核对常用格式与对齐仍可使用，并能移除单行、多行、单列、多列及整表。局部单元格只清空内容，单元格文字只删除文字，删除表头后下一行成为表头，最后一行或列可移除整表；撤销恢复原内容和格式。桌面与 375 px 窄屏检查文字、图片移除按钮可见且只作用于选区；另覆盖代码文字、节点和全篇选区。

表格外围操作测试覆盖边框悬停延迟、快速划过不激活、加宽的触发范围与激活后的偏移容差、无外框的小尺寸拖动光标、高亮淡入淡出、外围格子点击与按住滑动选中行列（扩选、缩选、反向、偏离边栏、松开与失焦）、多选后的对齐与移除、键盘选择、分隔点插入列和首尾行、撤销、表头恢复、导出不包含控件，以及外围控件和选区工具栏不重叠。代码块在 1360 px 和 375 px 验证行号常显、逐块换行互不影响、编辑行号与换行对齐、隐藏标题栏后保留换行状态且复制只显示图标。

对齐测试在 1360 px 和 375 px 验证段落与图片独立设置、不影响相邻内容、标题禁用、连续切换、撤销、导出和刷新；表格覆盖单元格、所选行、整列及整表位置之间的独立关系，并检查超过正文宽度的靠右表格仍可滚动。菜单滚动测试在长正文中打开插入菜单，一边移动鼠标一边滚到上下边缘，检查菜单正常滚动且正文位置保持，关闭后正文能继续滚动。格式单元测试和渲染一致性样例覆盖 HTML 导出读回，保留图片与链接路径、段落对齐、表格位置及单元格覆盖。

布局测试覆盖旧标准页偏好失效、宽度菜单移除、有无大纲时正文固定在原宽页收起侧栏的位置，以及侧栏开合和拖动调宽后阅读/编辑正文的坐标与宽度不变。1360 px 桌面窗口和 375 px 手机核对抽屉不挤压正文，点击正文区域、选中当前文档或另一个文档时自动关闭，专注模式仍可打开目录。目录与阅读/编辑大纲的全部折叠和展开共用一个按钮，测试同时核对手动折叠后的功能切换。

长表格滚动测试核对表格仍可见但顶部空间不足、表头滚出视口、再次滚回三种状态：外围边框不向下偏移，行操作条与实际行边界一致且选中正确的行，顶部选择条和插入点分别按自身尺寸隐藏与恢复，悬浮工具栏不遮挡仍可见的插入点，列宽高亮不会穿过固定工具栏。选中超过视口高度的整列后继续滚动，统一选区工具栏仍在可见区域，可直接移除该列并撤销恢复；按住行边栏时滚动页面，选区随指针下的行变化，松开后停止扩选。

代码编辑专项在 `web/e2e/code.spec.ts`：真实按键输入、括号补全、文档撤销与重做、代码与正文之间的焦点和逐层全选、阅读/编辑共享区域折叠、行号拖选与移除、阅读行选区复制、放大视图中的语言选择及移除撤销、块内替换和保存、C++/Go/Python/JSON 结构、固定四空格缩进，以及 375 px 下放大查找。格式化检查 C++、JavaScript、JSON、Python、Go 和 CSS 的输出、一步撤销/重做、保存、语法错误与加载期间继续输入，Go 原始字符串中的 Tab 保持不变；桌面和窄屏检查更多/语言菜单跟随触发按钮、滚出可见区后关闭、滚动和悬停不带动正文。macOS 与 Windows 分别验证 JetBrains 复制行或选区、删除行、移动行、注释、格式化、选中下一个相同词、替换及普通/放大视图中的快捷键说明。

代码行号固定测试在桌面和 375 px 下通过真实横向滚动及滚到最右端，核对长短行的行号位置一致，并能点击选择最后一行；既有代码折叠、行选区复制和自动换行测试同时回归。视觉核对包含单行 Mermaid 源码背景、标题栏切换按钮与边线的位置，以及手机上一篇/下一篇同排和长标题省略。

快捷键面板在桌面和 375 px 下核对分类页签的键盘切换、独立按键帽、内容区滚动时分类和正文位置保持、浅色与深色样式，以及阅读页独立加载的代码块说明。macOS 与 Windows 的说明沿用同一键位表，并核对不同系统的删除行组合。

当前验证集包含浏览器测试、前端单元测试、类型检查、Go 测试与 vet；CI 全部通过后才发布。首屏应用脚本（含静态导入）gzip 后约 115 KB，符合 DESIGN.md 12.3 的预算。代码引擎、语法模块和阅读增强按需加载；格式化 Worker 及各语言的 JS/WASM 仅在首次格式化时下载，首屏不静态引入 CodeMirror 或格式化工具。服务器仍只运行内嵌前端的 Go 程序。

## 正式导入

导入只做一次，目标必须是空实例；工具在开发电脑上运行。公网已要求设备 Cookie，现有命令行工具使用受信 SSH 隧道：先在另一个终端运行 `ssh -N -L 127.0.0.1:18199:127.0.0.1:18084 ali`，确认本地端口空闲。直接后端没有 /yuyan/ 前缀；通过隧道的导入仍需单独确认真实数据写入。

```sh
npm --prefix web run import -- --source <笔记仓库副本> --server http://127.0.0.1:18199/ \
  --overrides .local/import-overrides.json --report .local/import-prod.md --dry
# 去掉 --dry 正式导入，完成后检查每篇文档都能被编辑器原样接受：
npm --prefix web run roundtrip -- --server http://127.0.0.1:18199/
```

`roundtrip` 只读取服务器。它检查每篇文档能被编辑器 schema 原样接受，并且编辑表格时不会调整现有表格的表头或列对齐（编辑器会保持 Markdown 表格的形状，见 DESIGN.md 12.12）。修改编辑器配置后，发布前对线上实例运行一次；2026-09-27 核对：316 篇文档、185 个表格全部通过。

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

`deploy/portal.json` 是本应用资源说明的维护源。CI 使用固定提交的 server-operations 校验器检查，再将同一声明与二进制一同保存为 artifact；发布前执行 `portal-check`，发布后执行 `portal`，通过现有受限 SSH 安装到 `/opt/yuyan/config/portal.json` 并核对采集器实际加载的 SHA-256。`config/portal-source.json` 记录声明来源提交；它与程序的 current-commit 各自表示不同材料的版本。

门户从 `/opt/serverportal/registry.d/yuyan.json` 的受控链接发现本应用，声明成功更新后自动加载，无需重启。首次正常 CI 发布也会建立链接，无需再编辑门户中央应用列表。普通发布可更新本应用的声明，其他 unit/env/Nginx/发布脚本仍由管理员安装。

只改门户名称、目录用途、API 说明等元数据时，在 main 上手动运行 CI and deploy，设置 `portal_only=true`；仍执行验证与声明生效检查，但不替换程序、不停止业务服务、不创建发布前数据快照。源码或数据库行为变更不能使用该选项代替程序发布。

数据根、媒体、备份格式、unit、端口或访问路径变化时，同一提交维护声明及对应文档，更新共享清单并核对资源覆盖。文件、媒体、数据库表和 systemd 状态由门户自动读取；目录用途、API 说明和权限边界须由维护 agent 明确更新。共同协议、失败处置与新应用接入见 [门户维护](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/portal.md)。

门户 /portal/ 已统一保护公网访问，发布脚本通过回环检查应用健康，CI 公网检查预期未授权返回 401。设备授权永久有效至主动撤销，Cookie 经共享 Nginx 随有效请求续期；本应用若新增 add_header，必须保留共享 Set-Cookie 转发，规则及验收见共享门户维护文档。门户备份使用本应用原生一致性快照；真实完整链恢复验收按用户要求暂缓，不因本次维护自动继续下载或恢复。

## 手机桌面图标

门户中的应用名为 `Yuyan`，维护源为 deploy/portal.json；中文产品说明不加入门户展示名称。

源码已补充 /yuyan/static/apple-touch-icon.png 的 180×180 PNG 和共用页面 head 声明，Nginx 规则仅放行它与 favicon.svg 的 GET/HEAD。图形源为 web/public/favicon.svg；维护电脑已有 libvips 时运行 node web/scripts/generate-icons.mjs 重新生成。页面、API 和用户媒体继续使用设备认证。共同原因、部署状态与手机验收见[共享排障记录](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#统一认证后-iphone-桌面图标缺失)。
