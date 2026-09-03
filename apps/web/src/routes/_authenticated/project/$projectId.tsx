import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatchRoute,
} from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  type ProjectFormValues,
  projectDetailQueryOptions,
  projectKeys,
  updateProject,
} from "#/features/project/queries";
import {
  formatBudget,
  formatDateTime,
  PUBLISH_STATUS_CHIP,
  PUBLISH_STATUS_LABELS,
} from "#/features/project/utils";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/shared/components/ui/button.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { ProjectFormDialog } from "./-components/project-form-dialog";

/**
 * 项目详情是**布局**，不是页面：上半部分的项目信息卡在所有标签页之间常驻，
 * 下半部分由标签页各自的子路由渲染。结构照抄活动详情
 * （$projectId_.activity.$activityId.tsx），两级详情页长一样，运营不用学两遍。
 *
 * 活动列表原本是这个文件里的一大段，现在挪进了 `$projectId.index.tsx`——它
 * 只是"默认那个标签页"，不再享有特殊地位。这样做的直接好处是筛选条件跟着
 * 各自的子路由走：活动列表的活动类型/发布状态和项目人员的姓名搜索互不干扰。
 */
export const Route = createFileRoute("/_authenticated/project/$projectId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      projectDetailQueryOptions(Number(params.projectId)),
    ),
  component: ProjectDetailLayout,
});

const TABS = [
  { to: "/project/$projectId", label: "活动列表" },
  { to: "/project/$projectId/members", label: "项目人员" },
] as const;

function ProjectDetailLayout() {
  const { projectId: projectIdParam } = Route.useParams();
  const projectId = Number(projectIdParam);
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();

  const [projectFormOpen, setProjectFormOpen] = useState(false);

  const projectQuery = useQuery(projectDetailQueryOptions(projectId));
  const project = projectQuery.data;

  const saveProjectMutation = useMutation({
    mutationFn: (values: ProjectFormValues) =>
      updateProject({ ...values, id: projectId }),
    onSuccess: () => {
      toast.success("修改成功");
      setProjectFormOpen(false);
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <Link
          to="/project/list"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 mb-2",
          )}
        >
          <ArrowLeftIcon />
          返回项目列表
        </Link>

        {!project ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-semibold text-xl tracking-tight">
                    {project.name}
                  </h1>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border",
                      PUBLISH_STATUS_CHIP[project.publishStatus],
                    )}
                  >
                    {PUBLISH_STATUS_LABELS[project.publishStatus]}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  {project.location || "未填写地点"} ·{" "}
                  {project.startTime || project.endTime
                    ? `${formatDateTime(project.startTime)} ~ ${formatDateTime(project.endTime)}`
                    : "未排期"}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setProjectFormOpen(true)}
              >
                编辑项目信息
              </Button>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <InfoRow label="主办单位">{project.hostOrg || "-"}</InfoRow>
              <InfoRow label="承办单位">{project.organizerOrg || "-"}</InfoRow>
              <InfoRow label="支持单位">{project.supportOrg || "-"}</InfoRow>
              <InfoRow label="指导单位">{project.guidingOrg || "-"}</InfoRow>
              <InfoRow label="总预算">
                {formatBudget(project.totalBudget)}
              </InfoRow>
            </dl>

            {project.description && (
              <div className="flex flex-col gap-0.5">
                <p className="text-muted-foreground text-xs">项目简介</p>
                <p className="whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
                  {project.description}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex gap-1 overflow-x-auto border-b">
          {TABS.map((tab) => {
            // 活动列表是 index 路由，`fuzzy: false` 下 /project/1/members 不会
            // 把它也算成命中，两个标签不会同时高亮。
            const isActive = !!matchRoute({
              to: tab.to,
              params: { projectId: projectIdParam },
            });
            return (
              <Link
                key={tab.to}
                to={tab.to}
                params={{ projectId: projectIdParam }}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 font-medium text-sm transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <Outlet />
      </div>

      {project && (
        <ProjectFormDialog
          open={projectFormOpen}
          project={project}
          submitting={saveProjectMutation.isPending}
          onOpenChange={setProjectFormOpen}
          onSubmit={(values) => saveProjectMutation.mutate(values)}
        />
      )}
    </div>
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
