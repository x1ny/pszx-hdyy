// 转换边界测试专用子进程：验证实际 spawn、退出、取消与文件清理，不模拟全局 API。
import { open, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const [mode, marker, ...args] = process.argv.slice(2);
const directory = args[args.indexOf("--outdir") + 1];
if (!directory || !marker) throw new Error("missing test arguments");
await writeFile(marker, JSON.stringify({ directory, pid: process.pid, args }));
if (mode === "hang") await Bun.sleep(60_000);
if (mode === "failure") process.exit(1);
const inputs = args.filter((arg) => arg.endsWith(".docx"));
for (const [index, input] of inputs.entries()) {
  if (mode === "missing" && index === 1) continue;
  const output = join(directory, `${basename(input, ".docx")}.pdf`);
  if (mode === "large") {
    const file = await open(output, "w");
    await file.truncate(500 * 1024 * 1024 + 1);
    await file.close();
  } else {
    await writeFile(
      output,
      (mode === "invalid" ? "HTML" : "%PDF-1.7\n") +
        (await readFile(input, "utf8")),
    );
  }
}
