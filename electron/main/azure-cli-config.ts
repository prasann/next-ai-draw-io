import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import {
    type AzureCliConfig,
    AzureCliConfigSchema,
} from "../../lib/types/azure-cli-config"

const ENV_KEYS = [
    "AI_PROVIDER",
    "AI_MODEL",
    "AI_MODELS_CONFIG",
    "AZURE_AUTH_MODE",
    "AZURE_BASE_URL",
    "AZURE_TENANT_ID",
] as const
let originalEnv: Map<string, string | undefined> | undefined

function configPath(): string {
    return path.join(app.getPath("userData"), "azure-cli-config.json")
}

function loadConfig(): AzureCliConfig | null {
    try {
        return AzureCliConfigSchema.parse(
            JSON.parse(fs.readFileSync(configPath(), "utf8")),
        )
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
        throw new Error(
            "Could not read desktop Azure CLI settings. Check azure-cli-config.json in the app's user-data folder.",
        )
    }
}

export function getAzureCliConfig(): AzureCliConfig {
    return (
        loadConfig() ?? {
            enabled: process.env.AZURE_AUTH_MODE === "azure-cli",
            baseUrl:
                process.env.AZURE_BASE_URL ||
                (process.env.AZURE_RESOURCE_NAME
                    ? `https://${process.env.AZURE_RESOURCE_NAME}.openai.azure.com/openai`
                    : ""),
            deployment:
                process.env.AI_PROVIDER === "azure"
                    ? process.env.AI_MODEL?.split(",")[0].trim() || ""
                    : "",
            tenantId: process.env.AZURE_TENANT_ID || "",
        }
    )
}

export function saveAzureCliConfig(value: unknown): AzureCliConfig {
    const config = AzureCliConfigSchema.parse(value)
    const file = configPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(config, null, 2), {
        mode: 0o600,
    })
    fs.renameSync(`${file}.tmp`, file)
    return config
}

export function applyAzureCliConfig(): void {
    originalEnv ??= new Map(ENV_KEYS.map((key) => [key, process.env[key]]))
    const config = loadConfig()
    if (!config) return
    if (!config.enabled) {
        for (const [key, value] of originalEnv) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        // A UI choice of API keys also disables inherited .env CLI mode.
        process.env.AZURE_AUTH_MODE = "api-key"
        return
    }
    process.env.AI_PROVIDER = "azure"
    process.env.AI_MODEL = config.deployment
    process.env.AZURE_AUTH_MODE = "azure-cli"
    process.env.AZURE_BASE_URL = config.baseUrl.replace(/\/+$/, "")
    if (config.tenantId) process.env.AZURE_TENANT_ID = config.tenantId
    else delete process.env.AZURE_TENANT_ID
    process.env.AI_MODELS_CONFIG = JSON.stringify({
        providers: [
            {
                name: "Desktop Azure CLI",
                provider: "azure",
                models: [config.deployment],
                default: true,
            },
        ],
    })
}

export function azureCliModelId(deployment: string): string {
    return `server:desktop-azure-cli:${deployment}`
}
