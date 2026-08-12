import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "#/components/layout/page-placeholder.tsx";

export const Route = createFileRoute("/_authenticated/system/user")({
  component: () => <PagePlaceholder title="用户管理" />,
});
