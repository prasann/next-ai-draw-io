"use client"

import { Loader2 } from "lucide-react"
import { type ReactNode, useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useDictionary } from "@/hooks/use-dictionary"
import {
    type AzureCliConfig,
    AzureCliConfigSchema,
} from "@/lib/types/azure-cli-config"

export function AzureCliSetup({
    active,
    disabled,
    onUseModel,
    children,
}: {
    active: boolean
    disabled: boolean
    onUseModel: (id: string) => void
    children: ReactNode
}) {
    const t = useDictionary().modelConfig.azureCli
    const id = useId()
    const [desktop, setDesktop] = useState(false)
    const [loading, setLoading] = useState(true)
    const [mode, setMode] = useState("api-key")
    const [savedEnabled, setSavedEnabled] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    const [saved, setSaved] = useState(false)
    const [config, setConfig] = useState<AzureCliConfig>({
        enabled: false,
        baseUrl: "",
        deployment: "",
        tenantId: "",
    })

    useEffect(() => {
        if (!active || !window.electronAPI?.getAzureCli) return
        let cancelled = false
        setDesktop(true)
        window.electronAPI
            .getAzureCli()
            .then((value) => {
                if (cancelled) return
                setConfig(value)
                setMode(value.enabled ? "azure-cli" : "api-key")
                setSavedEnabled(value.enabled)
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setError(error instanceof Error ? error.message : t.failed)
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [active, t.failed])

    if (!active || !desktop) return children

    const update = (
        field: "baseUrl" | "deployment" | "tenantId",
        value: string,
    ) => {
        setConfig((previous) => ({ ...previous, [field]: value }))
        setSaved(false)
        setError("")
    }
    const save = async (enabled: boolean) => {
        if (!window.electronAPI?.setAzureCli) return
        const parsed = AzureCliConfigSchema.safeParse({ ...config, enabled })
        if (!parsed.success) {
            setError(parsed.error.issues[0].message)
            return
        }
        setSaving(true)
        setError("")
        setSaved(false)
        try {
            const result = await window.electronAPI.setAzureCli(parsed.data)
            if (!result.success) {
                setError(result.error)
                return
            }
            setConfig(parsed.data)
            setSavedEnabled(enabled)
            setSaved(true)
            if (result.modelId) onUseModel(result.modelId)
        } catch (error) {
            setError(error instanceof Error ? error.message : t.failed)
        } finally {
            setSaving(false)
        }
    }
    const busy = disabled || loading || saving

    return (
        <>
            <div className="space-y-3">
                <Label htmlFor={`${id}-auth`}>{t.authentication}</Label>
                <Select
                    value={mode}
                    disabled={busy}
                    onValueChange={(value) => {
                        setMode(value)
                        setError("")
                        setSaved(false)
                    }}
                >
                    <SelectTrigger id={`${id}-auth`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="api-key">{t.apiKey}</SelectItem>
                        <SelectItem value="azure-cli">{t.cli}</SelectItem>
                    </SelectContent>
                </Select>
                {error && (
                    <p
                        role="alert"
                        className="text-xs text-destructive whitespace-pre-line"
                    >
                        {error}
                    </p>
                )}
                {saved && (
                    <p role="status" className="text-xs text-success">
                        {t.saved}
                    </p>
                )}
                {mode === "api-key" && savedEnabled && (
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                            {t.disableHint}
                        </p>
                        <Button disabled={busy} onClick={() => save(false)}>
                            {saving && (
                                <Loader2 className="size-4 animate-spin" />
                            )}
                            {t.disable}
                        </Button>
                    </div>
                )}
            </div>
            {mode === "azure-cli" ? (
                <form
                    className="space-y-4 rounded-xl border border-border p-4"
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (!busy) void save(true)
                    }}
                >
                    <p className="text-xs text-muted-foreground">
                        {t.description}
                    </p>
                    <div className="space-y-2">
                        <Label htmlFor={`${id}-endpoint`}>{t.endpoint}</Label>
                        <Input
                            id={`${id}-endpoint`}
                            value={config.baseUrl}
                            onChange={(event) =>
                                update("baseUrl", event.target.value)
                            }
                            placeholder="https://your-resource.openai.azure.com/openai"
                            required
                            disabled={busy}
                            className="font-mono text-xs"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={`${id}-deployment`}>
                            {t.deployment}
                        </Label>
                        <Input
                            id={`${id}-deployment`}
                            value={config.deployment}
                            onChange={(event) =>
                                update("deployment", event.target.value)
                            }
                            required
                            disabled={busy}
                        />
                        <p className="text-xs text-muted-foreground">
                            {t.deploymentHint}
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={`${id}-tenant`}>{t.tenant}</Label>
                        <Input
                            id={`${id}-tenant`}
                            value={config.tenantId}
                            onChange={(event) =>
                                update("tenantId", event.target.value)
                            }
                            disabled={busy}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-line">
                        {t.loginHint}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {t.storageHint}
                    </p>
                    <Button type="submit" disabled={busy}>
                        {saving && <Loader2 className="size-4 animate-spin" />}
                        {t.save}
                    </Button>
                </form>
            ) : (
                children
            )}
        </>
    )
}
