import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// ⚠️ 相对 shadcn registry 原版的改动（下次 `shadcn add sonner` 会覆盖掉，记得改回来）：
// 原版是 `const { theme = "system" } = useTheme()`（next-themes）。本项目**有意禁用
// 深色模式**（见 src/styles.css：只定义亮色 token，dark: 变体绑在一个永远不会出现的
// .dark class 上）。sonner 的 theme 是组件自己读系统偏好、自己加 class，绕过了那道
// 防线 —— 系统深色时 toast 会是黑的，页面其余部分是白的。
// 所以这里写死 light，并顺带去掉了 next-themes 依赖（本项目没有 ThemeProvider）。
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
