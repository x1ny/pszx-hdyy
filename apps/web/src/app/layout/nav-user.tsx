import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/features/auth/auth-client.ts";
import { ChangePasswordDialog } from "#/features/auth/change-password-dialog.tsx";
import { sessionQueryKey } from "#/features/auth/queries.ts";
import { Avatar, AvatarFallback } from "#/shared/components/ui/avatar.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/shared/components/ui/dropdown-menu.tsx";

export function NavUser({
  name,
  /**
   * 登录账号。可空是因为**关闭自助注册之前注册的老账号没有这一列**——它们登录
   * 不了（登录走 username），但如果还持有有效 session 就仍然能进来。
   */
  username,
}: {
  name: string;
  username?: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" className="h-9 gap-2 pr-2 pl-1" />}
        >
          <Avatar className="size-7">
            <AvatarFallback>
              <UserRound />
            </AvatarFallback>
          </Avatar>
          <span className="max-w-32 truncate">{name}</span>
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" sideOffset={8}>
          {/* Label 必须包在 Group 里，Base UI 的 Menu.GroupLabel 依赖 MenuGroupContext。 */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {username ?? "未设置登录账号"}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
              <KeyRound />
              修改密码
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      // 必须 remove 而不是 invalidate：守卫用的是 ensureQueryData，
                      // 过期缓存也会被直接返回。
                      queryClient.removeQueries({ queryKey: sessionQueryKey });
                      navigate({ to: "/login" });
                    },
                  },
                })
              }
            >
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 挂在菜单外面：DropdownMenu 关闭时会卸载它的 Content，弹窗挂在里面会跟着
        一起消失。 */}
      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </>
  );
}
