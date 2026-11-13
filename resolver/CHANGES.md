# Resolver-Web v1.4.0 移植修改记录

固定 commit 为 `1d9788e1430c4898e463d99f52aab6c400399328`。`UPSTREAM.json` 中 `sha256` 为该 commit 的源文件哈希，`modifiedSha256` 为本包文件哈希。记录的许可证、字体与图片保持原始字节。

- `server/lib/engine.js` 统一使用 Hydro 封榜判断，并允许插件本地 Logo 路径通过资源校验。
- `public/js/freeze.js` 保留封榜点当秒可见，封榜之后包括不计罚时结果也隐藏。Hydro 数据缺少封榜点时报错，彩排沿用上游忽略未评测提交行为。
- `public/js/medals.js` 正式且有过题的选手参与金银铜与前三名。首杀奖由适配层限定为正式选手。
- `public/js/play.js` 使用 Hydro 独立会话接口与控制令牌，保存步骤采用版本条件更新，冲突、断线暂停并恢复数据库进度。移除观众分享操作，修订对应提示，将播放状态 CSS 类和全屏目标限定在 Hydro 播放容器内。
- `templates/xcpcio_resolver_play.html` 源自上游 `public/play.html`，接入 Hydro 的 layout/basic.html，替换资源路径与配置返回链接，嵌入会话信息及彩排提示，使用 Hydro 按钮，移除观众分享控件。
- `public/js/school-logos.js` 使用已打包的本地 Logo 与 ICPC 回退图标。
- `public/js/logos.js`、`public/js/render/resolver-view.js`、`public/js/render/text.js` 替换本地资源前缀。预加载本地 Noto Sans SC，并将其加入既有系统中文字体链末尾。保留原绘图布局、动画和拉丁字体。
- `public/js/display-preferences.js` 按会话路径隔离显示设置。
- `public/js/display-settings.js` 将显示区域几何限制在当前 Hydro 播放容器中，面板使用 Hydro 表单。全屏只作用于播放容器，ResizeObserver 同步容器尺寸。
- 新增 `public/js/hydro-config.js`、`public/hydro-config.css`、`public/hydro-play.css` 与插件配置模板。按用户最新要求，配置和播放均嵌入 Hydro 原生页面，复用 Hydro 表单、按钮、导航和明暗主题。预览复用上游 ResolverView。
- 新增 `lib/resolver-*.ts` 完成 Hydro 原始数据、分榜、权限、配置、MongoDB 分块快照和进度对接。`frontend/resolver*.js` 处理 Hydro 页脚脚本入口、CCS 延迟注入和 PJAX。
- 新增类型声明供插件类型检查使用。`resolver/package.json` 声明上游 ES Module 代码格式。

原文件的许可证见包内 `licenses/`，各组件适用范围见根目录 `NOTICE`。原始目录范围包括上游引擎内部的数据解析辅助函数，插件开放的接口仅接受当前比赛与本次滚榜配置。
