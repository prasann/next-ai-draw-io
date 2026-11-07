import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CanvasStage } from "@/components/canvas/canvas-stage"
import type { DrawioFrame } from "@/components/canvas/drawio-frame"
import { DictionaryProvider } from "@/hooks/use-dictionary"
import en from "@/lib/i18n/dictionaries/en.json"
import { useSettingsStore } from "@/stores/settings-store"

type FrameProps = ComponentProps<typeof DrawioFrame>
const mocks = vi.hoisted(() => ({
    frame: vi.fn<(props: FrameProps) => void>(),
    mount: vi.fn(),
    reload: vi.fn<() => Promise<void>>(),
}))

vi.mock("@/components/canvas/drawio-frame", async () => {
    const { forwardRef, useEffect } = await import("react")
    return {
        DrawioFrame: forwardRef<unknown, FrameProps>(
            function Frame(props, _ref) {
                mocks.frame(props)
                useEffect(() => {
                    mocks.mount()
                }, [])
                return (
                    <div
                        data-testid="frame"
                        data-src={props.src}
                        data-dark={props.dark}
                    />
                )
            },
        ),
    }
})
vi.mock("@/components/canvas/diagram-appearance-control", () => ({
    DiagramAppearanceControl: () => <span>Diagram appearance control</span>,
}))
vi.mock("@/components/canvas/outline-offer", () => ({
    OutlineOffer: () => null,
}))
vi.mock("@/components/canvas/locale-context", () => ({ useLocale: () => "en" }))
vi.mock("@/lib/drawio/editor-bridge", () => ({
    centerEmptyPage: vi.fn(),
    keepCenter: vi.fn(),
    refitIfRecent: vi.fn(),
}))
vi.mock("@/contexts/diagram-context", () => ({
    useDiagram: () => ({
        drawioRef: { current: null },
        handleDiagramAutoSave: vi.fn(),
        handleDiagramExport: vi.fn(),
        onDrawioLoad: vi.fn(),
        resetDrawioReady: vi.fn(),
        isDrawioReady: true,
        prepareForReload: mocks.reload,
    }),
}))

beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.reload.mockResolvedValue(undefined)
    useSettingsStore.setState({
        hydrated: true,
        isDark: true,
        diagramAppearance: "follow-app",
    })
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
        },
    )
})
afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function mount() {
    return render(
        <DictionaryProvider dictionary={en}>
            <CanvasStage />
        </DictionaryProvider>,
    )
}

function frameProps() {
    const call = mocks.frame.mock.lastCall
    if (!call) throw new Error("Frame has not mounted")
    return call[0]
}

describe("independent diagram appearance", () => {
    it("waits for hydrated preferences before starting the editor", () => {
        useSettingsStore.setState({ hydrated: false })
        mount()
        expect(mocks.mount).not.toHaveBeenCalled()
        act(() =>
            useSettingsStore.setState({
                hydrated: true,
                diagramAppearance: "light",
            }),
        )
        expect(frameProps().dark).toBe(false)
        expect(new URL(frameProps().src).searchParams.get("dark")).toBe("0")
    })

    it("starts light in a dark app and updates a local editor without remounting", () => {
        useSettingsStore.setState({ diagramAppearance: "light" })
        mount()
        const src = frameProps().src
        act(() => frameProps().onEditorAccess?.(true))
        act(() => useSettingsStore.getState().setDiagramAppearance("dark"))
        expect(frameProps().dark).toBe(true)
        expect(frameProps().src).toBe(src)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
        expect(mocks.reload).not.toHaveBeenCalled()
    })

    it("honors a preference changed while the editor is loading", () => {
        mount()
        act(() => useSettingsStore.getState().setDiagramAppearance("light"))
        act(() => frameProps().onEditorAccess?.(true))
        expect(frameProps().dark).toBe(false)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
    })

    it("captures before reloading an external editor and cancels stale switches", async () => {
        let finish: (() => void) | undefined
        mocks.reload.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve
                }),
        )
        mount()
        const src = frameProps().src
        act(() => frameProps().onEditorAccess?.(false))
        act(() => useSettingsStore.getState().setDiagramAppearance("light"))
        expect(mocks.reload).toHaveBeenCalledTimes(1)
        expect(frameProps().src).toBe(src)
        act(() => useSettingsStore.getState().setDiagramAppearance("dark"))
        await act(async () => {
            finish?.()
        })
        expect(frameProps().src).toBe(src)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
    })

    it("reloads only after the external editor's full document is captured", async () => {
        let finish: (() => void) | undefined
        mocks.reload.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve
                }),
        )
        mount()
        act(() => frameProps().onEditorAccess?.(false))
        act(() => useSettingsStore.getState().setDiagramAppearance("light"))
        expect(mocks.mount).toHaveBeenCalledTimes(1)
        await act(async () => {
            finish?.()
        })
        expect(new URL(frameProps().src).searchParams.get("dark")).toBe("0")
        expect(mocks.mount).toHaveBeenCalledTimes(2)
    })

    it("keeps the frame and reports an error when capture fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {})
        mocks.reload.mockRejectedValue(new Error("Export failed"))
        mount()
        const src = frameProps().src
        act(() => frameProps().onEditorAccess?.(false))
        act(() => useSettingsStore.getState().setDiagramAppearance("light"))
        await waitFor(() =>
            expect(screen.getByRole("alert").textContent).toContain(
                en.settings.diagramThemeFailed,
            ),
        )
        expect(frameProps().src).toBe(src)
        expect(mocks.mount).toHaveBeenCalledTimes(1)
        expect(screen.queryByTestId("canvas-loading")).toBeNull()
    })
})
