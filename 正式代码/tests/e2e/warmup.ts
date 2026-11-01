// 开发服务器第一次打开每个页面时才编译，编译中会刷新页面、打断测试；先把要用到的页面都请求一遍
export default async function warmup() {
  const base = 'http://localhost:3100';
  for (const path of ['/', '/works', '/works/warmup', '/scenes', '/style', '/history', '/api/config']) {
    const res = await fetch(base + path);
    await res.arrayBuffer();
  }
}
