import type { Route } from '@/domain/types';

// 资产路线默认值（PRD 4.3）：A 先做白底再生成（Q14 确认的流程），B 原图直接作参考图。
// 白底现在只有做法①（生图模型出白底），抠图按发起人决定先不接，默认暂用 B。
// 默认值由产品内 A/B 对比决定，改默认需发起人确认。
export const DEFAULT_ROUTE: Route = 'B';
