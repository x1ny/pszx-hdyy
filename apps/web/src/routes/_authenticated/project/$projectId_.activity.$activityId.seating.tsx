import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "#/shared/components/page-placeholder.tsx";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/seating",
)({
  component: () => <PagePlaceholder title="排位" />,
});
