import type { Page } from "@playwright/test"
import {
    expect,
    getIframe,
    getIframeContent,
    openApp,
    openDrawioFile,
    openSettingsTab,
    test,
} from "./lib/fixtures"

const TWO_PAGES =
    '<mxfile><diagram id="a" name="Architecture"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Start" style="rounded=1;fillColor=#ffe6cc;strokeColor=#d79b00;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="160" height="80" as="geometry"/></mxCell></root></mxGraphModel></diagram><diagram id="b" name="Second page"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="3" value="Second page node" style="fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="160" height="80" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>'

async function canvasReady(page: Page) {
    await expect(page.getByTestId("canvas-loading")).toHaveCount(0, {
        timeout: 30000,
    })
}

async function pickAppearance(
    page: Page,
    name: "Follow app" | "Light" | "Dark",
) {
    await page.getByRole("combobox", { name: "Diagram appearance" }).click()
    await page.getByRole("option", { name, exact: true }).click()
    await expect(page.getByRole("listbox")).toHaveCount(0)
}

async function editorDark(page: Page) {
    return getIframe(page).evaluate((el) =>
        ((el as HTMLIFrameElement).contentWindow as any).Editor.isDarkMode(),
    )
}

test.describe("Diagram appearance", () => {
    test("starts with the saved override and synchronizes canvas and Settings controls", async ({
        page,
    }) => {
        await page.addInitScript(() => {
            if (sessionStorage.getItem("appearance-seeded")) return
            sessionStorage.setItem("appearance-seeded", "1")
            localStorage.setItem("next-ai-draw-io-dark-mode", "true")
            localStorage.setItem("next-ai-draw-io-diagram-appearance", "light")
        })
        await openApp(page, { path: "/en" })
        await canvasReady(page)
        await expect(page.locator("html")).toHaveClass(/dark/)
        expect(await editorDark(page)).toBe(false)
        await expect(getIframe(page)).toHaveAttribute("src", /dark=0/)
        await page.getByTestId("draw-yourself").click()
        await pickAppearance(page, "Dark")
        await expect.poll(() => editorDark(page)).toBe(true)

        await openSettingsTab(page, "general")
        const settingsAppearance = page
            .getByRole("dialog")
            .getByRole("combobox", { name: "Diagram appearance" })
        await expect(settingsAppearance).toHaveText("Dark")
        await settingsAppearance.click()
        await page.getByRole("option", { name: "Light", exact: true }).click()
        await expect.poll(() => editorDark(page)).toBe(false)
        await page.keyboard.press("Escape")
        await expect(
            page.getByRole("combobox", { name: "Diagram appearance" }),
        ).toHaveText("Light")
        await page.reload({ waitUntil: "networkidle" })
        await canvasReady(page)
        expect(await editorDark(page)).toBe(false)
        await expect(getIframe(page)).toHaveAttribute("src", /dark=0/)
        await expect(page.locator("html")).toHaveClass(/dark/)
    })

    test("follows system app changes only in Follow app mode", async ({
        page,
    }) => {
        await page.emulateMedia({ colorScheme: "dark" })
        await page.addInitScript(() => {
            localStorage.setItem("next-ai-draw-io-diagram-appearance", "light")
        })
        await openApp(page, { path: "/en" })
        await canvasReady(page)
        await page.getByTestId("draw-yourself").click()
        await expect(page.locator("html")).toHaveClass(/dark/)
        expect(await editorDark(page)).toBe(false)
        await page.emulateMedia({ colorScheme: "light" })
        await expect(page.locator("html")).not.toHaveClass(/dark/)
        await page.emulateMedia({ colorScheme: "dark" })
        await expect(page.locator("html")).toHaveClass(/dark/)
        await expect.poll(() => editorDark(page)).toBe(false)
        await pickAppearance(page, "Follow app")
        await expect.poll(() => editorDark(page)).toBe(true)
        await page.emulateMedia({ colorScheme: "light" })
        await expect.poll(() => editorDark(page)).toBe(false)
        await pickAppearance(page, "Dark")
        await expect.poll(() => editorDark(page)).toBe(true)
        await expect(page.locator("html")).not.toHaveClass(/dark/)
    })

    test("preserves local edits, selection, zoom, undo and full-document export without remounting", async ({
        page,
    }) => {
        await page.addInitScript(() => {
            localStorage.setItem("next-ai-draw-io-dark-mode", "true")
        })
        await page.setViewportSize({ width: 1440, height: 900 })
        await openApp(page, { path: "/en" })
        await canvasReady(page)
        await page.getByTestId("draw-yourself").click()
        await openDrawioFile(page, "architecture.drawio", TWO_PAGES)
        await getIframeContent(page)
            .getByText("Start", { exact: true })
            .waitFor()
        await getIframe(page).evaluate((el) => {
            const w = (el as HTMLIFrameElement).contentWindow as any
            const original = w.EditorUi.prototype.updateActionStates
            w.EditorUi.prototype.updateActionStates = function (
                ...args: unknown[]
            ) {
                w.__appearanceUi = this
                return original.apply(this, args)
            }
        })
        await getIframeContent(page).getByText("Start", { exact: true }).click()
        await getIframe(page).evaluate((el) => {
            const w = (el as HTMLIFrameElement).contentWindow as any
            const graph = w.__appearanceUi.editor.graph
            graph
                .getModel()
                .setValue(graph.getModel().getCell("2"), "Local edit")
            graph.zoomTo(1.25)
            w.__appearanceMark = "same editor"
        })
        const state = () =>
            getIframe(page).evaluate((el) => {
                const w = (el as HTMLIFrameElement).contentWindow as any
                const ui = w.__appearanceUi
                const graph = ui.editor.graph
                return {
                    mark: w.__appearanceMark,
                    xml: w.mxUtils.getXml(ui.editor.getGraphXml()),
                    selection: graph
                        .getSelectionCells()
                        .map((cell: { id: string }) => cell.id),
                    scale: graph.view.scale,
                    translate: {
                        x: graph.view.translate.x,
                        y: graph.view.translate.y,
                    },
                    undo: ui.editor.undoManager.indexOfNextAdd,
                }
            })
        const before = await state()
        expect(before.selection).toEqual(["2"])
        for (const appearance of ["Light", "Dark", "Light"] as const) {
            await pickAppearance(page, appearance)
            await expect
                .poll(() => editorDark(page))
                .toBe(appearance === "Dark")
            expect(await state()).toEqual(before)
            await expect(page.locator("html")).toHaveClass(/dark/)
        }
        await page.screenshot({
            path: test.info().outputPath("dark-app-light-diagram.png"),
        })
        const exportedPages = await page.evaluate(async () => {
            const frame = document.querySelector("iframe")
            const w = frame?.contentWindow as any
            if (!w) throw new Error("Editor frame unavailable")
            const xml = await new Promise<string>((resolve, reject) => {
                const timer = setTimeout(() => {
                    window.removeEventListener("message", listener)
                    reject(new Error("Diagram export timed out"))
                }, 10000)
                function listener(event: MessageEvent) {
                    if (
                        event.source !== w ||
                        event.origin !== location.origin ||
                        typeof event.data !== "string"
                    )
                        return
                    const data = JSON.parse(event.data)
                    if (
                        data.event !== "export" ||
                        data.message?.message !== "appearance-test"
                    )
                        return
                    clearTimeout(timer)
                    window.removeEventListener("message", listener)
                    resolve(data.xml)
                }
                window.addEventListener("message", listener)
                w.postMessage(
                    JSON.stringify({
                        action: "export",
                        format: "xml",
                        message: "appearance-test",
                    }),
                    location.origin,
                )
            })
            const doc = new DOMParser().parseFromString(xml, "text/xml")
            return Array.from(doc.querySelectorAll("diagram")).map(
                (diagram) => {
                    const model = diagram.querySelector("mxGraphModel")
                    return {
                        name: diagram.getAttribute("name"),
                        xml: model
                            ? new XMLSerializer().serializeToString(model)
                            : w.Graph.decompress(diagram.textContent),
                    }
                },
            )
        })
        expect(exportedPages).toHaveLength(2)
        expect(exportedPages[0].xml).toContain('value="Local edit"')
        expect(exportedPages[0].xml).toContain("fillColor=#ffe6cc")
        expect(exportedPages[1].xml).toContain('value="Second page node"')
        expect(exportedPages[1].xml).toContain("fillColor=#dae8fc")
        expect(await state()).toEqual(before)
        await getIframe(page).evaluate((el) => {
            const w = (el as HTMLIFrameElement).contentWindow as any
            w.__appearanceUi.editor.undoManager.undo()
        })
        await expect(
            getIframeContent(page).getByText("Start", { exact: true }),
        ).toBeVisible()
    })

    test("applies a change made before the editor finishes loading", async ({
        page,
    }) => {
        await page.addInitScript(() => {
            localStorage.setItem("next-ai-draw-io-dark-mode", "true")
        })
        let release: (() => void) | undefined
        const delayed = new Promise<void>((resolve) => {
            release = resolve
        })
        let requests = 0
        await page.route("**/drawio/index.html?*", async (route) => {
            requests++
            await delayed
            await route.continue()
        })
        await page.goto("/en", { waitUntil: "domcontentloaded" })
        await openSettingsTab(page, "general")
        await pickAppearance(page, "Light")
        release?.()
        await canvasReady(page)
        expect(await editorDark(page)).toBe(false)
        expect(requests).toBe(1)
        await expect(page.locator("html")).toHaveClass(/dark/)
    })

    test("keeps the labeled control accessible within a mobile canvas", async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto("/en", { waitUntil: "networkidle" })
        await page.getByTestId("draw-yourself").click()
        await canvasReady(page)
        const control = page.getByRole("combobox", {
            name: "Diagram appearance",
        })
        await expect(control).toBeVisible()
        const bounds = await control.boundingBox()
        if (!bounds)
            throw new Error("Diagram appearance control is not laid out")
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
        await control.focus()
        await control.press("Enter")
        await page.getByRole("option", { name: "Light", exact: true }).click()
        await expect.poll(() => editorDark(page)).toBe(false)
    })
})
