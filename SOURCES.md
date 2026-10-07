# 数据与素材来源

卡面由固定规则文本、游戏插画和卡框确定性重建，并非游戏原生截图。规则版本与原画来源分别记录。

| 规则快照 | 固定公开来源 |
| --- | --- |
| 0.103.3（上游资料标注） | [wrrwrr111/sts2](https://github.com/wrrwrr111/sts2/tree/cce41d39303a5e6ac799822ad24fe9da109899e2) |
| 0.107.1 | [ptrlrd/spire-codex](https://github.com/ptrlrd/spire-codex/tree/929b88c04c41dc63563d9eb41d1b4981c1b2f033) 的正式数据 |
| 0.111.0 | [同一固定 Spire Codex 提交](https://github.com/ptrlrd/spire-codex/tree/929b88c04c41dc63563d9eb41d1b4981c1b2f033) 的版本化测试数据 |

旧版多人可用性元数据参照 [adoubt/sts2_source_code 固定提交](https://github.com/adoubt/sts2_source_code/tree/66a7cf4d76dbecf400d0314430411acd01089c6f) 的静态反编译代码；该来源的具体游戏版本未独立确认。

共有插画、古老牌框和 UI 来自既有固定游戏静态资源缓存；不能据此断定所有插画都对应各历史规则版本。旧 Follow Through 使用同 ID 的公开原画；Scare 参照上述 Spire Codex 固定提交；测试版新增 17 个 ID 的插画来自 [flavono123/scare-the-spire 固定提交](https://github.com/flavono123/scare-the-spire/tree/8b93a539c562a92c8a993e99616da58a613b6f26)。

原画、卡框、游戏文本及衍生内容版权归 Mega Crit 等原权利人。上游代码许可证不覆盖游戏资产，本说明不授予游戏资产再分发许可。

## 遗物

遗物双语规则固定到上述 Spire Codex 提交的 data-beta/v0.111.0/{zhs,eng}/relics.json，共 298 件。图标使用来源记录 image_url 所指的 Spire Codex WebP 主图，下载字节独立固定；运行时均为本站本地资源，不热链。规则 Git 提交号不代表图片版本。

上游项目使用 [PolyForm Noncommercial 1.0.0 许可证](https://github.com/ptrlrd/spire-codex/blob/929b88c04c41dc63563d9eb41d1b4981c1b2f033/LICENSE.md)。遗物名称、规则文本和图像属于 Mega Crit；上游源码许可不构成游戏素材的独立再分发授权。

## OCR

OCR 使用固定 Tesseract.js 7.0.0、Tesseract.js-core 7.0.0，以及 eng / chi_sim 1.0.0 语言数据。

- [资源及上游来源说明](dist/vendor/ocr/README.md)
- [逐文件字节数、SHA-256 与公共下载 URL](dist/vendor/ocr/manifest.json)
- [Tesseract.js 许可证](dist/vendor/ocr/licenses/tesseract.js/LICENSE.md)
- [Tesseract.js-core 许可证](dist/vendor/ocr/licenses/tesseract.js-core/LICENSE)
- [语言数据 Apache-2.0 许可](dist/vendor/ocr/licenses/traineddata-APACHE-2.0.txt)
- [Leptonica BSD 许可](dist/vendor/ocr/licenses/leptonica-BSD.txt)

OCR 原包、许可证、包元数据和来源清单均原样保留。语言包元数据注明 MIT；其底层 Tesseract traineddata 的 Apache-2.0 许可也一并保留。
