import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "#/shared/components/ui/card.tsx";
import {
  ActivityFormDialog,
  type ActivityFormSubmitValues,
} from "./-components/activity-form-dialog";
import {
  activityDetailQueryOptions,
  activityKeys,
  updateActivity,
} from "./-queries";
import { formatBudget } from "./-utils";

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
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
            <InfoRow label="主办单位">{activity.hostOrg || "-"}</InfoRow>
            <InfoRow label="承办单位">{activity.organizerOrg || "-"}</InfoRow>
            <InfoRow label="支持单位">{activity.supportOrg || "-"}</InfoRow>
            <InfoRow label="指导单位">{activity.guidingOrg || "-"}</InfoRow>
            <InfoRow label="总预算">{formatBudget(activity.totalBudget)}</InfoRow>
          </dl>
          {activity.description && (
            <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
              {activity.description}
            </p>
          )}
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
