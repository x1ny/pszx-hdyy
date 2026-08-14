import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Member } from "#/features/member/queries";
import { memberListQueryOptions } from "#/features/member/queries";
import { Button } from "#/shared/components/ui/button.tsx";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import { maskMobile } from "../-utils";

type SelectTargetsDialogProps = {
  open: boolean;
  selected: Member[];
  onCancel: () => void;
  onOk: (targets: Member[]) => void;
};

const PAGE_SIZE = 10;

/** 邀请对象来自全局人员池（人员管理模块），不按项目/活动过滤——延续旧版的实际行为。 */
export function SelectTargetsDialog({
  open,
  selected,
  onCancel,
  onOk,
}: SelectTargetsDialogProps) {
  const [name, setName] = useState("");
  const [companyPosition, setCompanyPosition] = useState("");
  const [page, setPage] = useState(1);
  const [selectedMap, setSelectedMap] = useState<Map<number, Member>>(new Map());

  useEffect(() => {
    if (!open) return;
    setSelectedMap(new Map(selected.map((item) => [item.id, item])));
    setName("");
    setCompanyPosition("");
    setPage(1);
    // biome-ignore lint/correctness/useExhaustiveDependencies: 只在弹窗打开时重置一次
  }, [open]);

  const listQuery = useQuery({
    ...memberListQueryOptions({
      name: name || undefined,
      companyPosition: companyPosition || undefined,
      status: "enabled",
      page,
      pageSize: PAGE_SIZE,
    }),
    enabled: open,
  });

  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const toggle = (member: Member, checked: boolean) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (checked) next.set(member.id, member);
      else next.delete(member.id);
      return next;
    });
  };

  const allOnPageChecked = list.length > 0 && list.every((m) => selectedMap.has(m.id));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>选择邀请对象</DialogTitle>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
          <Input
            className="w-44"
            placeholder="搜索姓名"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            className="w-52"
            placeholder="企业（社会）职务"
            value={companyPosition}
            onChange={(event) => setCompanyPosition(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(1)}
          >
            查询
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allOnPageChecked}
                    onCheckedChange={(checked) => {
                      setSelectedMap((prev) => {
                        const next = new Map(prev);
                        for (const member of list) {
                          if (checked) next.set(member.id, member);
                          else next.delete(member.id);
                        }
                        return next;
                      });
                    }}
                  />
                </TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>企业（社会）职务</TableHead>
                <TableHead>国别/地区</TableHead>
                <TableHead>手机号码</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {listQuery.isPending ? "加载中..." : "没有匹配的人员"}
                  </TableCell>
                </TableRow>
              ) : (
                list.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedMap.has(member.id)}
                        onCheckedChange={(checked) => toggle(member, !!checked)}
                      />
                    </TableCell>
                    <TableCell>{member.name}</TableCell>
                    <TableCell>{member.companyPosition || "-"}</TableCell>
                    <TableCell>{member.countryRegion || "-"}</TableCell>
                    <TableCell>{maskMobile(member.mobile)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between text-muted-foreground text-sm">
          <span>共 {total} 人，已选 {selectedMap.size} 人</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * PAGE_SIZE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>

        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={() => onOk([...selectedMap.values()])}>
            确定（已选 {selectedMap.size}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
