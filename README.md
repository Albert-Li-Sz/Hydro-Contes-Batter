# Hydro Contes Batter

Hydro OJ 的 ACM 比赛榜单、滚榜、大屏与直播插件，集成 XCPCIO 增强榜、Resolver-Web v1.4.0（含移植自 ICPC Tools 的滚榜与展示画面）和 ICPC Live v3.5.1，使用 Hydro 原生页面与明暗主题。

- 默认仅主榜，学校榜、参赛类型榜及手动榜由管理员配置。
- 各榜独立设置全部奖项，榜单与滚榜共用规则，打星选手可单独允许获一血奖。
- 支持封榜展示、实时榜和可配置的公开访问。
- 支持只滚所选榜单，或将所选分榜设为正式参赛、其余选手设为非正式参赛。
- 每位管理员可独立创建滚榜会话，进度保存至 MongoDB，支持刷新恢复，默认永久保留。
- 高清校徽、字体与图标随包提供，运行时从本地加载；榜单使用缩略图，滚榜使用原图。
- 大屏：实时榜单、领先队伍榜、方块榜、首解列表、判题队列、比赛时钟、倒计时、文字公告和滚榜观众画面，每种画面一个免登录链接，支持全屏，画面移植自 ICPC Tools。
- 直播：集成 ICPC Live v3 的 OBS 直播画面与导播台，后端改写为 Node.js 运行在 Hydro 内，无需 Java；榜单、评测队列、统计、滚动字幕、队伍画面、标题字幕、图片与自动解说，数据与公开榜一致。

## 安装

需要 Node.js 22+、pnpm 和 Hydro 5.x。以下命令适用于通过 Yarn 和 PM2 管理的 Hydro 主服务环境。

```bash
git clone https://github.com/Albert-Li-Sz/Hydro-Contes-Batter.git
cd Hydro-Contes-Batter
pnpm install --frozen-lockfile
pnpm pack --pack-destination ./dist

yarn global add "$PWD/dist/hydro-scoreboard-xcpcio-plus-0.8.0.tgz"
hydrooj addon add hydro-scoreboard-xcpcio-plus
pm2 restart hydrooj
```

容器部署时，在 Hydro 主服务容器内完成插件安装和启用，并使用该部署的服务重启方式。安装包包含高清资源。

## 使用

- **增强榜**：从比赛成绩表进入，在“奖牌与分榜设置”中配置分榜、各榜奖项、公开访问和身份显示。
- **滚榜**：比赛所有者及有“编辑比赛”权限的管理员，从比赛右侧菜单的“滚榜”进入。可只滚所选榜单，或将所选分榜设为正式参赛、其余设为非正式参赛；比赛结束前自动标记为彩排。每位管理员的会话互相独立。
- **大屏**：同样的管理员从比赛右侧菜单的“大屏”进入，为每种画面选择分榜和样式、填写公告或倒计时目标，复制链接到大屏电脑打开即可，无需登录 Hydro。点击画面、右上角“全屏”按钮或按 F 进入全屏，Esc 退出；无人值守的大屏可用 Chrome / Edge 的 `--kiosk` 参数打开。

| 大屏画面 | 说明 |
| --- | --- |
| 实时榜单 / 领先队伍榜 | 完整榜单按页滚动 / 前 12 名 |
| 方块榜 | 实时方块榜、按通过数分组或按队名排列 |
| 首解列表 | 各题最早通过，按所选分榜的一血资格 |
| 判题队列 | 最近提交逐行显示，或 7×3 网格显示新提交 |
| 比赛时钟 / 倒计时 | 多日比赛显示完整小时数；倒计时可为数字或环形 |
| 文字公告 | 全屏文字 |
| 滚榜观众画面 | 只读跟随一场滚榜，与主持端画面一致 |

- **直播**：同样的管理员从比赛右侧菜单的“直播”进入，复制“直播画面”链接添加为 OBS 浏览器源（1920×1080），再打开“导播台”切换画面内容。导播台需要 Hydro 登录，多名导播可同时操作；直播画面链接免登录，可随时作废重建。

榜单类大屏使用与公开榜相同的数据：开赛前不显示，封榜后冻结，按“向所有观众显示真实姓名与学校”决定是否显示真名。滚榜观众画面与主持端一致，显示真实姓名与学校，链接请只在场馆使用。作废链接后旧链接立即失效。

详细配置与使用方法见 [使用文档](docs/usage.md)，测试范围见 [验证记录](docs/verification.md)。

## 开发

```bash
pnpm typecheck
pnpm test
pnpm preview
```

本地预览地址为 `http://127.0.0.1:18900/`，滚榜配置页为 `/contest/demo/resolver`，大屏管理页为 `/contest/demo/screens`，直播设置页为 `/contest/demo/live`（模拟一场进行中、不断有新提交的比赛）。服务端代码位于 `index.ts` 和 `lib/`，界面位于 `client/`、`frontend/` 和 `templates/`，移植的滚榜与大屏模块位于 `resolver/`（来源哈希见 `resolver/UPSTREAM.json`）。校徽由 `pnpm logos` 从 Hydro 校徽注册表下载到 `logos/`，需要本机安装 `cwebp`。直播后端位于 `lib/live/`，前端为 ICPC Live v3.5.1 打上 `live/frontend.patch` 后的构建产物 `live/dist/`，`pnpm build:live` 会从固定提交重新构建（需要 git、pnpm 和网络）。

## 许可

插件沿用 AGPL-3.0-or-later。XCPCIO、Resolver-Web、ICPC Live（MIT）及其第三方组件分别保留原许可证。ICPC Software License 包含非商业使用、源码公开和保留许可证的条件，商业或创收使用须取得书面例外授权。完整声明见 [NOTICE](NOTICE)、[许可证目录](licenses/)、[Resolver 来源与修改记录](resolver/CHANGES.md) 和 [ICPC Live 来源](live/UPSTREAM.json)。
