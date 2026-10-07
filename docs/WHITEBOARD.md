# 可编辑画板

Excalidraw 方案已确认并实现（2026-10-07）。首版包含文档内编辑、不可变保存、阅读预览、导出重导、技术图模板和 Agent 生成入口。既有 MySQL 图片的逐图重绘属于后续内容任务，不随本次平台发布自动执行。

## 使用与范围

编辑正文时通过插入菜单或 `/画板` 打开画板，添加形状、文字、绑定箭头或图片，点击“应用”插入。再次编辑从预览上打开；宽度、对齐和说明在正文控件调整。支持空白、数据页、B+ 树、索引扫描、事务时间线五种起点。技术图默认规整线条、实色填充和普通字体，也可使用引擎的其他绘制样式。

引擎固定为 `@excalidraw/excalidraw 0.18.1`，React 通过独立挂载点接入 Vue 弹窗。使用公开 API 和原生元素，不维护内核分支。形状、连线绑定、分组、对齐、图层、缩放、平移和画板内部撤销由引擎管理；Yuyan 管理文档、素材、权限和历史。数据库模板是原生元素组合，不是自定义业务节点。新增模板和程序化布局无需改引擎；字段端口、任意新元素渲染或多人协作不属于首版契约。

| 资料内容 | 表达方式 |
| --- | --- |
| 说明、SQL、规则表格 | 原生段落、代码块、表格 |
| 可由文本描述和自动布局的流程、时序 | Mermaid |
| 依赖空间关系的页、树、索引扫描、架构示意 | `drawing` 可编辑画板 |
| 软件界面、照片、真实执行截图 | 图片；只需拼接/裁切时用既有 `imageBoard` |

画板不会自动把截图矢量化。图片进入画板后仍占图片空间；迁移前先提取说明文字、表格和代码，再重绘需要空间关系的图形。

## 文档与编辑事务

`drawing` 是独立原子块，可进入正文及允许块内容的容器。节点只有不可变包引用与阅读属性，不把完整场景复制到每次正文修订中：

| 属性 | 契约 |
| --- | --- |
| `src`、`version` | `/drawings/<32位内容ID>`、`1` |
| `width`、`blockAlign`、`caption` | 100–2400，首建取预览宽度且不超过 800；left/center/right，默认 center；说明文字 |
| `text` | 从场景文本派生，用于检索与字符统计；不能手填另一份内容 |
| `previewWidth`、`previewHeight`、`previewMime` | 服务端校验的预览尺寸与类型 |

“应用”先冻结场景，生成预览并发布完整包，再检查原节点/插入位置仍有效，以一次正文事务写回。异步处理中停止画板输入，失败保留弹窗和草稿；取消保留原正文。图内撤销由引擎管理，应用后正文一次撤销恢复原包。显示宽度、说明改变不创建新包；复制共享原包，编辑一处创建新包并只替换该处。

草稿用 shallowRef 保留普通数据，避免 Vue 代理进入引擎后无法冻结导出。草稿放本机 IndexedDB，按实例、文档、当前 revision、位置和原包区分，保留未应用的元素及图片。持久化时读取最新 revision，避免正文自动保存后草稿键过期；同一次打开产生的旧键在应用/取消时清除。重新打开匹配的画板时可恢复，网络失败不删除草稿。浏览器清理数据或强制终止前尚未写入的变动不保证恢复。

普通 Tab / Shift+Tab 不切换控件焦点，取消焦点装饰；IME 和组合键继续交给编辑器。弹窗 Esc 不触发正文双 Esc 保存退出。阅读页只加载静态预览，点击沿用图片放大；打开编辑时才加载 React 和画板引擎。

## 包格式、预览与校验

包格式为 `format: yuyan-drawing`、`version: 1`、`engine: excalidraw`、`engineVersion: 0.18.1`，包含：

- `scene.elements`：未删除的引擎原生元素；`scene.appState` 只存 `viewBackgroundColor`。
- `files`：引擎 fileId 到 `{src: /assets/<ID>.<ext>, mimeType}` 的映射，素材必须存在、类型一致且被使用；不嵌套画板包。
- `preview`：一份 SVG 字符串或 PNG Base64，加 MIME、实际宽高。PNG Base64 是预览本身；场景图片始终引用去重素材。
- `text`、`sceneHash`：服务端从文本元素和规范化场景/素材映射计算，不信任客户端派生值。哈希不证明预览与场景视觉一致；应用使用同一冻结场景生成，验收仍需看图。

普通字体、无位图场景使用 SVG。含位图或特殊字体时保存最长边不超过 2400 的 PNG，避免字体回退或独立 SVG 外部图片加载差异。SVG 不内嵌场景、字体、样式和位图；通过 XML 白名单限制元素/属性，仅允许内部片段引用，拒绝脚本、事件、外链、DTD、foreignObject 和不一致的根宽高/viewBox。预览作为受认证图片响应，带 `default-src 'none'; sandbox`，不插入正文 HTML。

请求及规范化后的包均限 12 MiB，1–10000 元素，坐标和几何绝对值最多 1e6；点数组逐点校验。预览边最多 16384，PNG 最多 1600 万像素且声明尺寸须匹配实际头部。服务端校验结构与边界，不是完整的 Excalidraw 几何求解器。网页嵌入、外链动作和自定义应用数据不作为首版持久化内容。

