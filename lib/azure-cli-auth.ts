import type { AzureOpenAIProviderSettings } from "@ai-sdk/azure"
import { isAzureCliEndpoint } from "@/lib/types/azure-cli-config"

const SCOPE = "https://cognitiveservices.azure.com/.default"

export function azureAuthMode(): "api-key" | "azure-cli" {
    const mode = process.env.AZURE_AUTH_MODE || "api-key"
    if (mode !== "api-key" && mode !== "azure-cli") {
        throw new Error(
            "AZURE_AUTH_MODE must be api-key or azure-cli. Set it in the server environment, not browser settings.",
        )
    }
    return mode
}

export function azureCliBaseUrl(baseUrl?: string): string {
    const resource = process.env.AZURE_RESOURCE_NAME
    if (
        !baseUrl &&
        (!resource || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(resource))
    ) {
        throw new Error(
            "Azure CLI authentication requires AZURE_BASE_URL or a valid AZURE_RESOURCE_NAME in the server environment.",
        )
    }
    const value = baseUrl || `https://${resource}.openai.azure.com/openai`
    if (!isAzureCliEndpoint(value)) {
        throw new Error(
            "Azure CLI authentication requires an HTTPS endpoint without credentials, query parameters or fragments.",
        )
    }
    return value.replace(/\/+$/, "")
}

// One SDK bearer provider per tenant: it caches and refreshes expiring tokens.
// Import only on use; Azure CLI authentication needs a local Node runtime.
const tokenProviders = new Map<string, Promise<() => Promise<string>>>()

function cliErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : ""
    let hint: string
    if (/not found|could not be found|not installed|ENOENT/i.test(message)) {
        hint =
            "Install Azure CLI and ensure az is on PATH. On macOS the desktop app also searches /opt/homebrew/bin and /usr/local/bin."
    } else if (
        /timed? ?out|timeout|ETIMEDOUT|ENOTFOUND|connect|network/i.test(message)
    ) {
        hint =
            "Check connectivity to Microsoft Entra ID and retry; Azure CLI token acquisition has a 10-second timeout."
    } else {
        hint =
            "Run az login in your terminal for the correct tenant, then retry. Check login expiry and AZURE_TENANT_ID if set."
    }
    // CLI stderr can contain account details. Never forward it or a token.
    return `Azure CLI authentication failed. ${hint}`
}

export class AzureCliAuthenticationError extends Error {
    constructor(error: unknown) {
        super(cliErrorMessage(error))
        this.name = "AzureCliAuthenticationError"
    }
}

async function cliToken(): Promise<string> {
    const tenantId = process.env.AZURE_TENANT_ID || ""
    let provider = tokenProviders.get(tenantId)
    if (!provider) {
        provider = import("@azure/identity").then(
            ({ AzureCliCredential, getBearerTokenProvider }) =>
                getBearerTokenProvider(
                    new AzureCliCredential({
                        ...(tenantId && { tenantId }),
                        processTimeoutInMs: 10_000,
                    }),
                    SCOPE,
                ),
        )
        tokenProviders.set(tenantId, provider)
    }
    try {
        return await (await provider)()
    } catch (error) {
        throw new AzureCliAuthenticationError(error)
    }
}

export function azureCliSettings(baseURL: string): AzureOpenAIProviderSettings {
    const origin = new URL(baseURL).origin
    return {
        baseURL,
        tokenProvider: cliToken,
        // Never allow a redirect to forward the server's Authorization.
        fetch: (input, init) => {
            const url = new URL(
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.href
                      : input.url,
            )
            if (url.origin !== origin) {
                throw new Error(
                    "Azure CLI requests must use the server's configured endpoint.",
                )
            }
            return fetch(input, { ...init, redirect: "error" })
        },
    }
}
