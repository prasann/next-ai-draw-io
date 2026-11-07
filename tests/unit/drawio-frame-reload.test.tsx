import { cleanup, render } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
    DrawioFrame,
    type DrawioFrameHandle,
} from "@/components/canvas/drawio-frame"

vi.mock("@/lib/drawio/editor-bridge", () => ({
    attachEditor: vi.fn(),
    detachEditor: vi.fn(),
    watchForEditorUi: vi.fn(),
}))

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe("external editor reload snapshot", () => {
    it("commits an active label edit before exporting, only to the configured origin", () => {
        const ref = createRef<DrawioFrameHandle>()
        const { container } = render(
            <DrawioFrame
                ref={ref}
                src="https://editor.example/index.html?embed=1"
                css=""
                dark={false}
            />,
        )
        const frame = container.querySelector("iframe")
        if (!frame?.contentWindow || !ref.current) {
            throw new Error("Frame did not mount")
        }
        const postMessage = vi.spyOn(frame.contentWindow, "postMessage")
        ref.current.finishEditing?.()
        ref.current.exportDiagram({ format: "xml", message: "snapshot" })
        expect(postMessage.mock.calls).toEqual([
            [
                JSON.stringify({ action: "resetEditor" }),
                "https://editor.example",
            ],
            [
                JSON.stringify({
                    action: "export",
                    format: "xml",
                    message: "snapshot",
                }),
                "https://editor.example",
            ],
        ])
    })
})
