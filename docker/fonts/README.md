# 邀请函转换字体

将部署环境获准使用的完整 TTF/OTF/TTC 字体放在本目录，Docker 构建会复制到应用镜像并刷新字体缓存。字体文件不提交 Git；安装或更新后重新构建部署应用镜像，并重新比对真实模板。CI 构建需事先将同一份字体放到本目录。

当前模板使用方正小标宋、仿宋、黑体、楷体等。镜像默认安装 Noto CJK，并在 [字体回退配置](../invitation-fonts.conf) 中覆盖宋体、仿宋、黑体、楷体、微软雅黑、等线、微软正黑、明体及常见 macOS/Office 名称。普通字体按“完整原字体 → 同类微软字体 → 相近中文字体 → Noto Serif/Sans CJK”执行；未授权的方正系列按“相似微软字体 → 相近中文字体 → Noto”强制平替：方正小标宋简体 → 宋体/SimSun → Noto Serif CJK SC，方正仿宋 → 仿宋/FangSong → SimSun → Noto Serif CJK SC，方正黑体 → 黑体/SimHei → Microsoft YaHei → Noto Sans CJK SC。

当前 Windows 构建上下文可接入的微软中文字体文件包括：`simsun.ttc`、`simfang.ttf`、`simhei.ttf`、`simkai.ttf`、`msyh.ttc`（含 `msyhbd.ttc` / `msyhl.ttc`）、`Deng.ttf`（含 `Dengb.ttf` / `Dengl.ttf`）、`msjh.ttc`（含粗体/浅体）和 `mingliub.ttc`。其中 `simsunb.ttf`、`SimsunExtG.ttf` 用于宋体粗体和扩展字形。文件由构建机提供，不提交 Git。

回退只保证中文字符可读和跨服务器结果稳定，不能让替代字体的字形、字宽与 Word 原版完全相同。若要求与 Word 原版一致，仍需把有服务器/容器使用授权的完整字体放入本目录。没有授权的方正等商业字体不要复制进镜像；仅保留字体名称，让配置按相似字形类别平替。模板内嵌入的子集字体未必包含新姓名中的字，不能替代完整字体。

部署与超时配置见 [Docker 流程](../README.md)。
