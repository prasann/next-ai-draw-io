import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/storage"
import {
    isSendKey,
    selectDiagramDark,
    useSettingsStore,
} from "@/stores/settings-store"

const key = (
    k: string,
    mods: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, ...mods })

describe("isSendKey", () => {
    it("sends on Enter and adds a line on Shift+Enter by default", () => {
        expect(isSendKey(key("Enter"), "enter")).toBe(true)
        expect(isSendKey(key("Enter", { shiftKey: true }), "enter")).toBe(false)
    })

    it("always sends on Cmd/Ctrl+Enter", () => {
        for (const shortcut of ["enter", "ctrl-enter"] as const) {
            expect(isSendKey(key("Enter", { ctrlKey: true }), shortcut)).toBe(
                true,
            )
            expect(isSendKey(key("Enter", { metaKey: true }), shortcut)).toBe(
                true,
            )
        }
    })

    it("keeps plain Enter for a new line when Cmd/Ctrl+Enter was chosen", () => {
        expect(isSendKey(key("Enter"), "ctrl-enter")).toBe(false)
    })

    it("ignores other keys", () => {
        expect(isSendKey(key("a", { ctrlKey: true }), "enter")).toBe(false)
    })
})

describe("settings store hydrate", () => {
    beforeEach(() => {
        localStorage.clear()
        document.documentElement.className = ""
        useSettingsStore.setState({ hydrated: false })
        vi.stubGlobal(
            "matchMedia",
            vi.fn(() => ({
                matches: true,
                addEventListener: () => {},
                removeEventListener: () => {},
            })),
        )
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("sends with Enter unless Cmd/Ctrl+Enter was picked in Settings", () => {
        useSettingsStore.getState().hydrate()
        expect(useSettingsStore.getState().sendShortcut).toBe("enter")

        localStorage.setItem(STORAGE_KEYS.sendShortcut, "ctrl-enter")
        useSettingsStore.setState({ hydrated: false })
        useSettingsStore.getState().hydrate()
        expect(useSettingsStore.getState().sendShortcut).toBe("ctrl-enter")
    })

    it("puts the dark class back when called again (a page of another language)", () => {
        useSettingsStore.getState().hydrate()
        expect(document.documentElement.classList.contains("dark")).toBe(true)

        // The new page's <html> comes without it
        document.documentElement.className = ""
        useSettingsStore.getState().hydrate()
        expect(document.documentElement.classList.contains("dark")).toBe(true)
    })

    it("follows the app by default and ignores invalid saved appearances", () => {
        for (const saved of [null, "invalid", "system"]) {
            localStorage.removeItem(STORAGE_KEYS.diagramAppearance)
            if (saved)
                localStorage.setItem(STORAGE_KEYS.diagramAppearance, saved)
            useSettingsStore.setState({ hydrated: false })
            useSettingsStore.getState().hydrate()
            expect(useSettingsStore.getState().diagramAppearance).toBe(
                "follow-app",
            )
            expect(selectDiagramDark(useSettingsStore.getState())).toBe(true)
        }
    })

    it("persists an independent override through hydration and app theme changes", () => {
        useSettingsStore.getState().hydrate()
        useSettingsStore.getState().setDiagramAppearance("light")
        expect(localStorage.getItem(STORAGE_KEYS.diagramAppearance)).toBe(
            "light",
        )
        expect(document.documentElement.classList.contains("dark")).toBe(true)
        expect(selectDiagramDark(useSettingsStore.getState())).toBe(false)

        useSettingsStore.setState({
            hydrated: false,
            diagramAppearance: "follow-app",
        })
        useSettingsStore.getState().hydrate()
        expect(useSettingsStore.getState().diagramAppearance).toBe("light")
        useSettingsStore.getState().setTheme("light")
        useSettingsStore.getState().setDiagramAppearance("dark")
        expect(selectDiagramDark(useSettingsStore.getState())).toBe(true)
        expect(document.documentElement.classList.contains("dark")).toBe(false)
    })

    it("follows system changes only when the diagram follows the app", () => {
        let onChange: ((event: { matches: boolean }) => void) | undefined
        vi.stubGlobal(
            "matchMedia",
            vi.fn(() => ({
                matches: true,
                addEventListener: (
                    _type: string,
                    callback: typeof onChange,
                ) => {
                    onChange = callback
                },
            })),
        )
        useSettingsStore.getState().hydrate()
        onChange?.({ matches: false })
        expect(selectDiagramDark(useSettingsStore.getState())).toBe(false)
        useSettingsStore.getState().setDiagramAppearance("light")
        onChange?.({ matches: true })
        expect(useSettingsStore.getState().isDark).toBe(true)
        expect(selectDiagramDark(useSettingsStore.getState())).toBe(false)

        useSettingsStore.getState().setDiagramAppearance("follow-app")
        expect(localStorage.getItem(STORAGE_KEYS.diagramAppearance)).toBeNull()
        expect(selectDiagramDark(useSettingsStore.getState())).toBe(true)
        onChange?.({ matches: false })
        expect(selectDiagramDark(useSettingsStore.getState())).toBe(false)
    })
})
