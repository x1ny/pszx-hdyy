import { useQuery } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import { cn } from "#/shared/lib/utils.ts";
import { venueListQueryOptions } from "../../venue/-queries";

/**
 * 从场地库引用一个场地。
 *
 * 措辞上叫"引用"（跟原型一致），但实际做的是**整份拷贝**：导入之后这个活动
 * 的空间跟场地库再无关系，场地库那边改名、改区域甚至删掉都不影响它。所以
 * 弹窗底部写明了这一点——不写的话，用户会以为改场地库能同步过来。
 */
export function ActivityVenueImportDialog({
  open,
  onOpenChange,
  importedVenueIds,
  pending,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已经引用过的源场地，列表里置灰——同一个场地不重复导入。 */
  importedVenueIds: number[];
  pending: boolean;
  onImport: (venueId: number) => void;
}) {
  const [keyword, setKeyword] = useState("");

  const listQuery = useQuery({
    ...venueListQueryOptions({
      name: keyword || undefined,
      status: "enabled",
      page: 1,
      pageSize: 50,
    }),
    enabled: open,
  });

  const imported = new Set(importedVenueIds);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader
          title="从场地库引用"
          description="选一个场地，它的区域和平面图会整份拷贝到本活动。"
        />
        <DialogBody className="flex flex-col gap-3">
          <div className="relative">
            <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索场地名称"
              className="pl-9"
            />
          </div>

          {listQuery.isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" />
            </div>
          ) : listQuery.data?.list.length ? (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {listQuery.data.list.map((venue) => {
                const done = imported.has(venue.id);
                return (
                  <button
                    key={venue.id}
                    type="button"
                    disabled={done || pending}
                    onClick={() => onImport(venue.id)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors",
                      done
                        ? "cursor-not-allowed border-border bg-muted/40"
                        : "cursor-pointer border-border bg-card hover:bg-muted/60",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-sm">
                          {venue.name}
                        </span>
                        <Badge variant="outline" className="shrink-0">
                          {venue.zoneCount} 区域 / {venue.seatCount} 点位
                        </Badge>
                      </div>
                      <p className="truncate text-muted-foreground text-xs">
                        {venue.address || "未填写地址"}
                      </p>
                    </div>
                    {done && (
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                        <CheckIcon className="size-3.5" />
                        已引用
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-10 text-center text-muted-foreground text-sm">
              没有找到可用的场地。场地库里停用的场地不能引用。
            </p>
          )}
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <p className="text-muted-foreground text-xs">
            引用是一次性拷贝，之后场地库的改动不会同步过来。
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
