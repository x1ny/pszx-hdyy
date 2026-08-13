import { createFileRoute } from "@tanstack/react-router";
import { ActivitySubPagePlaceholder } from "./-components/activity-subpage-placeholder";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId_/config",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId, activityId } = Route.useParams();
  return (
    <ActivitySubPagePlaceholder
      projectId={projectId}
      activityId={activityId}
      title="活动配置中心"
    />
  );
}
