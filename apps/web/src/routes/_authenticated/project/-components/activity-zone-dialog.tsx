import { useEffect, useState } from "react";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "#/shared/components/ui/dialog.tsx";
import { Field, FieldLabel } from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import { Textarea } from "#/shared/components/ui/textarea.tsx";
import { ZONE_KIND_LABELS } from "../../venue/-utils";
import type {
  ActivityVenueStatus,
  ActivityVenueZoneRow,
  UpdateActivityVenueZoneInput,
  ZonePurpose,
} from "../-venue-queries";
import {
  ACTIVITY_VENUE_STATUS_LABELS,
  formatActivityZoneOrigin,
  ZONE_PURPOSE_LABELS,
  ZONE_PURPOSE_VALUES,
} from "../-venue-utils";

/**
 * 编辑活动区域。字段照原型 activity-space.html 的弹窗。
 *
 * **能改的只有"这场活动拿它干什么"**：名称、用途、可用点位、状态、说明。
 * 来源场地区域和区域类型是只读的——前者是出处，后者是场地的固有属性
 * （这块地方是什么），都不该在活动层被改写。几何更是完全不在这里改
 * （docs/场地排位底层设计.md §3.3：不做活动层座位编辑）。
 */
export function ActivityZoneDialog({
  zone,
  venueName,
  pending,
  hideName,
  onOpenChange,
  onSubmit,
}: {
  zone: ActivityVenueZoneRow | null;
  venueName: string;
  pending: boolean;
  /**
   * 画布页要传 `true`。
   *
   * 那一页的区域属性面板本来就管「名称」，而且它是**跟着画布一起保存**的；
   * 这个弹窗是**即时写库**的。同一列两个入口、两种时机，结果是：用弹窗改完名字
   * 立即生效，再点一次画布的「保存」，归并逻辑会拿画布里那份还没更新的旧名字
   * 把它覆盖回去——用户刚改的名字被静默还原，没有任何提示。
   *
   * 所以画布页把这个字段藏掉，名称只留属性面板一个入口；概览页没有属性面板，
   * 保持显示。见 docs/场地排位交互评审.md §3.3。
   */
  hideName?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UpdateActivityVenueZoneInput) => void;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<ZonePurpose>("mainSeating");
  const [capacity, setCapacity] = useState(0);
  const [status, setStatus] = useState<ActivityVenueStatus>("active");
  const [note, setNote] = useState("");

  // 每次打开都从这一行重新灌一遍，不残留上一个区域的值。
  useEffect(() => {
    if (!zone) return;
    setName(zone.name);
    setPurpose(zone.purpose);
    setCapacity(zone.capacity);
    setStatus(zone.status);
    setNote(zone.note ?? "");
  }, [zone]);

  return (
    <Dialog open={zone !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader
          title="编辑活动区域"
          description="改的只是本活动怎么用这块区域，不会影响场地库，也不会影响其他活动。"
        />
        <DialogBody className="grid grid-cols-2 gap-4">
          {!hideName && (
            <Field>
              <FieldLabel htmlFor="zone-name">活动区域名称</FieldLabel>
              <Input
                id="zone-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="zone-source">区域来源</FieldLabel>
            <Input
              id="zone-source"
              readOnly
              value={
                zone
                  ? formatActivityZoneOrigin(
                      venueName,
                      zone.name,
                      zone.sourceZoneId,
                    )
                  : ""
              }
              className="text-muted-foreground"
            />
          </Field>

          <Field>
            <FieldLabel>活动用途</FieldLabel>
            <Select
              items={ZONE_PURPOSE_LABELS}
              value={purpose}
              onValueChange={(value) => setPurpose(value as ZonePurpose)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONE_PURPOSE_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ZONE_PURPOSE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="zone-capacity">可用点位</FieldLabel>
            <Input
              id="zone-capacity"
              type="number"
              min={0}
              value={capacity}
              onChange={(event) =>
                setCapacity(Math.max(0, Number(event.target.value) || 0))
              }
            />
            {/* 说清楚它是什么，否则会被当成"改了这个数就能多排几个人"。 */}
            <p className="text-muted-foreground text-xs">
              规划数字，不限制排位实际能放几个位置
            </p>
          </Field>

          <Field>
            <FieldLabel>区域类型</FieldLabel>
            <Input
              readOnly
              value={zone ? ZONE_KIND_LABELS[zone.kind] : ""}
              className="text-muted-foreground"
            />
          </Field>

          <Field>
            <FieldLabel>状态</FieldLabel>
            <Select
              items={ACTIVITY_VENUE_STATUS_LABELS}
              value={status}
              onValueChange={(value) => setStatus(value as ActivityVenueStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.keys(
                    ACTIVITY_VENUE_STATUS_LABELS,
                  ) as ActivityVenueStatus[]
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {ACTIVITY_VENUE_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field className="col-span-2">
            <FieldLabel htmlFor="zone-note">活动说明</FieldLabel>
            <Textarea
              id="zone-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="本活动对该区域的使用说明，供环节排位参考。"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={pending || !zone || name.trim().length === 0}
            onClick={() =>
              zone &&
              onSubmit({
                id: zone.id,
                name: name.trim(),
                purpose,
                capacity,
                status,
                note: note.trim() || undefined,
              })
            }
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
