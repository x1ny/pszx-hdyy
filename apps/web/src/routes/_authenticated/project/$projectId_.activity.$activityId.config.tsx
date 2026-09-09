import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * 「配置总览」已并入「活动总览」（同目录 `index.tsx`）。
 *
 * 路由留下来只做重定向：两页都是只读的活动级信息，分成两个平级入口的唯一
 * 效果是让落地页永远是最空的那一页；合并的理由写在 `index.tsx` 的组件注释里。
 *
 * 为什么不直接删掉这个文件：这条 URL 在合并之前是可收藏、可粘贴的，删掉会
 * 让它掉进全局 404，而 404 页说不出"东西搬到哪儿去了"。重定向一行代码，
 * 留着不花钱。
 */
export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/config",
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/project/$projectId/activity/$activityId",
      params,
      replace: true,
    });
  },
});
