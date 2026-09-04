import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  formatResourceTime,
  TRANSPORT_SCENE_LABELS,
} from "#/features/resource/labels.ts";
import {
  type ActivityResource,
  activityResourceListQueryOptions,
  type ResourceType,
} from "#/features/resource/queries.ts";
import { FilterActions, FilterBar } from "#/shared/components/filter-bar.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";

/**
 * 从活动资源台账里挑一条已有资源挂到这条需求上。
 *
 * 这个入口不是可有可无的：没有它，两个环节要用同一辆车时运营只能各建一条，
 * 于是台账里躺着三条"机场一号车"，汇总时车数翻三倍——那正是当初把资源从环节
 * 级提到活动级要解决的问题。
 *
 * 候选池按**同类型**过滤：一条用车需求只可能由用车记录满足，服务端的
 * checkDemandsLinkable 也是这么判的，这里先收窄免得选了才被拒。
 */
export function ResourceLinkDialog({
  open,
  activityId,
  resourceType,
  excludeIds,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  activityId: number;
  resourceType: ResourceType;
  /** 已经挂在这条需求下的，列表里禁选，避免出现两条一样的。 */
  excludeIds: number[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (resource: ActivityResource) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState("");
  const [page, setPage] = useState(1);

  const listQuery = useQuery({
    ...activityResourceListQueryOptions({
      activityId,
      resourceType,
      // 作废的资源不能再被关联，列表里直接不给。
      status: "active",
      keyword: applied || undefined,
      page,
      pageSize: 10,
    }),
    enabled: open,
  });

  const list = listQuery.data?.list ?? [];
  const excluded = new Set(excludeIds);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>关联已有资源</DialogTitle>
          <DialogDescription>
            从活动资源台账里挑一条挂到本需求上。同一条资源可以同时服务多个环节
            需求，不用重复新建。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          {/* 全站唯一的筛选交互：改输入框只改草稿，点「查询」才生效。 */}
          <FilterBar
            className="border-0 p-0 shadow-none"
            onSubmit={() => {
              setApplied(keyword);
              setPage(1);
            }}
          >
            <Input
              className="w-60"
              placeholder="按名称 / 地点 / 车牌 / 司机搜索"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <FilterActions
              pending={listQuery.isFetching}
              onReset={() => {
                setKeyword("");
                setApplied("");
                setPage(1);
              }}
            />
          </FilterBar>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-40">名称</TableHead>
                  {resourceType === "transport" ? (
                    <TableHead className="min-w-24">场景</TableHead>
                  ) : null}
                  <TableHead className="min-w-40">时间</TableHead>
                  <TableHead className="min-w-32">地点</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ) : list.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground text-sm"
                    >
                      台账里还没有这一类的资源，先用「新增资源安排」建一条。
                    </TableCell>
                  </TableRow>
                ) : (
                  list.map((resource) => {
                    const already = excluded.has(resource.id);
                    return (
                      <TableRow key={resource.id}>
                        <TableCell className="font-medium">
                          {resource.name}
                        </TableCell>
                        {resourceType === "transport" ? (
                          <TableCell>
                            {resource.transportScene
                              ? TRANSPORT_SCENE_LABELS[resource.transportScene]
                              : "-"}
                          </TableCell>
                        ) : null}
                        <TableCell>{formatResourceTime(resource)}</TableCell>
                        <TableCell>{resource.location ?? "-"}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={already}
                            onClick={() => onConfirm(resource)}
                          >
                            {already ? "已关联" : "关联"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-muted-foreground text-sm">
            <span>共 {listQuery.data?.total ?? 0} 条</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page * 10 >= (listQuery.data?.total ?? 0)}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
