import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "#/shared/components/page-placeholder.tsx";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/registration",
)({
  component: () => <PagePlaceholder title="报名审核" />,
});
