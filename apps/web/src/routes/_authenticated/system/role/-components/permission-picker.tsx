import type { PermissionKey } from "@repo/server/permissions";
import { navMain } from "#/app/nav.ts";
import { Checkbox } from "#/shared/components/ui/checkbox.tsx";
import { Label } from "#/shared/components/ui/label.tsx";
import { cn } from "#/shared/lib/utils.ts";

/**
 * 权限点复选框网格，**直接按侧边栏菜单渲染**。
 *
 * 不另外维护一份"权限点 → 中文名"的清单：权限点和菜单项是一一对应的
 * （一个菜单项 = 一个权限点，能进就能改），菜单标题就是用户认得的那个词。
 * 两处各写一份必然漂移——运营在角色页勾的"人员管理"和侧边栏显示的"人员档案"
 * 对不上时，没人分得清哪个是对的。
 *
 * 附带的好处：新增一个带 `permission` 的菜单项，这里**自动**多出一个可勾选项，
 * 不会出现"页面上线了但权限点忘了配"。`nav.test.ts` 盯着覆盖面。
 *
 * 「工作台」不出现在这里——它没有 `permission`（登录落地页，谁都得能进）。
 */
export function PermissionPicker({
  value,
  onChange,
  disabled,
}: {
  value: PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled?: boolean;
}) {
  const toggle = (permission: PermissionKey, checked: boolean) => {
    onChange(
      checked
        ? [...value, permission]
        : value.filter((item) => item !== permission),
    );
  };

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
      {navMain.map((item) => {
        // 分组项（系统管理、项目管理）把标题当小标题，子项逐个勾。
        if ("children" in item) {
          return (
            <fieldset key={item.title} className="flex flex-col gap-2">
              <legend className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
                <item.icon className="size-3.5" />
                {item.title}
              </legend>
              {item.children.map((child) => (
                <PermissionRow
                  key={child.permission}
                  label={child.title}
                  permission={child.permission}
                  checked={value.includes(child.permission)}
                  disabled={disabled}
                  onToggle={toggle}
                />
              ))}
            </fieldset>
          );
        }

        // 没有 permission 的单项只有「工作台」，它不是可配置的权限点。
        if (!item.permission) return null;

        return (
          <PermissionRow
            key={item.permission}
            label={item.title}
            permission={item.permission}
            checked={value.includes(item.permission)}
            disabled={disabled}
            icon={<item.icon className="size-3.5 text-muted-foreground" />}
            onToggle={toggle}
          />
        );
      })}
    </div>
  );
}

function PermissionRow({
  label,
  permission,
  checked,
  disabled,
  icon,
  onToggle,
}: {
  label: string;
  permission: PermissionKey;
  checked: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  onToggle: (permission: PermissionKey, checked: boolean) => void;
}) {
  const id = `permission-${permission}`;
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onToggle(permission, next === true)}
      />
      <Label
        htmlFor={id}
        className={cn(
          "flex items-center gap-1.5 font-normal text-sm",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        {icon}
        {label}
      </Label>
    </div>
  );
}
