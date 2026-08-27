import { type NextRequest, NextResponse } from "next/server"
import fs from "fs"
import yaml from "js-yaml"

// 将渠道 base_url 推导为对应的模型列表端点
function baseUrlToModelsUrl(base_url: string): string {
  if (base_url.endsWith("/v1/messages")) {
    return base_url.slice(0, -"/messages".length) + "/models"
  }
  if (base_url.endsWith("/chat/completions")) {
    return base_url.slice(0, -"/chat/completions".length) + "/models"
  }
  if (base_url.endsWith("/completions")) {
    return base_url.slice(0, -"/completions".length) + "/models"
  }
  if (base_url.endsWith("/responses")) {
    return base_url.slice(0, -"/responses".length) + "/models"
  }
  if (base_url.endsWith("/messages")) {
    return base_url.slice(0, -"/messages".length) + "/models"
  }
  return base_url.replace(/\/$/, "") + "/models"
}

export async function POST(request: NextRequest) {
  try {
    const { apiKey, base_url, api } = await request.json()

    if (!apiKey || !base_url || !api) {
      return NextResponse.json(
        { success: false, message: "缺少必要参数" },
        { status: 400 },
      )
    }

    // 校验管理面板登录 Key
    const apiYamlPath = process.env.API_YAML_PATH || "/app/data/api.yaml"

    if (!fs.existsSync(apiYamlPath)) {
      return NextResponse.json(
        { success: false, message: "配置文件未找到" },
        { status: 500 },
      )
    }

    const yamlContent = fs.readFileSync(apiYamlPath, "utf8")
    const config = yaml.load(yamlContent) as any

    const keyEntry = (config.api_keys || []).find((entry: any) => entry.api === apiKey)

    if (!keyEntry) {
      return NextResponse.json(
        { success: false, message: "未授权" },
        { status: 403 },
      )
    }

    // 渠道 api 可能是 string 或 string[]，取第一个
    const channelApi = Array.isArray(api) ? api[0] : api
    if (!channelApi) {
      return NextResponse.json(
        { success: false, message: "渠道未配置 API Key" },
        { status: 400 },
      )
    }

    const modelsUrl = baseUrlToModelsUrl(base_url)

    const headers: Record<string, string> = {}
    if (base_url.includes("/v1/messages")) {
      // Anthropic 格式
      headers["x-api-key"] = channelApi
      headers["anthropic-version"] = "2023-06-01"
    } else {
      // OpenAI 格式
      headers["Authorization"] = `Bearer ${channelApi}`
    }

    const response = await fetch(modelsUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return NextResponse.json({
        success: false,
        message: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
      })
    }

    const data = await response.json()

    // 兼容 OpenAI / Anthropic 的 data[].id，以及 models[] 与纯数组格式
    let list: string[] = []
    if (Array.isArray(data?.data)) {
      list = data.data
        .map((m: any) => (typeof m === "string" ? m : m?.id))
        .filter(Boolean)
    } else if (Array.isArray(data?.models)) {
      list = data.models
        .map((m: any) => (typeof m === "string" ? m : m?.id))
        .filter(Boolean)
    } else if (Array.isArray(data)) {
      list = data
        .map((m: any) => (typeof m === "string" ? m : m?.id))
        .filter(Boolean)
    }

    return NextResponse.json({ success: true, models: list })
  } catch (error: any) {
    console.error("Error fetching provider models:", error)
    return NextResponse.json(
      {
        success: false,
        message:
          error?.name === "TimeoutError"
            ? "请求超时(30s)"
            : `网络错误: ${error.message}`,
      },
      { status: 500 },
    )
  }
}