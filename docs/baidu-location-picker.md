# 百度地图选点

资源台账和环节配置的用车安排均支持地图选点、地址搜索、拖动标记微调、重新选点和清除定位。地图弹窗点击「确认选点」只更新表单草稿，资源或环节保存后才写入数据库。取消地图弹窗不修改已有定位。

集合说明 `location` 保持可自由编辑；地图信息另存到 `activity_resource.location_point`（可空 JSONB），包含 `longitude`、`latitude`、`name`、`address`、`coordinateSystem: "bd09ll"`、`provider: "baidu"`。逆地理编码只补充地址，不把点击坐标替换成附近 POI 的中心。旧数据不自动地理编码。旧客户端省略字段时保留原值，显式传 `null` 才清除定位。资源切换类型时保留地点及定位，已有定位仍可修改和清除。

## 本地配置

1. 在[百度地图控制台](https://lbsyun.baidu.com/apiconsole/key)创建或选择**浏览器端**应用，开启 JavaScript API；服务端 AK 无法加载 JSAPI。
2. Referer 白名单加入本地调试使用的地址（如 `localhost`、`127.0.0.1`，格式以控制台为准），正式使用时加入实际管理端域名。
3. 复制 `apps/web/.env.example` 为 `apps/web/.env.local`，填写 `VITE_BAIDU_MAP_AK`，重启开发服务。

浏览器 AK 会出现在网页网络请求中，应依靠白名单限制来源；不要把服务端密钥填到这里。没有 AK 或地图加载失败时仍可按原方式填写集合说明并保存。

## 构建和发布

AK 是 Vite **构建时配置**。本地 `bun run build` 会读取 `apps/web/.env.local`；Docker 构建不会复制本地 env 文件，需要传 `--build-arg VITE_BAIDU_MAP_AK` 并设置同名环境变量。`bun run docker:build-push` 已支持转发该环境变量。

同一个浏览器 AK 的白名单可包含多个环境域名，同一镜像可在这些环境复用。更换 AK 需要重新构建；只给运行中的容器设置环境变量不会改变已生成的前端资源。数据库迁移随镜像启动执行，新增可空列，不影响已有数据。

## 移动端衔接

用车行程接口返回 `locationPoint` 后，H5 只在该字段存在时显示「导航」按钮；旧记录和仅填写文字集合说明的记录不显示按钮。点击后可选择百度地图或高德地图：百度先尝试原生 URI，未离开当前页面时自动转到 HTTPS 网页地图；高德使用其支持 `callnative=1` 的 HTTPS URI。两者在未安装时都会继续在浏览器打开地图路线。无需在 H5 申请或配置地图 AK。

后台保存的是百度 BD-09 坐标。百度 URI 显式传 `coord_type=bd09ll`；高德 URI 在浏览器本地换算为 GCJ-02 后再传，不能把 BD-09 直接当作 GCJ-02 或 WGS84。

苹果地图只在 iPhone、iPad 上显示，使用 Apple Maps URL 唤起系统地图，无需 Key 或后台配置。H5 会将 BD-09 依次换算为 GCJ-02、WGS-84，再按纬度、经度传入苹果地图；iPadOS 桌面模式也会被识别为 iPad。

## 官方参考

- [JSAPI 4.0 准备工作](https://lbs.baidu.com/docs/jsapi?title=jsapi4/quickstart/prepare)
- [百度地图调起 API（Web 端）](https://lbsyun.baidu.com/docs/webapi?title=mapadjustment%2Furi%2Fweb)
- [高德 URI API：路径规划](https://lbs.amap.com/api/uri-api/guide/travel/route)
- [Apple Maps URLs：路线](https://developer.apple.com/documentation/mapkit/unified-map-urls)
- [GCJ-02 坐标模式](https://lbs.baidu.com/docs/jsapi?title=jsapi4/guide/map/gcj02)
- [LocalSearch 搜索](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.LocalSearch.html)
- [Geocoder 逆地理编码](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.Geocoder.html)

个人账户的认证、免费配额及用途限制以百度控制台实时显示和平台协议为准；本功能不创建付费订单或自动升级配额。

## 联调注意事项

地图弹窗使用 margin 自动居中，不能恢复 translate 居中或缩放动画：百度 SDK 点击事件的像素计算不计入父节点 transform，会导致明显偏移。另在本次 JSAPI 4.0 实测中，GCJ-02 模式的搜索结果与 click 事件返回的坐标系不一致，因此统一沿用 SDK 默认 BD-09，避免保存混合坐标。后续修改必须在真实浏览器验证搜索选点、地图点击、标记拖动和重新打开后的落点一致。
