// 本地图片读不出来时显示在图片位置（PRD 7.3：失败要说明，不能一直空着）
export function MissingImage() {
  return <span className="px-3 text-center text-label text-bad">图片读不出来（这个浏览器里的数据可能被清理过）</span>;
}
