// 返回空响应，用于拦截浏览器 Vite 扩展的 /@vite/client 请求
export const dynamic = 'force-dynamic'

export function GET() {
  return new Response('', {
    status: 200,
    headers: { 'Content-Type': 'text/javascript' },
  })
}
