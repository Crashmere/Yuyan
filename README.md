# Yuyan（语燕）

一个人使用的网页知识库：知识库与文档树、所见即所得编辑、快速的阅读页。名称模仿语雀。

- 后端：Go + SQLite，单个可执行文件。
- 前端：Vue 3 + Tiptap 3，构建后嵌入程序。
- 正文以 Tiptap 文档 JSON 保存，可以导出为 Markdown。

## 本地运行

```sh
make dev   # 构建前端与程序，首次运行时在 .local/data 建库，然后启动
```

打开 <http://127.0.0.1:18084/yuyan/>。设计与决策见 [docs/DESIGN.md](docs/DESIGN.md)。
