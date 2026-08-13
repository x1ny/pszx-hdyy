import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { PagePlaceholder } from "#/shared/components/page-placeholder.tsx";
import { buttonVariants } from "#/shared/components/ui/button.tsx";
import { cn } from "#/shared/lib/utils.ts";

/**
 * 活动详情页六个子模块入口（配置中心/议程/资源/人员/邀请函/排位）目前全部
 * 还没建设，先落一个占位页占住路由和导航——这样活动详情页的统计方块能是
 * 真链接，而不是禁用态的死角。等某个子模块真正建成，把对应那一个文件的
 * 内容换掉就行，路径、这个"返回活动详情"的返回路径都不用动。
 */
export function ActivitySubPagePlaceholder({
  projectId,
  activityId,
  title,
}: {
  projectId: string;
  activityId: string;
  title: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Link
        to="/project/$projectId/activity/$activityId"
        params={{ projectId, activityId }}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "-ml-2 w-fit",
        )}
      >
        <ArrowLeftIcon />
        返回活动详情
      </Link>
      <PagePlaceholder title={title} />
    </div>
  );
}
