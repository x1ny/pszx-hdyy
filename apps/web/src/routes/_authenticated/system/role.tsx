import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "#/shared/components/page-placeholder.tsx";

export const Route = createFileRoute("/_authenticated/system/role")({
  component: () => <PagePlaceholder title="角色管理" />,
});
