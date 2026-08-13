import { createFileRoute } from "@tanstack/react-router";
import { ActivitySubPagePlaceholder } from "./-components/activity-subpage-placeholder";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId_/seating",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { projectId, activityId } = Route.useParams();
  return (
    <ActivitySubPagePlaceholder
      projectId={projectId}
      activityId={activityId}
      title="排位"
    />
  );
}
