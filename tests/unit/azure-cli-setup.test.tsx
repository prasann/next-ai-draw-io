import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AzureCliSetup } from "@/components/settings/azure-cli-setup"
import { DictionaryProvider } from "@/hooks/use-dictionary"
import en from "@/lib/i18n/dictionaries/en.json"

vi.mock("@/components/ui/select", () => ({
    Select: ({
        value,
        onValueChange,
        disabled,
        children,
    }: {
        value: string
        onValueChange: (value: string) => void
        disabled?: boolean
        children: ReactNode
    }) => (
        <select
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            disabled={disabled}
        >
            {children}
        </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => children,
    SelectItem: ({
        value,
        children,
    }: {
        value: string
        children: ReactNode
    }) => <option value={value}>{children}</option>,
}))

const saved = {
    enabled: true,
    baseUrl: "https://saved.openai.azure.com/openai",
    deployment: "saved-deployment",
    tenantId: "saved-tenant",
}

function mount(active = true, disabled = false, onUseModel = vi.fn()) {
    return render(
        <DictionaryProvider dictionary={en}>
            <AzureCliSetup
                active={active}
                disabled={disabled}
                onUseModel={onUseModel}
            >
                <p>API key connection fields</p>
            </AzureCliSetup>
        </DictionaryProvider>,
    )
}

afterEach(() => {
    cleanup()
    delete window.electronAPI
})

function bridge(config = saved) {
    const getAzureCli = vi.fn().mockResolvedValue(config)
    const setAzureCli = vi.fn().mockResolvedValue({
        success: true,
        modelId: "server:desktop-azure-cli:saved-deployment",
    })
    window.electronAPI = {
        isElectron: true,
        getProxy: vi.fn(),
        setProxy: vi.fn(),
        setUserLocale: vi.fn(),
        getAzureCli,
        setAzureCli,
    }
    return { getAzureCli, setAzureCli }
}

describe("desktop Azure CLI settings UI", () => {
    it("keeps API-key fields unchanged on the web", () => {
        mount()
        expect(screen.getByText("API key connection fields")).toBeTruthy()
        expect(screen.queryByRole("combobox")).toBeNull()
    })

    it("does not load desktop settings for another provider", () => {
        const { getAzureCli } = bridge()
        mount(false)
        expect(getAzureCli).not.toHaveBeenCalled()
    })

    it("loads persisted settings and hides API-key fields in CLI mode", async () => {
        bridge()
        mount()
        await waitFor(() =>
            expect(
                screen.getByLabelText(en.modelConfig.azureCli.endpoint),
            ).toBeTruthy(),
        )
        expect(
            (
                screen.getByLabelText(
                    en.modelConfig.azureCli.endpoint,
                ) as HTMLInputElement
            ).value,
        ).toBe(saved.baseUrl)
        expect(
            (
                screen.getByLabelText(
                    en.modelConfig.azureCli.deployment,
                ) as HTMLInputElement
            ).value,
        ).toBe(saved.deployment)
        expect(screen.queryByText("API key connection fields")).toBeNull()
    })

    it("saves endpoint and deployment through native IPC and selects the server model", async () => {
        const { setAzureCli } = bridge()
        const onUseModel = vi.fn()
        mount(true, false, onUseModel)
        await screen.findByLabelText(en.modelConfig.azureCli.endpoint)
        fireEvent.change(
            screen.getByLabelText(en.modelConfig.azureCli.endpoint),
            {
                target: { value: "https://new.openai.azure.com/openai" },
            },
        )
        fireEvent.click(
            screen.getByRole("button", { name: en.modelConfig.azureCli.save }),
        )
        await waitFor(() =>
            expect(onUseModel).toHaveBeenCalledWith(
                "server:desktop-azure-cli:saved-deployment",
            ),
        )
        expect(setAzureCli).toHaveBeenCalledWith({
            ...saved,
            baseUrl: "https://new.openai.azure.com/openai",
        })
    })

    it("blocks invalid HTTPS endpoints before IPC", async () => {
        const { setAzureCli } = bridge()
        mount()
        await screen.findByLabelText(en.modelConfig.azureCli.endpoint)
        fireEvent.change(
            screen.getByLabelText(en.modelConfig.azureCli.endpoint),
            {
                target: { value: "http://bad.example" },
            },
        )
        fireEvent.click(
            screen.getByRole("button", { name: en.modelConfig.azureCli.save }),
        )
        expect(await screen.findByRole("alert")).toBeTruthy()
        expect(setAzureCli).not.toHaveBeenCalled()
    })

    it("surfaces restart errors without claiming success or switching the model", async () => {
        const { setAzureCli } = bridge()
        setAzureCli.mockResolvedValue({
            success: false,
            error: "Server startup timeout",
        })
        const onUseModel = vi.fn()
        mount(true, false, onUseModel)
        await screen.findByLabelText(en.modelConfig.azureCli.endpoint)
        fireEvent.click(
            screen.getByRole("button", { name: en.modelConfig.azureCli.save }),
        )
        expect(await screen.findByText("Server startup timeout")).toBeTruthy()
        expect(onUseModel).not.toHaveBeenCalled()
    })

    it("explicitly applies API-key mode while retaining the normal connection fields", async () => {
        const { setAzureCli } = bridge()
        setAzureCli.mockResolvedValue({ success: true })
        mount()
        await screen.findByLabelText(en.modelConfig.azureCli.endpoint)
        fireEvent.change(screen.getByRole("combobox"), {
            target: { value: "api-key" },
        })
        expect(screen.getByText("API key connection fields")).toBeTruthy()
        fireEvent.click(
            screen.getByRole("button", {
                name: en.modelConfig.azureCli.disable,
            }),
        )
        await waitFor(() =>
            expect(setAzureCli).toHaveBeenCalledWith({
                ...saved,
                enabled: false,
            }),
        )
    })

    it("disables saving while a chat is active", async () => {
        const { setAzureCli } = bridge()
        mount(true, true)
        await screen.findByLabelText(en.modelConfig.azureCli.endpoint)
        expect(
            (
                screen.getByRole("button", {
                    name: en.modelConfig.azureCli.save,
                }) as HTMLButtonElement
            ).disabled,
        ).toBe(true)
        expect(setAzureCli).not.toHaveBeenCalled()
    })
})
