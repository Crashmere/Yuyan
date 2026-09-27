# 安装与运行

操作 ali 前加载 server-operations 并显式读取 `/opt/AGENTS.md`。公开仓库不写正式公网地址；通过受信 SSH 别名取得现场信息。

## 布局

`/opt/yuyan/bin/yuyan` 为内嵌前端的 Linux amd64 程序。config 放本项目的 unit 与 Nginx location，data 放 `yuyan.db` 与 `assets/`（按内容寻址的图片），backups 放快照，docs 与 AGENTS.md 是受控文档副本，releases 留发布历史，current-commit 为程序来源。

运行身份 yuyan，发布身份 yuyan-deploy；data/backups 为 0700，程序与配置由 root 管理。服务监听 127.0.0.1:18084，经共享 Nginx `/yuyan/` 访问，不增加公网端口。systemd 只允许写 data，内存上限 384 MiB（`GOMEMLIMIT=320MiB`），CPU 100%。图片由程序返回并带一年 `immutable` 缓存，Nginx 不直接读取 data，因此 data 保持 0700。

Nginx location 对 HTML、JSON、JS、CSS 开启 gzip：服务器下行只有约 0.5 MB/s，最长的文档页面约 970 KB，压缩后约 300 KB。Go 把 `.js` 返回为 `text/javascript`，`gzip_types` 必须列出它，见共享的 [Go 程序返回的 JavaScript 没有被 Nginx 压缩](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#go-程序返回的-javascript-没有被-nginx-压缩)。请求体上限 26 MiB（程序单张图片上限 25 MiB）。

本期按用户确认使用 HTTP、无登录，知道地址的人都可以查看和修改内容；版本历史、回收站和每日备份用于恢复。

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

install 拒绝覆盖现有目录或身份，显式初始化正式空库，开启服务与备份 timer，并通过 unit 取得首份备份。setup-ci 建立只能执行 `deploy <commit> <sha256>` 的 yuyan-deploy，sudo 仅允许 root 管理的发布脚本。私钥只放入 GitHub production 环境的 SSH_PRIVATE_KEY，SSH_KNOWN_HOSTS 取自受信连接并与本机记录比对指纹；传递后删除本地私钥。安装后核对五个应用的直连、代理与深链接。

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

`make e2e` 构建程序后，在临时目录启动新实例、写入合成示例数据，再用 Playwright + Chromium 运行 `web/e2e` 中的浏览器测试：首页、目录、回收站，编辑器交互、中文输入法模拟、长文档和编辑后的导出，以及搜索面板、从搜索结果定位、图片占位、版本对比、大纲的位置与隐藏、菜单滚动提示、按标题折叠、语雀式代码块（标题栏、收起与展开、编辑标题）、离开页面时取消图片加载和手机尺寸下的大纲抽屉。首次运行前执行一次 `npx --prefix web playwright install chromium`。CI 中这一步不通过就不发布。

## 正式导入

导入只做一次，目标必须是空实例；工具在开发电脑上运行，通过 HTTP 上传。

```sh
npm --prefix web run import -- --source <笔记仓库副本> --server http://<服务器>/yuyan/ \
  --overrides .local/import-overrides.json --report .local/import-prod.md --dry
# 去掉 --dry 正式导入，完成后检查每篇文档都能被编辑器原样接受：
npm --prefix web run roundtrip -- --server http://<服务器>/yuyan/
```

`roundtrip` 只读取服务器。它检查每篇文档能被编辑器 schema 原样接受，并且编辑表格时不会调整现有表格的表头或列对齐（编辑器会保持 Markdown 表格的形状，见 DESIGN.md 12.12）。修改编辑器配置后，发布前对线上实例运行一次；2026-09-26 D3 发布前的结果：315 篇文档、185 个表格全部通过。

overrides 文件记录需要人工选择的项（同名不同图），不入库。2026-09-26 的正式导入只有一项：`{"images": {"AI记录/Gradle 入门.md|img-001.png": "AI记录/attachments/img-001.png"}}`；本地文件已删除，重新导入空实例时按此重建。

## 代码 Callout 迁移

`migrate-code` 把 `[!code]` Callout 改回带标题栏的代码块（规则见 DESIGN.md 第 16 节）。它在开发电脑上运行，通过 SSH 隧道写入正式实例；需要先发布认识代码块标题的程序。它会改写真实文档，所以先做一次手动备份：

```sh
ssh ali 'runuser -u yuyan -- /opt/yuyan/bin/yuyan backup --data /opt/yuyan/data --out /opt/yuyan/backups/manual-$(date +%Y%m%d-%H%M%S)'
ssh -N -L 18199:127.0.0.1:18084 ali &                                          # 隧道，完成后结束
npm --prefix web run migrate-code -- --server http://127.0.0.1:18199/yuyan/ --dry   # 只报告
npm --prefix web run migrate-code -- --server http://127.0.0.1:18199/yuyan/
npm --prefix web run roundtrip -- --server http://127.0.0.1:18199/yuyan/
```

每篇改动的文档先保存一个版本再写入，写入时核对 revision；重复运行不会再改动。单篇文档要撤回时，在它的历史里恢复迁移前的版本。

## 导出

导出工具在开发电脑上运行，把全部知识库导出为 Obsidian 可以直接打开的文件夹：每个知识库一个文件夹，分组是文件夹，文档是 Markdown 文件，有子文档的文档是同名的 Markdown 文件加同名文件夹；图片放在根目录的 `attachments/`，用相对路径引用。只读取服务器，不做任何修改。

```sh
npm --prefix web run export -- --server http://<服务器>/yuyan/ --dry          # 只转换和检查，不写文件
npm --prefix web run export -- --server http://<服务器>/yuyan/ --out ~/YuyanExport
```

目标文件夹必须是新的、空的，或者是之前的导出结果。再次导出到同一文件夹时会刷新 Markdown，只下载缺少或校验不符的图片，并删除上次导出而本次已不存在的文件；导出之外的文件不会被改动，因此中断后重新运行即可继续。`.yuyan-export/` 里是清单和报告，报告列出下载失败的图片、指向回收站中文档的链接，以及因含有非法字符或同级重名而改过名的文件。全部图片约 340 MB，按服务器约 0.5 MB/s 的下行速度约需 12 分钟；2026-09-26 对正式实例演练，315 篇文档全部转换成功，1,511 张图片都存在。

`npm --prefix web run seed -- --server <本地实例>/yuyan/` 向空的本地实例写入合成示例数据，用于试用界面和导出；它拒绝写入已有知识库的实例。

## 备份与恢复

每天 Asia/Shanghai 04:00 加 0–5 分钟随机延迟，保留 14 份 daily。备份 unit 的可写目录必须是整个 /opt/yuyan，原因见共享的 [systemd 沙箱下照片硬链接备份失败](https://github.com/Crashmere/agent-config/blob/main/skills/server-operations/references/common-issues.md#systemd-沙箱下照片硬链接备份失败)。备份包含 SQLite 一致性快照（`VACUUM INTO`）、图片硬链接和 SHA-256 清单。before-deploy / manual 不自动轮换；按用户决定暂不做异机备份，需要本地副本时用导出工具（见上节）。

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
