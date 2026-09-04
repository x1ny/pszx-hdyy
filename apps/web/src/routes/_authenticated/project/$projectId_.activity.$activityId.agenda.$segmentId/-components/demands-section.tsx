import { LinkIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import {
  bindable,
  DEMAND_HANDLING_HINTS,
  DEMAND_HANDLING_ITEMS,
  RESOURCE_TYPE_LABELS,
  TRANSPORT_SCENE_ITEMS,
} from "#/features/resource/labels.ts";
import type {
  ActivityResource,
  ResourceType,
} from "#/features/resource/queries.ts";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
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
import { cn } from "#/shared/lib/utils.ts";
import type {
  DemandDraft,
  MemberDraft,
  ResourceDraft,
  ResourceFieldsDraft,
} from "../-draft";
import { ResourceLinkDialog } from "./resource-link-dialog";
import { SectionCard } from "./section-card";

/**
 * 需求与资源安排。两层：
 *
 * - **声明层**（四类矩阵，一个环节每类最多一条）——和旧弹窗完全一样的字段。
 *   行存在即已开启，关掉就是删行，所以这里是四个开关而不是一个列表。
 * - **安排层**（`activity_resource`）——原型新加的嵌套块。这一层是**活动级**
 *   记录：在这里建的车会出现在活动资源台账里，也可能同时服务别的环节。所以
 *   有两个入口（新建 / 关联已有），删除默认是"解除关联"而不是报废。
 *
 * 资源类型**跟着需求走**，卡片里没有类型选择器：用车需求下面只可能是车。
 * 服务端的 checkDemandsLinkable 本来就拒绝跨类型关联，让前端传一个必然等于
 * 需求类型的值只是多给它一次传错的机会。
 *
 * 处理要求选「仅记录需求」时整个安排层不出现——`record_only` 按定义不产生台账
 * 记录，硬关联上去只会攒出一份查不到、用不上的死数据（服务端也会拒）。
 */
export function DemandsSection({
  demands,
  members,
  activityId,
  onToggleType,
  onFieldChange,
  onAddResource,
  onLinkResource,
  onResourceFieldChange,
  onDetachResource,
  onVoidResource,
  onBindMember,
  onUnbindMember,
}: {
  demands: DemandDraft[];
  members: MemberDraft[];
  activityId: number;
  onToggleType: (resourceType: ResourceType, enabled: boolean) => void;
  onFieldChange: (
    resourceType: ResourceType,
    field: "handling" | "description" | "estimatedCount" | "ownerName",
    value: string,
  ) => void;
  onAddResource: (resourceType: ResourceType) => void;
  onLinkResource: (
    resourceType: ResourceType,
    resource: ActivityResource,
  ) => void;
  onResourceFieldChange: (
    resourceType: ResourceType,
    key: string,
    field: keyof ResourceFieldsDraft,
    value: string,
  ) => void;
  onDetachResource: (resourceType: ResourceType, key: string) => void;
  onVoidResource: (resourceType: ResourceType, key: string) => void;
  onBindMember: (
    resourceType: ResourceType,
    resourceKey: string,
    member: MemberDraft,
  ) => void;
  onUnbindMember: (
    resourceType: ResourceType,
    resourceKey: string,
    bindingKey: string,
  ) => void;
}) {
  const enabledCount = demands.filter((demand) => demand.enabled).length;

  return (
    <SectionCard
      id="section-demands"
      title="需求与资源安排"
      description="按资源类型分别开启，不是一个总开关。资源安排是活动级台账记录，改动会影响关联到它的其他环节。"
      summary={`已开启 ${enabledCount} / 4 类`}
    >
      <div className="flex flex-col gap-3">
        {demands.map((demand) => (
          <DemandCard
            key={demand.resourceType}
            demand={demand}
            members={members}
            activityId={activityId}
            onToggle={(checked) => onToggleType(demand.resourceType, checked)}
            onFieldChange={(field, value) =>
              onFieldChange(demand.resourceType, field, value)
            }
            onAddResource={() => onAddResource(demand.resourceType)}
            onLinkResource={(resource) =>
              onLinkResource(demand.resourceType, resource)
            }
            onResourceFieldChange={(key, field, value) =>
              onResourceFieldChange(demand.resourceType, key, field, value)
            }
            onDetachResource={(key) =>
              onDetachResource(demand.resourceType, key)
            }
            onVoidResource={(key) => onVoidResource(demand.resourceType, key)}
            onBindMember={(resourceKey, member) =>
              onBindMember(demand.resourceType, resourceKey, member)
            }
            onUnbindMember={(resourceKey, bindingKey) =>
              onUnbindMember(demand.resourceType, resourceKey, bindingKey)
            }
          />
        ))}
      </div>
    </SectionCard>
  );
}

function DemandCard({
  demand,
  members,
  activityId,
  onToggle,
  onFieldChange,
  onAddResource,
  onLinkResource,
  onResourceFieldChange,
  onDetachResource,
  onVoidResource,
  onBindMember,
  onUnbindMember,
}: {
  demand: DemandDraft;
  members: MemberDraft[];
  activityId: number;
  onToggle: (checked: boolean) => void;
  onFieldChange: (
    field: "handling" | "description" | "estimatedCount" | "ownerName",
    value: string,
  ) => void;
  onAddResource: () => void;
  onLinkResource: (resource: ActivityResource) => void;
  onResourceFieldChange: (
    key: string,
    field: keyof ResourceFieldsDraft,
    value: string,
  ) => void;
  onDetachResource: (key: string) => void;
  onVoidResource: (key: string) => void;
  onBindMember: (resourceKey: string, member: MemberDraft) => void;
  onUnbindMember: (resourceKey: string, bindingKey: string) => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const label = RESOURCE_TYPE_LABELS[demand.resourceType];
  const showResources = demand.enabled && demand.handling === "arrange";

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        demand.enabled ? "bg-card" : "bg-muted/40",
      )}
    >
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={demand.enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <Badge variant="outline">{label}</Badge>
        {!demand.enabled && demand.resources.length > 0 ? (
          <span className="text-muted-foreground text-xs">
            关闭后将解除已关联的 {demand.resources.length} 条资源安排
          </span>
        ) : null}
      </label>

      {demand.enabled ? (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel>处理要求</FieldLabel>
              <Select
                items={DEMAND_HANDLING_ITEMS}
                value={demand.handling}
                onValueChange={(value) => {
                  if (value) onFieldChange("handling", value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEMAND_HANDLING_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {DEMAND_HANDLING_HINTS[demand.handling]}
              </p>
            </Field>

            <Field>
              <FieldLabel>预计数量</FieldLabel>
              <Input
                type="number"
                min={0}
                placeholder="选填"
                value={demand.estimatedCount}
                onChange={(event) =>
                  onFieldChange("estimatedCount", event.target.value)
                }
              />
            </Field>

            <Field>
              <FieldLabel>需求负责人</FieldLabel>
              <Input
                placeholder="选填"
                value={demand.ownerName}
                onChange={(event) =>
                  onFieldChange("ownerName", event.target.value)
                }
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>需求说明</FieldLabel>
            <Textarea
              rows={2}
              placeholder="例如：演讲嘉宾 3 人从机场接站；全体参会人员闭幕后轻食茶歇"
              value={demand.description}
              onChange={(event) =>
                onFieldChange("description", event.target.value)
              }
            />
          </Field>

          {showResources ? (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-sm">
                  资源安排（{demand.resources.length}）
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLinkOpen(true)}
                  >
                    <LinkIcon />
                    关联已有资源
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onAddResource}
                  >
                    <PlusIcon />
                    新增资源安排
                  </Button>
                </div>
              </div>

              {demand.resources.length === 0 ? (
                <p className="mt-3 text-muted-foreground text-sm">
                  还没有安排。新建一条会同时写进活动资源台账；已经在台账里的
                  （比如一辆车服务多个环节）用「关联已有资源」挂上来，不要重复建。
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {demand.resources.map((resource, index) => (
                    <ResourceCard
                      key={resource.key}
                      index={index}
                      resourceType={demand.resourceType}
                      resource={resource}
                      members={members}
                      onFieldChange={(field, value) =>
                        onResourceFieldChange(resource.key, field, value)
                      }
                      onDetach={() => onDetachResource(resource.key)}
                      onVoid={() => onVoidResource(resource.key)}
                      onBindMember={(member) =>
                        onBindMember(resource.key, member)
                      }
                      onUnbindMember={(bindingKey) =>
                        onUnbindMember(resource.key, bindingKey)
                      }
                    />
                  ))}
                </div>
              )}

              <ResourceLinkDialog
                open={linkOpen}
                activityId={activityId}
                resourceType={demand.resourceType}
                excludeIds={demand.resources.flatMap((row) =>
                  row.resourceId === null ? [] : [row.resourceId],
                )}
                onOpenChange={setLinkOpen}
                onConfirm={(resource) => {
                  onLinkResource(resource);
                  setLinkOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResourceCard({
  index,
  resourceType,
  resource,
  members,
  onFieldChange,
  onDetach,
  onVoid,
  onBindMember,
  onUnbindMember,
}: {
  index: number;
  resourceType: ResourceType;
  resource: ResourceDraft;
  members: MemberDraft[];
  onFieldChange: (field: keyof ResourceFieldsDraft, value: string) => void;
  onDetach: () => void;
  onVoid: () => void;
  onBindMember: (member: MemberDraft) => void;
  onUnbindMember: (bindingKey: string) => void;
}) {
  const isTransport = resourceType === "transport";
  const canBind = bindable(resourceType);

  const boundKeys = new Set(
    resource.bindings.flatMap((binding) =>
      binding.memberKey === null ? [] : [binding.memberKey],
    ),
  );
  const boundRelationIds = new Set(
    resource.bindings.flatMap((binding) =>
      binding.activityMemberId === null ? [] : [binding.activityMemberId],
    ),
  );
  const candidates = members.filter(
    (member) =>
      !boundKeys.has(member.key) &&
      (member.activityMemberId === null ||
        !boundRelationIds.has(member.activityMemberId)),
  );

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-sm">
          资源安排 {index + 1}
          {resource.resourceId === null ? (
            <Badge variant="outline" className="ml-2">
              待保存
            </Badge>
          ) : null}
        </span>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onDetach}>
            解除关联
          </Button>
          {resource.resourceId === null ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                if (
                  window.confirm(
                    "作废是活动级的报废动作，这条资源在整个活动里都不再可用（其他环节也看不到了）。确定作废吗？",
                  )
                ) {
                  onVoid();
                }
              }}
            >
              作废资源
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {isTransport ? (
          <Field>
            <FieldLabel>
              用车场景
              <span className="text-destructive"> *</span>
            </FieldLabel>
            <Select
              items={TRANSPORT_SCENE_ITEMS}
              value={resource.fields.transportScene}
              onValueChange={(value) => {
                if (value) onFieldChange("transportScene", value);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORT_SCENE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        <Field>
          <FieldLabel>
            资源名称
            <span className="text-destructive"> *</span>
          </FieldLabel>
          <Input
            placeholder="例如：机场一号车"
            value={resource.fields.name}
            onChange={(event) => onFieldChange("name", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel>数量 / 规模</FieldLabel>
          <Input
            type="number"
            min={0}
            placeholder="选填"
            value={resource.fields.quantity}
            onChange={(event) => onFieldChange("quantity", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel>负责人</FieldLabel>
          <Input
            placeholder="选填"
            value={resource.fields.ownerName}
            onChange={(event) => onFieldChange("ownerName", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel>开始时间</FieldLabel>
          <Input
            type="datetime-local"
            value={resource.fields.startTime}
            onChange={(event) => onFieldChange("startTime", event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel>结束时间</FieldLabel>
          <Input
            type="datetime-local"
            value={resource.fields.endTime}
            onChange={(event) => onFieldChange("endTime", event.target.value)}
          />
        </Field>

        <Field className={isTransport ? undefined : "sm:col-span-2"}>
          <FieldLabel>地点 / 集合点</FieldLabel>
          <Input
            placeholder="选填"
            value={resource.fields.location}
            onChange={(event) => onFieldChange("location", event.target.value)}
          />
        </Field>

        {isTransport ? (
          <>
            <Field>
              <FieldLabel>车辆信息</FieldLabel>
              <Input
                placeholder="车牌 / 车型"
                value={resource.fields.vehicleInfo}
                onChange={(event) =>
                  onFieldChange("vehicleInfo", event.target.value)
                }
              />
            </Field>
            <Field>
              <FieldLabel>司机姓名</FieldLabel>
              <Input
                value={resource.fields.driverName}
                onChange={(event) =>
                  onFieldChange("driverName", event.target.value)
                }
              />
            </Field>
            <Field>
              <FieldLabel>司机电话</FieldLabel>
              <Input
                value={resource.fields.driverPhone}
                onChange={(event) =>
                  onFieldChange("driverPhone", event.target.value)
                }
              />
            </Field>
          </>
        ) : null}
      </div>

      {canBind ? (
        <div className="mt-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">绑定人员</span>
            <span className="text-muted-foreground text-xs">
              已绑 {resource.bindings.length} 人
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {resource.bindings.map((binding) => (
              <Badge
                key={binding.key}
                variant="outline"
                className={cn(
                  "gap-1",
                  !binding.inSegment && "text-muted-foreground opacity-60",
                )}
              >
                {binding.name}
                {binding.inSegment ? (
                  <button
                    type="button"
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() => onUnbindMember(binding.key)}
                    aria-label={`解绑 ${binding.name}`}
                  >
                    ×
                  </button>
                ) : (
                  /* 不属于本环节的绑定标灰、只读——环节页只看得到本环节的人，
                     让它去动别人的绑定就是越界。 */
                  <span className="ml-1 text-xs">· 来自其他环节</span>
                )}
              </Badge>
            ))}
            {resource.bindings.length === 0 ? (
              <span className="text-muted-foreground text-sm">还没绑人</span>
            ) : null}
          </div>

          {candidates.length > 0 ? (
            <div className="mt-2">
              <Select
                items={candidates.map((member) => ({
                  value: member.key,
                  label: member.name,
                }))}
                value=""
                onValueChange={(value) => {
                  const member = candidates.find((row) => row.key === value);
                  if (member) onBindMember(member);
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="＋ 绑定本环节人员" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((member) => (
                    <SelectItem key={member.key} value={member.key}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="mt-2 text-muted-foreground text-xs">
              本环节的人都绑上了。要绑活动里的其他人，去资源台账页。
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
