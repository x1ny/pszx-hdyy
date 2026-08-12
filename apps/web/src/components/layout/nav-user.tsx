import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { sessionQueryKey } from "#/lib/session.ts";

export function NavUser({ name, email }: { name: string; email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
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
              {email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
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
  );
}
