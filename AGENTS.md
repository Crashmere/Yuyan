# Yuyan 维护入口

先读 [docs/README.md](docs/README.md)，再按任务读取设计与验证文档。

- Yuyan（语燕）是用户一人使用的网页知识库，功能参照语雀网页版中适合单人使用的部分：知识库与文档树、所见即所得编辑、服务端渲染的阅读页。
- Go 内嵌 Vue + Tiptap 前端 + SQLite。正文以 Tiptap 文档 JSON 保存并记录格式版本号；Markdown 只用于导入和导出。启动缺库必须报错，只有 `init` 会建库。
- 编辑器扩展（`web/src/schema`）与 Go 渲染器（`internal/render`）必须一一对应；新增或修改节点时同时更新两端，并运行 `make parity` 刷新一致性快照。
- 文档写入使用 revision 检测冲突，不能静默覆盖；图片按内容寻址且不可覆盖。
- 本期按用户确认使用 HTTP、无登录。所有写接口集中在 `/api/` 下同一个中间件入口，以后在那里接入登录。
- 修改后运行 `make test`；前端改动还要 `npm --prefix web run build`。测试使用 `.local` 隔离数据，仓库只放合成样例，不提交真实笔记。
- 服务器上不安装 Node：前端在 CI 构建后嵌入程序。部署先读 server-operations，并显式读取 `ssh ali 'cat /opt/AGENTS.md'`；哪些事直接做、哪些先确认，只看 server-operations SKILL.md 的授权表。
- 仓库 public，不提交数据库、图片、备份、凭据或服务器公网地址。