预览导出显式使用 `exportScale: 1`，不继承 Excalidraw 按 `devicePixelRatio` 推导的默认倍率，保证 Retina 等高分屏上的 SVG 宽高与 viewBox 一致。SVG 用 XMLSerializer 序列化，避免 outerHTML 把不换行空格变成 XML 不支持的 `&nbsp;`；序列化前将引擎误带 SVG 命名空间的 frame `clip-path` 还原为普通呈现属性。独立 SVG 下载复用该序列化流程。修改导出时同时覆盖 1/2/3 倍像素密度，窄窗口本身不能代表高分屏。

引擎/字体资源随 Go 程序发布，无服务器 Node/浏览器运行时，无默认字体 CDN。依赖覆盖固定在 `web/package.json`；2026-10-07 锁文件审计为 0 项告警。第三方许可随 `web/licenses/excalidraw/` 打包；字体版权以具体字体/上游声明为准，不把引擎 MIT 套到全部字体。

## API 与生命周期

| 路由 | 行为 |
| --- | --- |
| `POST /api/drawings` | 校验并发布包，201 返回可直接插入的完整 drawing 节点 |
| `GET /api/drawings/{id}` | 读取当前受支持的场景包 |
| `GET /drawings/{id}/preview` | 受认证预览；独立校验预览，不依赖场景引擎版本 |
| `GET /drawings/{id}/file` | 下载精确原始包字节，保持内容寻址哈希 |

复用 `assets` 表和目录，包为 `.bin`，MIME 为 `application/vnd.yuyan.drawing+json`，无数据库迁移。不能用普通附件上传绕过包和依赖校验。发布与保留图片依赖处于同一事务和目录共享锁；正文/模板写入时再次核对包、派生属性与图片。

正文（含回收站）、历史、模板/片段以及媒体链接都保护包。GC 展开包内图片引用，未引用包在一小时宽限期内也保护图片；包回收后图片才开始自己的宽限期。无法解析的登记包使本轮 GC 停止并报告，不能猜测依赖后删除。v2 原生备份覆盖包与全部登记图片，既有备份硬链接不因源素材回收损坏。

`GET /api/meta` 公布 `features: ["drawing-v1"]`。保存/取消编辑含画板的当前文档，要求 `X-Yuyan-Features: drawing-v1`，拒绝旧标签页重存导致的未知节点丢失；新网页和 yuyan-doc 自动携带。revision 冲突检查仍独立执行。模板正文不可原地替换，复制/历史恢复直接保留完整服务端节点。

未知包/引擎版本禁止编辑和重新发布；其预览在独立安全校验通过时仍可读取，原包仍可下载。未知包的 GC 会保守停止，需要升级到理解该版本的程序。不能回退到完全不认识 drawing 的旧程序编辑已有画板资料；无 SQLite 迁移不等于正文格式向后兼容。

## 导出与 Agent

网页知识库导出、项目 CLI 全库导出及 yuyan-doc 单篇导出保留画板包、单份预览和所需图片。Markdown 用含预览/说明/源链接的 HTML figure 回退；包文件 `<ID>.yuyan.json`、预览 `<ID>.svg|png` 与图片放在同一 attachments 目录。完整文件夹可由项目导入工具导入空实例，先校验图片哈希、重新上传依赖与包，再保留节点宽度/对齐/说明。只复制一篇 Markdown 不能获得独立可编辑画板；缺包时导入报错，不静默丢图。

画板弹窗可导入 `.excalidraw`，下载独立 `.excalidraw`/SVG/PNG；独立文件按格式需要临时嵌入图片/字体，区别于服务端长期存储。

Agent 使用 `yuyan-doc drawing --input spec.json --out NEW_DIRECTORY`：输入 `template` 或 `elements`（二选一）、可选背景和图片数据，经本机隔离实例和同一浏览器适配层生成包与预览。只生成本地材料，不连接生产。先 `preview-setup` 准备已提交源码的本机程序；审阅后单独 `upload --kind drawing`，再用 revision 保护的 `create/edit` 插入返回节点。生成 API/工具入口为 `web/src/drawing/tool.ts`，技能脚本仅放 agent-config。

## 实施状态与后续

P0 引擎验证、P1 文档/存储集成、P2 数据库模板与 Agent 入口均已实现。针对性验证材料使用隔离合成数据，保留在 `.local`，不新增永久回归套件；验证结果和发布记录见 OPERATIONS。

P3 逐图迁移仍待单独执行。先核对标签、数字、连线和图例，再局部替换真实文档；保留原生文字/SQL/表格。空间评估计入实际包（已含预览）、去重图片、历史和备份，单列传输 gzip；尚未完成原图逐一重绘对比，因此不承诺节省比例。

后续可沿公开 API 增加图形模板、布局辅助、元素选择工具及导入器；升级引擎前以代表性旧包验证编辑和导出，按需增加版本适配，不直接重写全部存量包。

官方依据：[嵌入与字体托管](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation)、[场景 API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api)、[元素生成](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton)、[导出](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export)、[固定版本源码](https://github.com/excalidraw/excalidraw/tree/v0.18.1)。
