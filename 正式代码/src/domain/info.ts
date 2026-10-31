import { INFO_CORE, INFO_FIELDS, INFO_KEYS, INFO_REQUIRED, type CoreInfoKey, type InfoKey } from '@/config/info';
import type { Basis, Info } from './types';

export const emptyInfo = (): Info =>
  Object.fromEntries(INFO_KEYS.map((k) => [k, { value: '', unknown: false }])) as Info;

const filled = (info: Info, key: InfoKey) => info[key].value.trim() !== '' || info[key].unknown;

export const infoMissing = (info: Info): InfoKey[] => INFO_REQUIRED.filter((k) => !filled(info, k));

export const infoReady = (info: Info) => infoMissing(info).length === 0;

export const pendingSuggestions = (info: Info): InfoKey[] => INFO_KEYS.filter((k) => info[k].suggestion);

export const infoLabels = (keys: readonly InfoKey[]) => keys.map((k) => INFO_FIELDS[k].label).join('、');

// 只有已确认的值和「未知」进入提示词依据；待确认建议不算
export const coreInfoOf = (info: Info): Basis['info'] =>
  Object.fromEntries(
    INFO_CORE.map((k: CoreInfoKey) => [k, { value: info[k].value.trim(), unknown: info[k].unknown }]),
  ) as Basis['info'];
