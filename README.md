# Hydro Contes Batter

Hydro OJ 的 ACM 比赛榜单与滚榜插件，集成 XCPCIO 增强榜和 Resolver-Web v1.4.0，使用 Hydro 原生页面与明暗主题。

- 支持学校榜、参赛资格榜、手动分榜及独立奖牌设置。
- 支持封榜展示、实时榜和可配置的公开访问。
- 支持只滚所选榜单，或将所选分榜设为正式参赛、其余选手设为非正式参赛。
- 每位管理员可独立创建滚榜会话，进度保存至 MongoDB，支持刷新恢复。
- 高清校徽、字体与图标随包提供，运行时从本地加载。

## 安装

需要 Node.js 22+、pnpm 和 Hydro 5.x。以下命令适用于通过 Yarn 和 PM2 管理的 Hydro 主服务环境。

```bash
git clone https://github.com/Albert-Li-Sz/Hydro-Contes-Batter.git
cd Hydro-Contes-Batter
pnpm install --frozen-lockfile
pnpm pack --pack-destination ./dist

yarn global add "$PWD/dist/hydro-scoreboard-xcpcio-plus-0.7.1.tgz"
hydrooj addon add hydro-scoreboard-xcpcio-plus
pm2 restart hydrooj
```

容器部署时，在 Hydro 主服务容器内完成插件安装和启用，并使用该部署的服务重启方式。安装包包含高清资源，体积约 335 MiB。

安装后，从比赛成绩表进入增强榜并设置奖牌与分榜。比赛所有者及有“编辑比赛”权限的管理员可通过比赛右侧菜单的“滚榜”入口打开 Resolver。比赛结束前自动标记为彩排。

详细配置与使用方法见 [使用文档](docs/usage.md)，测试范围见 [验证记录](docs/verification.md)。

## 开发

```bash
pnpm typecheck
pnpm test
pnpm preview
```

本地预览地址为 `http://127.0.0.1:18900/`。服务端代码位于 `index.ts` 和 `lib/`，界面位于 `client/`、`frontend/` 和 `templates/`，移植的滚榜模块位于 `resolver/`。

## 许可

插件沿用 AGPL-3.0-or-later。XCPCIO、Resolver-Web 及其第三方组件分别保留原许可证。ICPC Software License 包含非商业使用、源码公开和保留许可证的条件，商业或创收使用须取得书面例外授权。完整声明见 [NOTICE](NOTICE)、[许可证目录](licenses/) 和 [Resolver 来源与修改记录](resolver/CHANGES.md)。
