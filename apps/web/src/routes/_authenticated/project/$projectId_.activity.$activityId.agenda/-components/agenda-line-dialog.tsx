import { Loader2Icon, PlusIcon } from "lucide-react";
import { useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import type { AgendaLine, Segment } from "../-queries";

/**
 * 议程线管理。刻意做得很薄：线只有名字和排序两个字段，用不着一套完整的
 * 表单弹窗——就地编辑 + 保存即可。
 *
 * 主线不在这里创建（它由第一个主线环节保存时懒创建），也不能删除；能改的
 * 只有名字，排序对它没有意义（永远画在第一层）。
 */
export function AgendaLineDialog({
  open,
  lines,
  segments,
  submitting,
  onOpenChange,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  lines: AgendaLine[];
  segments: Segment[];
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: { name: string; sortOrder: number }) => void;
  onUpdate: (values: { id: number; name?: string; sortOrder: number }) => void;
  onDelete: (line: AgendaLine) => void;
}) {
  const [newName, setNewName] = useState("");
  const [drafts, setDrafts] = useState<
    Record<number, { name: string; sortOrder: string }>
  >({});

  // 含作废环节一起算：作废环节仍然指着这条线，服务端也是按这个口径拦的
  const usageByLine = new Map<number, number>();
  for (const segment of segments) {
    usageByLine.set(
      segment.agendaLineId,
      (usageByLine.get(segment.agendaLineId) ?? 0) + 1,
    );
  }

  const draftOf = (line: AgendaLine) =>
    drafts[line.id] ?? {
      name: line.name ?? "",
      sortOrder: String(line.sortOrder),
    };

  const patchDraft = (
    line: AgendaLine,
    patch: Partial<{ name: string; sortOrder: string }>,
  ) =>
    setDrafts((previous) => ({
      ...previous,
      [line.id]: { ...draftOf(line), ...patch },
    }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setNewName("");
          setDrafts({});
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>议程线管理</DialogTitle>
          <DialogDescription>
            一个活动只有一条主线（第一次保存主线环节时自动创建），并行线可以
            有多条。同一条线上的环节时间不能重叠，需要同时进行的环节放到不同
            的并行线。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">类型</TableHead>
                <TableHead>线路名称</TableHead>
                <TableHead className="w-24">排序</TableHead>
                <TableHead className="w-20">环节数</TableHead>
                <TableHead className="w-36 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    还没有议程线。可以直接新增并行线，主线会在保存第一个主线
                    环节时自动创建。
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((line) => {
                  const draft = draftOf(line);
                  const isMain = line.lineType === "main";
                  const usage = usageByLine.get(line.id) ?? 0;
                  const dirty =
                    draft.name !== (line.name ?? "") ||
                    draft.sortOrder !== String(line.sortOrder);

                  return (
                    <TableRow key={line.id}>
                      <TableCell className="whitespace-nowrap">
                        {isMain ? "主线" : "并行线"}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draft.name}
                          placeholder={isMain ? "留空显示为「主线」" : "必填"}
                          onChange={(event) =>
                            patchDraft(line, { name: event.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={999}
                          disabled={isMain}
                          value={isMain ? "0" : draft.sortOrder}
                          onChange={(event) =>
                            patchDraft(line, { sortOrder: event.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">{usage}</TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-primary hover:text-primary"
                            disabled={!dirty || submitting}
                            onClick={() =>
                              onUpdate({
                                id: line.id,
                                name: draft.name.trim() || undefined,
                                sortOrder: Number(draft.sortOrder) || 0,
                              })
                            }
                          >
                            保存
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            // 主线不能删；有环节（含作废）的线也不能删，服务端
                            // 同样会拦，这里先把按钮灰掉少一次无效往返
                            disabled={isMain || usage > 0 || submitting}
                            onClick={() => onDelete(line)}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          <div className="flex items-end gap-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex-1">
              <p className="mb-1.5 font-medium text-sm">新增并行线</p>
              <Input
                value={newName}
                placeholder="例如：分论坛 A"
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>
            <Button
              disabled={!newName.trim() || submitting}
              onClick={() => {
                onCreate({
                  name: newName.trim(),
                  // 排序默认追加到末尾，用户可以在上面的表格里改
                  sortOrder:
                    lines.filter((line) => line.lineType === "parallel")
                      .length + 1,
                });
                setNewName("");
              }}
            >
              {submitting ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <PlusIcon />
              )}
              新增
            </Button>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
