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
