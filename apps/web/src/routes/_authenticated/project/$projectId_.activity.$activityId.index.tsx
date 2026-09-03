import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  ActivityFormDialog,
  type ActivityFormSubmitValues,
} from "#/features/project/activity-form-dialog";
import {
  activityDetailQueryOptions,
  activityKeys,
  updateActivity,
} from "#/features/project/queries";
import {
  ACTIVITY_TYPE_LABELS,
  formatBudget,
  formatDateTime,
  PUBLISH_STATUS_LABELS,
} from "#/features/project/utils";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/shared/components/ui/card.tsx";

const dayMs = 24 * 60 * 60 * 1000;

/** "2 天" / "3 小时 30 分"。跨天的活动只说天数，当天的说时长。 */
function duration({
  startTime,
  endTime,
}: {
  startTime: string;
  endTime: string;
}) {
  const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (ms <= 0) return "-";
  if (ms >= dayMs) {
    const days = Math.round((ms / dayMs) * 10) / 10;
    return `${days} 天`;
  }
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.round((ms % 3600000) / 60000);
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`;
}

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/",
)({
  component: ActivityOverviewTab,
});

function ActivityOverviewTab() {
  const { activityId: activityIdParam } = Route.useParams();
  const activityId = Number(activityIdParam);
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);

  // 父路由（活动详情布局）的 loader 已经把这条数据 ensureQueryData 过，
  // 这里拿到的是缓存命中，不会再发一次请求。
  const { data: activity } = useQuery(activityDetailQueryOptions(activityId));

  const saveMutation = useMutation({
    mutationFn: (values: ActivityFormSubmitValues) =>
      updateActivity({ ...values, id: activityId }),
    onSuccess: () => {
      toast.success("修改成功");
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: activityKeys.all });
    },
    onError: (error) => toast.error(error.message),
  });

  if (!activity) return null;

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle>活动基础信息</CardTitle>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFormOpen(true)}
            >
              编辑活动
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {/**
           * 字段清单对齐原型 activity-detail.html 的「活动基础信息」面板，
           * 去掉三样：
           * - H5 展示、报名开关：只控制 H5 行为，H5 本期不建。
           * - 活动图片/视频：同上，媒体全是给 H5 用的。
           *
           * 顶部那行副标题里已经有类型/地点/时间了，这里仍然重复一遍——副
           * 标题是跟着所有标签页走的**上下文**，这张卡片是活动的**档案**，
           * 一份缺了地点和时间的"基础信息"看着就像坏了。
           */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
            <InfoRow label="所属项目">{activity.projectName}</InfoRow>
            <InfoRow label="活动类型">
              {ACTIVITY_TYPE_LABELS[activity.activityType]}
            </InfoRow>
            <InfoRow label="发布状态">
              {PUBLISH_STATUS_LABELS[activity.publishStatus]}
            </InfoRow>
            <InfoRow label="总预算">
              {formatBudget(activity.totalBudget)}
            </InfoRow>

            <InfoRow label="活动地点">{activity.location || "-"}</InfoRow>
            <InfoRow label="开始时间">
              {formatDateTime(activity.startTime)}
            </InfoRow>
            <InfoRow label="结束时间">
              {formatDateTime(activity.endTime)}
            </InfoRow>
            <InfoRow label="活动时长">{duration(activity)}</InfoRow>

            <InfoRow label="主办单位">{activity.hostOrg || "-"}</InfoRow>
            <InfoRow label="承办单位">{activity.organizerOrg || "-"}</InfoRow>
            <InfoRow label="支持单位">{activity.supportOrg || "-"}</InfoRow>
            <InfoRow label="指导单位">{activity.guidingOrg || "-"}</InfoRow>
          </dl>

          {/* 简介单独一块并带上标签。原来它是一段没有标题的灰字，读者分不清
              那是简介还是某个字段的补充说明 */}
          <div className="mt-2 flex flex-col gap-0.5 border-t pt-4">
            <dt className="text-muted-foreground text-xs">活动简介</dt>
            <dd className="whitespace-pre-wrap text-sm leading-relaxed">
              {activity.description || (
                <span className="text-muted-foreground">未填写</span>
              )}
            </dd>
          </div>
        </CardContent>
      </Card>

      <ActivityFormDialog
        open={formOpen}
        activity={activity}
        submitting={saveMutation.isPending}
        onOpenChange={setFormOpen}
        onSubmit={(values) => saveMutation.mutate(values)}
      />
    </>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}
