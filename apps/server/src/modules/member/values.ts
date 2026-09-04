import {
  findCity,
  findCountryRegion,
  findProvince,
} from "../../shared/dict/regions";

/** 把权威字典码翻成写入人员主档的中文名快照。 */
export const memberRegionNames = (input: {
  countryRegionCode: string | null;
  nativeProvinceCode: string | null;
  nativeCityCode: string | null;
}) => ({
  countryRegion: findCountryRegion(input.countryRegionCode)?.name ?? null,
  nativeProvince: findProvince(input.nativeProvinceCode)?.name ?? null,
  nativeCity: findCity(input.nativeCityCode)?.name ?? null,
});
