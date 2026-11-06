import { z } from "zod"

export function isAzureCliEndpoint(value: string): boolean {
    try {
        const url = new URL(value)
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
        )
    } catch {
        return false
    }
}

export const AzureCliConfigSchema = z
    .object({
        enabled: z.boolean(),
        baseUrl: z.string().trim().max(2048),
        deployment: z.string().trim().max(200),
        tenantId: z.string().trim().max(200),
    })
    .superRefine((config, ctx) => {
        if (
            (config.enabled || config.baseUrl) &&
            !isAzureCliEndpoint(config.baseUrl)
        ) {
            ctx.addIssue({
                code: "custom",
                path: ["baseUrl"],
                message:
                    "Enter an HTTPS Azure endpoint without credentials, query parameters or fragments.",
            })
        }
        if (
            (config.enabled && !config.deployment) ||
            (config.deployment &&
                !/^[a-z0-9][a-z0-9._-]*$/i.test(config.deployment))
        ) {
            ctx.addIssue({
                code: "custom",
                path: ["deployment"],
                message: "Enter a valid Azure deployment name.",
            })
        }
        if (config.tenantId && !/^[a-z0-9.-]+$/i.test(config.tenantId)) {
            ctx.addIssue({
                code: "custom",
                path: ["tenantId"],
                message: "Enter a tenant ID or tenant domain.",
            })
        }
    })

export type AzureCliConfig = z.infer<typeof AzureCliConfigSchema>

export type SaveAzureCliResult =
    | { success: true; modelId?: string }
    | { success: false; error: string }
