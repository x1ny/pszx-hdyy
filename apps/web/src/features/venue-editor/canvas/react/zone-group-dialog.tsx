import { useState } from "react";
import { Button } from "#/shared/components/ui/button";
import { Checkbox } from "#/shared/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog";
import { Field, FieldLabel } from "#/shared/components/ui/field";
import { Input } from "#/shared/components/ui/input";
import type { CanvasDoc } from "../core/document";

export function ZoneGroupDialog({
  doc,
  selectedIds,
  onGroup,
}: {
  doc: CanvasDoc;
  selectedIds: string[];
  onGroup: (ids: string[], name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const available = doc.zones.filter(
    (zone) => !zone.isGroup && zone.kind === "seating",
  );
  const duplicate = doc.zones.some((zone) => zone.name === name.trim());
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!available.length}
        onClick={() => {
          setIds(
            selectedIds.filter((id) =>
              available.some((zone) => zone.externalId === id),
            ),
          );
          setName("");
          setOpen(true);
        }}
      >
        归入新区域
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader
            title="归入业务区域"
            description="环节统一选择这个区域，每个分区仍保留独立的座位画布。"
          />
          <DialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="group-name">区域名称</FieldLabel>
              <Input
                id="group-name"
                maxLength={128}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {duplicate && (
              <p role="alert" className="text-destructive text-sm">
                区域名称已存在；加入已有区域请在分区属性中选择归属。
              </p>
            )}
            <div className="flex flex-col gap-3">
              {available.map((zone) => (
                <label
                  key={zone.externalId}
                  htmlFor={`group-section-${zone.externalId}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={`group-section-${zone.externalId}`}
                    checked={ids.includes(zone.externalId)}
                    onCheckedChange={(checked) =>
                      setIds((current) =>
                        checked
                          ? [...current, zone.externalId]
                          : current.filter((id) => id !== zone.externalId),
                      )
                    }
                  />
                  {zone.name}
                  {zone.parentExternalId && (
                    <span className="text-muted-foreground">
                      （将从原区域移入）
                    </span>
                  )}
                </label>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!name.trim() || duplicate || !ids.length}
              onClick={() => {
                onGroup(ids, name.trim());
                setOpen(false);
              }}
            >
              建立区域（{ids.length} 个分区）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
