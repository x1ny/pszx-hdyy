import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "#/components/layout/page-placeholder.tsx";

export const Route = createFileRoute("/_authenticated/project/list")({
  component: () => <PagePlaceholder title="项目列表" />,
});
