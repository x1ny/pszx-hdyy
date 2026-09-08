import { z } from "zod";

/** 沿用百度默认 BD-09；经纬度与坐标系作为一个整体保存。 */
export const LocationPointSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  name: z.string().trim().min(1, "请填写定位点名称").max(255),
  address: z.string().trim().max(500),
  coordinateSystem: z.literal("bd09ll"),
  provider: z.literal("baidu"),
});

export type LocationPoint = z.infer<typeof LocationPointSchema>;
