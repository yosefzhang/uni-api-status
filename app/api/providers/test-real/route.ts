import { type NextRequest, NextResponse } from "next/server"
import fs from "fs"
import yaml from "js-yaml"

// 支持的测试端点
const SUPPORTED_ENDPOINTS = ["chat/completions", "responses", "messages"] as const

// 将 base_url 归一化为“根地址”：去掉可能存在的协议端点后缀，
// 之后再由用户选择的端点重新拼接目标 URL。
function resolveBaseRoot(baseUrl: string): string {
  let root = (baseUrl || "").replace(/\/+$/, "")
  const suffixes = ["/chat/completions", "/v1/messages", "/completions", "/responses", "/messages"]
  for (const s of suffixes) {
    if (root.endsWith(s)) {
      root = root.slice(0, -s.length)
      break
    }
  }
  return root
}

// 真实测试：可对 uni-api 网关或任一上游渠道发起一次真实请求，
// 并按所选端点构造请求体与鉴权头，回传请求与响应详情。
export async function POST(request: NextRequest) {
  try {
    const { apiKey, baseUrl, api, model, endpoint } = await request.json()

    if (!apiKey || !api || !model) {
      return NextResponse.json(
        { success: false, message: "缺少必要参数 (apiKey / api / model)" },
        { status: 400 },
      )
    }

    // 校验当前登录 Key
    const apiYamlPath = process.env.API_YAML_PATH || "/app/data/api.yaml"

    if (!fs.existsSync(apiYamlPath)) {
      return NextResponse.json({ success: false, message: "配置文件未找到" }, { status: 500 })
    }

    const yamlContent = fs.readFileSync(apiYamlPath, "utf8")
    const config = yaml.load(yamlContent) as any
    const keyEntry = (config.api_keys || []).find((entry: any) => entry.api === apiKey)

    if (!keyEntry) {
      return NextResponse.json({ success: false, message: "未授权" }, { status: 403 })
    }

    const ep =
      typeof endpoint === "string" && SUPPORTED_ENDPOINTS.includes(endpoint as any)
        ? endpoint
        : "chat/completions"

    // 基地址：baseUrl 为空时回退到 uni-api 网关地址
    const gatewayBase = (process.env.UNI_API_BASE_URL || "http://localhost:9210/v1").replace(/\/+$/, "")
    const root = baseUrl ? resolveBaseRoot(baseUrl) : gatewayBase
    const url = `${root}/${ep}`

    const testText = "真实测试，请回复 ok"

    // responses 使用 input 结构，其余使用 messages
    const body =
      ep === "responses"
        ? {
            model,
            input: [{ role: "user", content: [{ type: "input_text", text: testText }] }],
          }
        : {
            model,
            messages: [{ role: "user", content: testText }],
          }

    // messages（Anthropic）使用 x-api-key，其余使用 Bearer
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (ep === "messages") {
      headers["x-api-key"] = api
      headers["anthropic-version"] = "2023-06-01"
    } else {
      headers["Authorization"] = `Bearer ${api}`
    }

    const requestInfo = { method: "POST", url, headers, body }

    const startTime = Date.now()
    let status = 0
    let responseBody = ""

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      status = res.status
      responseBody = await res.text()
    } catch (error: any) {
      const responseTime = (Date.now() - startTime) / 1000
      return NextResponse.json({
        success: false,
        message: error.name === "TimeoutError" ? "请求超时(60s)" : `网络错误: ${error.message}`,
        responseTime,
        request: requestInfo,
        response: { status, body: responseBody },
      })
    }

    const responseTime = (Date.now() - startTime) / 1000

    return NextResponse.json({
      success: status >= 200 && status < 300,
      message: status >= 200 && status < 300 ? "测试成功" : `HTTP ${status}`,
      responseTime,
      request: requestInfo,
      response: { status, body: responseBody },
    })
  } catch (error) {
    console.error("Error in real test:", error)
    return NextResponse.json({ success: false, message: "内部服务器错误" }, { status: 500 })
  }
}