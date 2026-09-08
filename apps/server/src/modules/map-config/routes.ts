import { Hono } from "hono";
import { ok } from "../../shared/result";
import { type AuthedVariables, requireUser } from "../auth";
import { getBaiduMapAk } from "./baidu-map";

/**
 * 地图供应商的浏览器端配置。
 *
 * AK 不是保密凭据，浏览器加载百度 JSAPI 时本来就会携带它；接口仍要求后台登录，
 * 使未登录访问无法拿到部署配置。该模块不映射单一权限点：议程和资源台账都会打开
 * 选点，拥有任一活动工作流权限的用户均需读取它。
 */
export const mapConfigRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /** 供管理端地图选点组件按需加载浏览器端 AK。 */
  .post("/getBaiduMapAk", (c) => c.json(ok({ ak: getBaiduMapAk() })));
