"use client"

import { useId } from "react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useDictionary } from "@/hooks/use-dictionary"
import { cn } from "@/lib/utils"
import { isDiagramAppearance, useSettingsStore } from "@/stores/settings-store"

export function DiagramAppearanceControl({
    id,
    compact = false,
}: {
    id?: string
    compact?: boolean
}) {
    const generatedId = useId()
    const t = useDictionary().settings
    const appearance = useSettingsStore((s) => s.diagramAppearance)
    const setAppearance = useSettingsStore((s) => s.setDiagramAppearance)
    const controlId = id ?? generatedId

    return (
        <div
            className={cn(
                compact &&
                    "flex items-center gap-2 rounded-lg border border-border bg-card px-2 shadow-float",
            )}
        >
            {compact && (
                <label
                    htmlFor={controlId}
                    className="text-xs text-muted-foreground"
                >
                    {t.diagramAppearanceShort}
                </label>
            )}
            <Select
                value={appearance}
                onValueChange={(value) => {
                    if (isDiagramAppearance(value)) setAppearance(value)
                }}
            >
                <SelectTrigger
                    id={controlId}
                    aria-label={t.diagramAppearance}
                    className={cn(
                        "h-8 w-[132px] rounded-lg text-xs",
                        compact && "w-auto border-0 px-1 shadow-none",
                    )}
                    data-testid="diagram-appearance-select"
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="follow-app">
                        {t.diagramFollowApp}
                    </SelectItem>
                    <SelectItem value="light">{t.themeLight}</SelectItem>
                    <SelectItem value="dark">{t.themeDarkMode}</SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}
