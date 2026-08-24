import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { ActivityVenueCanvasEditorView } from "./-components/activity-venue-canvas-editor-view";
import { ActivityZoneDialog } from "./-components/activity-zone-dialog";
import {
  activityVenueKeys,
  activityVenueLayoutQueryOptions,
  updateActivityVenueZone,
} from "./-venue-queries";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/venue/$activityVenueId",
)({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      activityVenueLayoutQueryOptions(Number(params.activityVenueId)),
    ),
  component: ActivityVenueLayoutPage,
});

/**
 * 活动空间的画布编辑页。跟场地库的 `/venue/$venueId/layout` 是同一个层级
 * ——概览页（多个活动场地的只读快照+业务字段表格）负责"选哪个场地"，
 * 这一页才是真正动几何的地方，进来一个只编辑一个。
 */
function ActivityVenueLayoutPage() {
  const {
    projectId,
    activityId,
    activityVenueId: activityVenueIdParam,
  } = Route.useParams();
  const activityVenueId = Number(activityVenueIdParam);
  const queryClient = useQueryClient();

  const layoutQuery = useQuery(
    activityVenueLayoutQueryOptions(activityVenueId),
  );
  const [businessFieldsZoneId, setBusinessFieldsZoneId] = useState<
    number | null
  >(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: activityVenueKeys.all });

  // 所有 hook 必须在任何 return 之前调用完——上面两条 loading/not-found 分支
  // 会提前 return，这个 mutation 要是挪到分支下面，`layoutQuery.data` 从
  // undefined 变成有值的那一刻，hook 调用顺序就会跟上一次渲染对不上。
  const updateZoneMutation = useMutation({
    mutationFn: updateActivityVenueZone,
    onSuccess: () => {
      toast.success("已保存");
      setBusinessFieldsZoneId(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (layoutQuery.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!layoutQuery.data) {
    return <div className="text-muted-foreground">活动场地不存在。</div>;
  }

  const bundle = layoutQuery.data;
  const editingZone =
    bundle.zones.find((zone) => zone.id === businessFieldsZoneId) ?? null;

  return (
    <>
      <ActivityVenueCanvasEditorView
        key={activityVenueId}
        activityVenueId={activityVenueId}
        projectId={projectId}
        activityId={activityId}
        bundle={bundle}
        onSaved={invalidate}
        onOpenBusinessFields={setBusinessFieldsZoneId}
      />

      <ActivityZoneDialog
        zone={editingZone}
        venueName={bundle.activityVenue.name}
        pending={updateZoneMutation.isPending}
        // 名称在这一页归右侧属性面板管（跟画布一起保存）。弹窗是即时写库的，
        // 两个入口写同一列会互相覆盖——见弹窗组件里 hideName 的说明。
        hideName
        onOpenChange={(open) => !open && setBusinessFieldsZoneId(null)}
        onSubmit={(values) => updateZoneMutation.mutate(values)}
      />
    </>
  );
}
