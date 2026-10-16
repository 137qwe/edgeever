# 分享图片的可选字体

[English](note-image-fonts.md)

分享图片字体选择器包含乔木设计师基础包的全部五款字体，另保留霞鹜文楷、朱雀仿宋和思源黑体 Heavy。字体资源固定版本，远程按需下载。Web、桌面、Android 和 iOS 的安装资源均不增加这些字体的二进制文件；选择器、加载器和许可声明会增加少量应用代码。

| 字体 | 固定的软件包和样式清单 |
| --- | --- |
| 得意黑 | `@chinese-fonts/dyh@3.0.0/dist/SmileySans-Oblique/result.css` |
| 霞鹜文楷 | `@chinese-fonts/lxgwwenkai@3.0.0/dist/LXGWWenKai-Regular/result.css` |
| 朱雀仿宋 | `@chinese-fonts/zqfs@3.0.0/dist/ZhuqueFangsong-Regular/result.css` |
| 思源黑体 Heavy | `@fontsource/noto-sans-sc@5.3.1/900.css` |
| 普惠体 Regular · 推荐 | `@fontpkg/alibaba-pu-hui-ti-3-0@3.1.2/AlibabaPuHuiTi-3-55-Regular.ttf` |
| 普惠体 Heavy · 推荐 | `@fontpkg/alibaba-pu-hui-ti-3-0@3.1.2/AlibabaPuHuiTi-3-105-Heavy.ttf` |
| 优设标题黑 · 推荐 | `@fontpkg/you-she-biao-ti-hei@1.0.0/优设标题黑.ttf` |
| 阿里妈妈数黑体 · 推荐 | `@fontpkg/alimama-shu-hei-ti@1.0.5/AlimamaShuHeiTi-Bold.ttf` |

得意黑也是五款推荐包的成员。新增四款推荐字体使用未经修改的原始文件，固定字节长度与 SHA-256 摘要；支持 Web Crypto 时校验 SHA-256，所有环境均检查长度与容器。四个文件分别约 8.53 MB、2.54 MB、1.41 MB、1.36 MB，不转换、不拆分。选中字体或其预览行进入可见区域时，才下载对应原文件，安装应用时不下载。展开并滚动列表可能下载多款完整字体。

字体清单定义在 `packages/shared/src/note-image-remote-fonts.ts`，分片来自[中文网字计划](https://github.com/KonghaYao/chinese-free-web-font-storage)和 [Fontsource](https://fontsource.org/fonts/noto-sans-sc)。每次请求先使用 jsDelivr，失败后尝试 unpkg。对于使用 CSS 分片的字体，只接受固定软件包目录内的 WOFF2 字体描述，不将远程样式直接插入页面。

对于使用 CSS 分片的字体，选择后才请求其样式清单。渲染器根据卡片文字匹配 Unicode 范围，仅下载命中的分片，不下载整个字体家族。字符匹配在本地进行，字体请求不会发送笔记正文。清单和字体数据保存在独立、可丢弃的 IndexedDB 缓存 `edgeever-share-font-cache` 中；重复下载会合并，失败请求可以重试，存储不可用时仍可联网渲染。生成图片前会等待字体加载完成。

离线复用需要清单和相关文字分片仍在缓存中，新增字符可能需要另行下载。浏览器回收存储、WebView 限制或清理站点数据可能使离线缓存失效；可用时仍会使用 HTTP 缓存和会话内请求复用。这些字体不改变编辑器排版，也不替换现有主题附带的字体。

原先四款可选字体采用 SIL OFL 1.1；本次新增的四款推荐字体保留原厂商授权及内嵌声明，不按 OFL 字体处理。版权声明和完整许可保留在 `packages/shared/src/note-image-remote-font-notices.ts`，并包含在 OFL 字体的生成 CSS 中，原始文件字体则在 CSS 中保留来源说明。字体轮廓和字体文件名称未经修改，CSS 家族别名用于隔离分享图片与编辑器字体。

本次检查包括共享单元测试、Web 与移动端类型检查、Web 构建、iOS 编辑器类型检查与构建，以及 Chrome 中联网导出和刷新页面后阻断字体 CDN 的导出验证。Android USB 真机与 iOS 真机仍需单独验收，桌面浏览器结果不代表原生平台已通过验收。

Web 字体选择器中的可见名称以及当前选中值使用对应字体显示，隐藏行不会启动预览下载。名称预览与图片导出共用已加载字体和持久资源缓存，不额外生成内嵌 base64 样式，也不加载纸张纹理。预览失败时保留可读的系统字体名称，不影响选择。
