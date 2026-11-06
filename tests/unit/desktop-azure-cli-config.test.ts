// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AzureCliConfigSchema } from "@/lib/types/azure-cli-config"

const disk = vi.hoisted(() => ({
    content: undefined as string | undefined,
    write: vi.fn(),
    rename: vi.fn(),
}))
vi.mock("electron", () => ({
    app: { getPath: () => "/desktop-user-data" },
}))
vi.mock("node:fs", () => ({
    default: {
        readFileSync: () => {
            if (disk.content === undefined) {
                throw Object.assign(new Error("missing"), { code: "ENOENT" })
            }
            return disk.content
        },
        mkdirSync: vi.fn(),
        writeFileSync: disk.write,
        renameSync: disk.rename,
    },
}))

const config = {
    enabled: true,
    baseUrl: "https://test.openai.azure.com/openai",
    deployment: "my-deployment",
    tenantId: "test-tenant",
}
const envKeys = [
    "AI_PROVIDER",
    "AI_MODEL",
    "AI_MODELS_CONFIG",
    "AZURE_AUTH_MODE",
    "AZURE_BASE_URL",
    "AZURE_RESOURCE_NAME",
    "AZURE_TENANT_ID",
    "AZURE_API_KEY",
]

beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    disk.content = undefined
    for (const key of envKeys) vi.stubEnv(key, undefined)
})

describe("native desktop Azure CLI configuration", () => {
    it("loads prior .env configuration without exposing API keys", async () => {
        vi.stubEnv("AZURE_AUTH_MODE", "azure-cli")
        vi.stubEnv("AZURE_RESOURCE_NAME", "env-resource")
        vi.stubEnv("AI_PROVIDER", "azure")
        vi.stubEnv("AI_MODEL", "env-deployment,another")
        vi.stubEnv("AZURE_API_KEY", "private-key")
        const { getAzureCliConfig } = await import(
            "../../electron/main/azure-cli-config"
        )
        expect(getAzureCliConfig()).toEqual({
            enabled: true,
            baseUrl: "https://env-resource.openai.azure.com/openai",
            deployment: "env-deployment",
            tenantId: "",
        })
    })

    it("persists only configuration atomically with private file permissions", async () => {
        const { saveAzureCliConfig } = await import(
            "../../electron/main/azure-cli-config"
        )
        saveAzureCliConfig({
            ...config,
            apiKey: "not-persisted",
            token: "not-persisted",
        })
        expect(disk.write).toHaveBeenCalledWith(
            "/desktop-user-data/azure-cli-config.json.tmp",
            JSON.stringify(config, null, 2),
            { mode: 0o600 },
        )
        expect(disk.rename).toHaveBeenCalledWith(
            "/desktop-user-data/azure-cli-config.json.tmp",
            "/desktop-user-data/azure-cli-config.json",
        )
    })

    it("applies saved configuration on relaunch and offers the correct server model", async () => {
        disk.content = JSON.stringify(config)
        const { applyAzureCliConfig, azureCliModelId } = await import(
            "../../electron/main/azure-cli-config"
        )
        applyAzureCliConfig()
        expect(process.env.AZURE_AUTH_MODE).toBe("azure-cli")
        expect(process.env.AZURE_BASE_URL).toBe(config.baseUrl)
        expect(process.env.AZURE_TENANT_ID).toBe(config.tenantId)
        expect(process.env.AI_PROVIDER).toBe("azure")
        expect(process.env.AI_MODEL).toBe(config.deployment)
        expect(JSON.parse(process.env.AI_MODELS_CONFIG || "{}")).toEqual({
            providers: [
                {
                    name: "Desktop Azure CLI",
                    provider: "azure",
                    models: [config.deployment],
                    default: true,
                },
            ],
        })
        expect(azureCliModelId(config.deployment)).toBe(
            "server:desktop-azure-cli:my-deployment",
        )
    })

    it("restores inherited provider configuration when API-key mode is applied", async () => {
        vi.stubEnv("AI_PROVIDER", "openai")
        vi.stubEnv("AI_MODEL", "gpt-4o")
        vi.stubEnv("AI_MODELS_CONFIG", '{"providers":[]}')
        vi.stubEnv("AZURE_TENANT_ID", "original-tenant")
        const { applyAzureCliConfig } = await import(
            "../../electron/main/azure-cli-config"
        )
        applyAzureCliConfig()
        disk.content = JSON.stringify(config)
        applyAzureCliConfig()
        disk.content = JSON.stringify({ ...config, enabled: false })
        applyAzureCliConfig()
        expect(process.env.AI_PROVIDER).toBe("openai")
        expect(process.env.AI_MODEL).toBe("gpt-4o")
        expect(process.env.AI_MODELS_CONFIG).toBe('{"providers":[]}')
        expect(process.env.AZURE_TENANT_ID).toBe("original-tenant")
        expect(process.env.AZURE_BASE_URL).toBeUndefined()
        expect(process.env.AZURE_AUTH_MODE).toBe("api-key")
    })

    it("clears an inherited tenant when the UI selects the default CLI tenant", async () => {
        vi.stubEnv("AZURE_TENANT_ID", "old-tenant")
        disk.content = JSON.stringify({ ...config, tenantId: "" })
        const { applyAzureCliConfig } = await import(
            "../../electron/main/azure-cli-config"
        )
        applyAzureCliConfig()
        expect(process.env.AZURE_TENANT_ID).toBeUndefined()
    })

    it("surfaces corrupt configuration instead of silently enabling defaults", async () => {
        disk.content = "invalid json"
        const { getAzureCliConfig, applyAzureCliConfig } = await import(
            "../../electron/main/azure-cli-config"
        )
        expect(getAzureCliConfig).toThrow(
            /Could not read desktop Azure CLI settings/,
        )
        expect(applyAzureCliConfig).toThrow(
            /Could not read desktop Azure CLI settings/,
        )
    })

    it.each([
        { ...config, enabled: "true" },
        { ...config, baseUrl: "http://test.example/openai" },
        { ...config, baseUrl: "https://user:password@test.example/openai" },
        { ...config, baseUrl: "https://test.example/openai?api-key=secret" },
        { ...config, deployment: "" },
        { ...config, deployment: "bad\nmodel" },
        { ...config, tenantId: "'; command" },
    ])("rejects invalid native settings %# before writing", async (value) => {
        const { saveAzureCliConfig } = await import(
            "../../electron/main/azure-cli-config"
        )
        expect(() => saveAzureCliConfig(value)).toThrow()
        expect(disk.write).not.toHaveBeenCalled()
    })

    it("accepts empty fields when disabling and trims valid input", () => {
        expect(
            AzureCliConfigSchema.parse({
                enabled: false,
                baseUrl: "",
                deployment: "",
                tenantId: "",
            }).enabled,
        ).toBe(false)
        expect(
            AzureCliConfigSchema.parse({
                ...config,
                deployment: " my-deployment ",
            }).deployment,
        ).toBe("my-deployment")
    })
})
