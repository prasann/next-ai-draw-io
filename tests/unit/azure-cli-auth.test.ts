// @vitest-environment node
import { generateText } from "ai"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PROVIDER_NAMES } from "@/lib/providers"

const identity = vi.hoisted(() => ({
    options: vi.fn(),
    getToken: vi.fn(),
}))

vi.mock("@azure/identity", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@azure/identity")>()
    return {
        ...actual,
        AzureCliCredential: class {
            constructor(options: unknown) {
                identity.options(options)
            }
            getToken = identity.getToken
        },
    }
})

vi.mock("@/lib/admin/settings", () => ({
    loadSettings: () => ({}),
    getEnvFallback: (key: string) => process.env[key] ?? null,
}))

const baseURL = "https://test-resource.openai.azure.com/openai"
const response = () =>
    Response.json({
        id: "response-test",
        created_at: 1,
        model: "test-deployment",
        output: [
            {
                type: "message",
                id: "message-test",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "ok", annotations: [] }],
            },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })

beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    for (const p of PROVIDER_NAMES) {
        vi.stubEnv(`${p.toUpperCase()}_API_KEY`, undefined)
    }
    for (const key of [
        "AI_PROVIDER",
        "AZURE_BASE_URL",
        "AZURE_TENANT_ID",
        "ANTHROPIC_AUTH_TOKEN",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "GOOGLE_VERTEX_API_KEY",
        "AI_GATEWAY_API_KEY",
        "NEXT_AI_DRAWIO_DESKTOP",
    ]) {
        vi.stubEnv(key, undefined)
    }
    vi.stubEnv("AZURE_AUTH_MODE", "azure-cli")
    vi.stubEnv("AZURE_RESOURCE_NAME", "test-resource")
    vi.stubEnv("AI_MODEL", "test-deployment")
    identity.getToken.mockReset().mockResolvedValue({
        token: "fake-azure-test-token",
        expiresOnTimestamp: Date.now() + 3_600_000,
    })
})

