import { INFO_CORE, INFO_FIELDS, INFO_KEYS, INFO_REQUIRED, type CoreInfoKey, type InfoKey } from '@/config/info';
import type { BackdropBasis, CoreInfoBasis, Info } from './types';

export const emptyInfo = (): Info =>
  Object.fromEntries(INFO_KEYS.map((k) => [k, { value: '', unknown: false }])) as Info;

const filled = (info: Info, key: InfoKey) => info[key].value.trim() !== '' || info[key].unknown;

export const infoMissing = (info: Info, keys: readonly InfoKey[] = INFO_REQUIRED): InfoKey[] => keys.filter((k) => !filled(info, k));

export const infoReady = (info: Info) => infoMissing(info).length === 0;


// 核心信息里还有小间的建议没处理（接受或忽略）：保真相关的内容还没生效，信息这一步不算完成（BC-002）。
// 售价、目标顾客是选填（AC-03.3），它们的建议不挡这一步
export const pendingCore = (info: Info): CoreInfoKey[] => INFO_CORE.filter((k) => !!info[k].suggestion);

export const infoDone = (info: Info) => infoReady(info) && pendingCore(info).length === 0;

export const infoLabels = (keys: readonly InfoKey[]) => keys.map((k) => INFO_FIELDS[k].label).join('、');

// 只有已确认的值和「未知」进入提示词依据；待确认建议不算
export const coreInfoOf = (info: Info): CoreInfoBasis =>
  Object.fromEntries(
    INFO_CORE.map((k: CoreInfoKey) => [k, { value: info[k].value.trim(), unknown: info[k].unknown }]),
  ) as CoreInfoBasis;

// 背景提示词只用品类和尺寸：按它们留出主体位置和台面（技术写法 13.4）
export const BACKDROP_INFO = ['category', 'size'] as const satisfies readonly CoreInfoKey[];

export const backdropInfoOf = (info: Info): BackdropBasis['info'] => {
  const core = coreInfoOf(info);
  return { category: core.category, size: core.size };
};
