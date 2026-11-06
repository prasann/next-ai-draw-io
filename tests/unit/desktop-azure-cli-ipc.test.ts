// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AzureCliConfigSchema } from "@/lib/types/azure-cli-config"

const state = vi.hoisted(() => ({
    packaged: true,
    handlers: {} as Record<
        string,
        (
            event: { senderFrame?: { url: string } },
            ...args: unknown[]
        ) => unknown
    >,
    save: vi.fn(),
    apply: vi.fn(),
    restart: vi.fn(),
}))
vi.mock("electron", () => ({
    app: {
        get isPackaged() {
            return state.packaged
        },
    },
    ipcMain: {
        handle: (channel: string, handler: (typeof state.handlers)[string]) => {
            state.handlers[channel] = handler
        },
    },
}))
vi.mock("../../electron/main/azure-cli-config", () => ({
    saveAzureCliConfig: state.save,
    applyAzureCliConfig: state.apply,
    getAzureCliConfig: () => ({
        enabled: false,
        baseUrl: "",
        deployment: "",
        tenantId: "",
    }),
    azureCliModelId: (deployment: string) =>
        `server:desktop-azure-cli:${deployment}`,
}))
vi.mock("../../electron/main/next-server", () => ({
    restartNextServer: state.restart,
}))
vi.mock("../../electron/main/window-manager", () => ({
    isAppUrl: (url: unknown) => url === "http://localhost:6002/en",
}))
vi.mock("../../electron/main/app-menu", () => ({ buildAppMenu: vi.fn() }))
vi.mock("../../electron/main/config-manager", () => ({
    setUserLocale: vi.fn(),
    USER_LOCALES: ["en"],
}))
vi.mock("../../electron/main/pdf-export", () => ({ savePreviewAsPdf: vi.fn() }))
vi.mock("../../electron/main/port-manager", () => ({
    noteNoChats: vi.fn(),
    rememberChatPort: vi.fn(),
}))
vi.mock("../../electron/main/proxy-manager", () => ({
    applyProxyToEnv: vi.fn(),
    getProxyConfig: vi.fn(),
    saveProxyConfig: vi.fn(),
}))

const event = { senderFrame: { url: "http://localhost:6002/en" } }
const config = {
    enabled: true,
    baseUrl: "https://test.openai.azure.com/openai",
    deployment: "my-deployment",
    tenantId: "",
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    state.packaged = true
    state.handlers = {}
    state.save.mockImplementation((value: unknown) =>
        AzureCliConfigSchema.parse(value),
    )
    state.restart.mockResolvedValue("http://localhost:6002")
    const { registerIpcHandlers } = await import(
        "../../electron/main/ipc-handlers"
    )
    registerIpcHandlers()
})

describe("desktop Azure CLI IPC boundary", () => {
    it("rejects reads and writes from external pages", () => {
        const external = { senderFrame: { url: "https://attacker.example" } }
        expect(() => state.handlers["get-azure-cli"](external)).toThrow(
            /untrusted page/,
        )
        expect(() => state.handlers["set-azure-cli"](external, config)).toThrow(
            /untrusted page/,
        )
        expect(state.save).not.toHaveBeenCalled()
    })

    it("validates, persists and restarts before returning the server model ID", async () => {
        expect(await state.handlers["set-azure-cli"](event, config)).toEqual({
            success: true,
            modelId: "server:desktop-azure-cli:my-deployment",
        })
        expect(state.save).toHaveBeenCalledWith(config)
        expect(state.apply).toHaveBeenCalledOnce()
        expect(state.restart).toHaveBeenCalledOnce()
    })

    it("rejects malformed IPC values without restarting the server", async () => {
        expect(
            await state.handlers["set-azure-cli"](event, {
                ...config,
                baseUrl: {},
            }),
        ).toMatchObject({
            success: false,
        })
        expect(state.apply).not.toHaveBeenCalled()
        expect(state.restart).not.toHaveBeenCalled()
    })

    it("reports a failed restart and allows a subsequent retry", async () => {
        state.restart.mockRejectedValueOnce(new Error("Startup timeout"))
        expect(await state.handlers["set-azure-cli"](event, config)).toEqual({
            success: false,
            error: "Startup timeout",
        })
        expect(
            await state.handlers["set-azure-cli"](event, config),
        ).toMatchObject({
            success: true,
        })
    })

    it("does not overwrite configuration while another save is restarting", async () => {
        let finish: (() => void) | undefined
        state.restart.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finish = resolve
            }),
        )
        const first = state.handlers["set-azure-cli"](event, config)
        expect(
            await state.handlers["set-azure-cli"](event, config),
        ).toMatchObject({
            success: false,
            error: expect.stringContaining("already being applied"),
        })
        expect(state.save).toHaveBeenCalledOnce()
        finish?.()
        await first
    })

    it("does not falsely claim it configured a separate development server", async () => {
        state.packaged = false
        expect(
            await state.handlers["set-azure-cli"](event, config),
        ).toMatchObject({
            success: false,
            error: expect.stringContaining(".env.local"),
        })
        expect(state.save).not.toHaveBeenCalled()
    })
})
