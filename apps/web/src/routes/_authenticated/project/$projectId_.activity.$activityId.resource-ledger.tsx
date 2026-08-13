import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "#/shared/components/page-placeholder.tsx";

export const Route = createFileRoute(
  "/_authenticated/project/$projectId_/activity/$activityId/resource-ledger",
)({
  component: () => <PagePlaceholder title="资源台账" />,
});
