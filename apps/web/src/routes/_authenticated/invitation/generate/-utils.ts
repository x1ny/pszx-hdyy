/** 排版用的手机号打码，不是权限控制——完整号码就在同一个响应体里。 */
export const maskMobile = (mobile?: string | null) => {
  if (!mobile) return "-";
  return mobile.length < 7 ? mobile : `${mobile.slice(0, 3)}****${mobile.slice(-4)}`;
};
