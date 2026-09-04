/**
 * 页面上**没有真实数据来源**的那几项。
 *
 * 这一版的口径是「有的接真实，没有的用静态占位并在界面上标注」，所以这些值
 * 就是写死的常量 —— 服务端不返回它们，接口约定里也没有它们。哪天某一项有了
 * 真实来源，做法是：给 `/api/h5/getItinerary` 加字段、删掉这里对应的常量，
 * 两步之间不会有"接口有了但页面还在读常量"的中间态。
 *
 * ## 为什么是这几项（逐个查过库）
 *
 * | 这里的常量 | 库里的情况 |
 * | --- | --- |
 * | `PLACEHOLDER_CONTACT` | 只有 `owner_name` 纯文本，**没有电话列** |
 * | `PLACEHOLDER_TRANSIT_MINUTES` | `activity_resource` 上没有车程 |
 * | `PLACEHOLDER_TICKET_*` | `member_trip` 只有车次 / 起讫点 / 起讫时刻 |
 * | `PLACEHOLDER_GROUP_SEAT_NOTE` | 无。排位有整区分配给团体，语义不是这个 |
 *
 * 还有一项**不在这里**：地图导航。全库没有任何经纬度列（`venue` / `activity`
 * 都只有地址文本），而占位坐标点下去会直接把人导到错误的地点 —— 见下面这条
 * 规则，所以导航按钮整个不渲染，只留地址文字。
 *
 * ## 铁律：占位数据可以被看见，不可以被点击执行
 *
 * 纯展示的占位（车程、票面座位、同行人座位）标注一下就完事，假的代价只是
 * 难看。但**会在物理世界产生后果的不行**：
 *
 * - 占位电话若做成 `tel:` 链接，嘉宾点一下就真的打给某个陌生人。所以下面这个
 *   号码刻意写成**脱敏形态**（`138****0011`），既保住版式又不可能被人工转抄
 *   出一个能拨通的号；渲染时也不套 `<a href="tel:">`。
 * - 占位坐标会把人送错地方，且人一旦跳出 App，标注就不在他眼前了。
 *
 * 页面上真实的司机电话（`activity_resource.driver_phone`）**是可拨的**，这两类
 * 电话在同一屏上，组件里靠 `placeholder` 这个 prop 区分，别混。
 */

/** 现场联系人。电话是脱敏形态且不可拨，理由见文件头。 */
export const PLACEHOLDER_CONTACT = {
  name: "林晓彤",
  phone: "138****0011",
} as const;

/** 用车的路程预计（分钟）。 */
export const PLACEHOLDER_TRANSIT_MINUTES = 40;

/** 火车票面。 */
export const PLACEHOLDER_TRAIN_SEAT = "二等座 05车08A";
export const PLACEHOLDER_TRAIN_GATE = "检票口 3A";

/** 机票票面。 */
export const PLACEHOLDER_FLIGHT_SEAT = "经济舱 32C";
export const PLACEHOLDER_FLIGHT_GATE = "登机口 B12";

/** 同行人座位说明。只挂在本人确实有座位的那几场上，否则没有意义。 */
export const PLACEHOLDER_GROUP_SEAT_NOTE = "您的团体成员座位安排在 5排03-05座";
