/*
 * Program-item variants for the PresContest-aligned templates. Each variant maps to one ICPC Tools
 * presentation port in presentation-ports.js; keep the list in sync with frontend/src/types.ts.
 */
import { portKey } from "./presentation-ports.js";

export const VARIANTS = Object.freeze({
  tiles: [["standings", "实时方块榜（Tiles）"], ["rank", "按通过数分组（Tile rank）"], ["list", "按队名排列（Tile list）"]],
  groups: [["group", "单组排行（Group leaderboard）"], ["all", "各组领先（All groups）"]],
  chart: [["problems", "各题提交与通过（Problem summary）"], ["languages", "各语言提交与通过（Languages）"], ["total", "提交总量走势（Total problems）"], ["comparison", "各题提交走势（Problem comparison）"], ["problem-detail", "单题提交走势（Problem detail）"], ["score", "前四名排名（Scoreboard）"], ["judgement-time", "判题耗时（Judgement time）"], ["queue-depth", "判题队列深度（Judge queue depth）"]],
  problems: [["summary", "题目统计"], ["colors", "题目气球颜色"]],
  floor: [["floor", "赛场平面"], ["balloons", "气球分布"]],
  world: [["orgs", "参赛学校（World）"], ["groups", "分组分布（Group）"], ["submissions", "实时提交（Submissions）"]],
  "logo-wall": [["wall", "Logo 墙"], ["fade", "逐个淡入"], ["slide", "横向滚动"]],
  countdown: [["digital", "数字倒计时"], ["polar", "环形倒计时"]],
  queue: [["queue", "判题队列（Judge queue）"], ["teams", "队伍判题（Team judgements）"]],
  photos: [["slideshow", "图片轮播（Photos）"], ["single", "单张照片与说明（Photo and caption）"]],
});

export const variantOf = (item) => {
  const list = VARIANTS[item?.type];
  return list?.some(([v]) => v === item.variant) ? item.variant : list?.[0]?.[0] || "";
};

/** Ported presentations keep their own animation state, so they always repaint. */
export function animatedPresentation(item) {
  return Boolean(portKey(item, variantOf(item)));
}