describe("Azure CLI server authentication", () => {
    it("auto-detects keyless Azure and sends bearer auth, never a residual server key", async () => {
        vi.stubEnv("AZURE_API_KEY", "unused-server-key")
        const send = vi.fn().mockImplementation(response)
        vi.stubGlobal("fetch", send)
        const { getAIModel, getServerProvider, usesServerCredentials } =
            await import("@/lib/ai-providers")
        expect(getServerProvider()).toBe("azure")
        expect(usesServerCredentials("azure")).toBe(true)
        const { model, provider } = getAIModel()
        expect(provider).toBe("azure")
        expect(identity.getToken).not.toHaveBeenCalled()
        expect((await generateText({ model, prompt: "test" })).text).toBe("ok")
        const [url, init] = send.mock.calls[0]
        expect(String(url)).toContain(`${baseURL}/v1/responses`)
        const headers = new Headers(init.headers)
        expect(headers.get("authorization")).toBe(
            "Bearer fake-azure-test-token",
        )
        expect(headers.has("api-key")).toBe(false)
        expect(init.redirect).toBe("error")
        expect(identity.getToken).toHaveBeenCalledWith(
            ["https://cognitiveservices.azure.com/.default"],
            expect.any(Object),
        )
        expect(identity.options).toHaveBeenCalledWith({
            processTimeoutInMs: 10_000,
        })
        await generateText({ model, prompt: "second request" })
        expect(identity.getToken).toHaveBeenCalledTimes(1)
    })

    it("refreshes expired tokens using the SDK bearer provider", async () => {
        identity.getToken
            .mockResolvedValueOnce({
                token: "expired-test-token",
                expiresOnTimestamp: Date.now() - 1000,
            })
            .mockResolvedValue({
                token: "refreshed-test-token",
                expiresOnTimestamp: Date.now() + 3_600_000,
            })
        vi.stubGlobal("fetch", vi.fn().mockImplementation(response))
        const { azureCliSettings } = await import("@/lib/azure-cli-auth")
        const token = azureCliSettings(baseURL).tokenProvider
        expect(await token?.()).toBe("expired-test-token")
        expect(await token?.()).toBe("refreshed-test-token")
        expect(identity.getToken).toHaveBeenCalledTimes(2)
    })

    it("uses an explicit tenant and a server model's own URL variable", async () => {
        vi.stubEnv("AZURE_TENANT_ID", "test-tenant")
        vi.stubEnv("TEAM_AZURE_URL", "https://team.openai.azure.com/openai")
        vi.stubGlobal("fetch", vi.fn().mockImplementation(response))
        const { getAIModel } = await import("@/lib/ai-providers")
        const { model } = getAIModel({
            provider: "azure",
            baseUrlEnv: "TEAM_AZURE_URL",
            apiKeyEnv: ["MISSING_KEY"],
        })
        await generateText({ model, prompt: "test" })
        expect(identity.options).toHaveBeenCalledWith({
            tenantId: "test-tenant",
            processTimeoutInMs: 10_000,
        })
        expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(
            "https://team.openai.azure.com/openai/v1/responses",
        )
    })

    it("uses the base URL before the resource name", async () => {
        vi.stubEnv("AZURE_BASE_URL", "https://other.openai.azure.com/openai/v1")
        vi.stubEnv("AZURE_RESOURCE_NAME", "invalid.resource")
        const send = vi.fn().mockImplementation(response)
        vi.stubGlobal("fetch", send)
        const { getAIModel } = await import("@/lib/ai-providers")
        await generateText({ model: getAIModel().model, prompt: "test" })
        expect(String(send.mock.calls[0][0])).toContain(
            "https://other.openai.azure.com/openai/v1/responses",
        )
    })

    it("preserves client API-key authentication in CLI mode", async () => {
        const send = vi.fn().mockImplementation(response)
        vi.stubGlobal("fetch", send)
        const { getAIModel, usesServerCredentials } = await import(
            "@/lib/ai-providers"
        )
        const overrides = {
            provider: "azure",
            apiKey: "client-test-key",
            baseUrl: baseURL,
        }
        expect(usesServerCredentials("azure", overrides)).toBe(false)
        await generateText({
            model: getAIModel(overrides).model,
            prompt: "test",
        })
        const headers = new Headers(send.mock.calls[0][1].headers)
        expect(headers.get("api-key")).toBe("client-test-key")
        expect(headers.has("authorization")).toBe(false)
        expect(identity.getToken).not.toHaveBeenCalled()
    })

    it("preserves server API-key authentication by default", async () => {
        vi.stubEnv("AZURE_AUTH_MODE", undefined)
        vi.stubEnv("AZURE_API_KEY", "server-test-key")
        const send = vi.fn().mockImplementation(response)
        vi.stubGlobal("fetch", send)
        const { getAIModel } = await import("@/lib/ai-providers")
        await generateText({ model: getAIModel().model, prompt: "test" })
        expect(new Headers(send.mock.calls[0][1].headers).get("api-key")).toBe(
            "server-test-key",
        )
        expect(identity.getToken).not.toHaveBeenCalled()
    })

    it("rejects keyless browser URL overrides, including the internal trusted flag", async () => {
        const { getAIModel } = await import("@/lib/ai-providers")
        for (const trustedBaseUrl of [false, true]) {
            expect(() =>
                getAIModel({
                    provider: "azure",
                    baseUrl: "https://attacker.example",
                    trustedBaseUrl,
                }),
            ).toThrow(/API key|server-configured endpoint/)
        }
        expect(identity.getToken).not.toHaveBeenCalled()
    })

    it("does not send tokens to a different origin and forces redirect rejection", async () => {
        const send = vi
            .fn()
            .mockResolvedValue(new Response(null, { status: 302 }))
        vi.stubGlobal("fetch", send)
        const { azureCliSettings } = await import("@/lib/azure-cli-auth")
        const guarded = azureCliSettings(baseURL).fetch
        expect(() => guarded?.("https://attacker.example", {})).toThrow(
            /configured endpoint/,
        )
        expect(send).not.toHaveBeenCalled()
        await guarded?.(`${baseURL}/v1/responses`, { redirect: "follow" })
        expect(send.mock.calls[0][1].redirect).toBe("error")
    })

    it.each([
        "http://test-resource.openai.azure.com/openai",
        "https://user:password@example.com/openai",
        "https://example.com/openai?secret=1",
        "https://example.com/openai#fragment",
        "not-a-url",
    ])("rejects invalid server endpoints: %s", async (url) => {
        vi.stubEnv("AZURE_BASE_URL", url)
        const { getAIModel } = await import("@/lib/ai-providers")
        expect(() => getAIModel({ provider: "azure" })).toThrow(/HTTPS/)
        expect(identity.getToken).not.toHaveBeenCalled()
    })

    it.each([undefined, "bad.resource", "bad-", "a".repeat(64)])(
        "requires a valid resource or endpoint: %s",
        async (resource) => {
            vi.stubEnv("AZURE_RESOURCE_NAME", resource)
            const { getAIModel } = await import("@/lib/ai-providers")
            expect(() => getAIModel({ provider: "azure" })).toThrow(
                /AZURE_BASE_URL|AZURE_RESOURCE_NAME/,
            )
        },
    )

    it("rejects unknown modes", async () => {
        vi.stubEnv("AZURE_AUTH_MODE", "automatic")
        const { getAIModel } = await import("@/lib/ai-providers")
        expect(() => getAIModel({ provider: "azure" })).toThrow(
            /AZURE_AUTH_MODE/,
        )
    })

    it.each([
        ["Azure CLI could not be found.", "Install Azure CLI"],
        ["Please run az login; account-private-details", "Run az login"],
        [
            "network connection timed out; account-private-details",
            "Check connectivity",
        ],
    ])("reports actionable sanitized CLI failures: %s", async (error, hint) => {
        identity.getToken.mockRejectedValue(new Error(error))
        const { azureCliSettings } = await import("@/lib/azure-cli-auth")
        const token = azureCliSettings(baseURL).tokenProvider
        await expect(token?.()).rejects.toThrow(hint)
        await expect(token?.()).rejects.not.toThrow("account-private-details")
        identity.getToken.mockResolvedValue({
            token: "recovered-test-token",
            expiresOnTimestamp: Date.now() + 3_600_000,
        })
        expect(await token?.()).toBe("recovered-test-token")
    })
})
