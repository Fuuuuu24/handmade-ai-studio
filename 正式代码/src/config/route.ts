import type { Route } from '@/domain/types';

// 资产路线默认值（PRD 4.3）：A 先做白底再生成（Q14 确认的流程），B 原图直接作参考图。
// 默认值由产品内 A/B 对比决定，改默认需发起人确认。白底在开发第 5 步接入，接入前暂用 B，接入后恢复 A。
export const DEFAULT_ROUTE: Route = 'B';
