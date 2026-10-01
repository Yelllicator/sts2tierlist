# 尖塔排表

杀戮尖塔 2 卡牌排表工具。支持七套独立模板、双语卡面、版本切换、PNG 导出、JSON 方案备份，以及浏览器内截图识别和 OCR。

新工作区默认使用 0.111.0，各评级为空。规则是固定快照，不会自动跟踪游戏更新。

## 使用

打开本仓的 GitHub Pages 网站。排表保存在当前浏览器来源的 localStorage / IndexedDB；切换来源或设备时，通过方案库导出和导入 JSON。没有云同步。截图识别在浏览器 Worker 内完成，不上传截图。

## 检查与部署

需要 Node.js 18 或以上版本；运行 `npm test` 检查资源、公开内容、默认状态和旧方案兼容。无需安装 npm 依赖或构建卡图。

在仓库 Settings → Pages 将 Source 设为 GitHub Actions。main 分支更新后，工作流检查通过才会发布 dist；也可在 Actions 手动运行 main 分支的 Deploy GitHub Pages。

本仓是可独立发布的静态快照。来源、游戏资产归属与 OCR 许可证见 [SOURCES.md](SOURCES.md)。

## 说明

这是非官方爱好者工具，与 Mega Crit 无隶属关系。游戏原画与文本属于相应权利人。公开此项目不代表这些游戏资产已转为自由许可。
