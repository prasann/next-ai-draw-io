import { describe, expect, it } from "vitest"
import { serverPathWithCli } from "../../electron/main/server-path"

describe("Electron local server CLI PATH", () => {
    it("adds Apple Silicon and Intel Homebrew for Finder launches", () => {
        expect(serverPathWithCli("/usr/bin:/bin", "darwin")).toBe(
            "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin",
        )
    })

    it("preserves existing precedence without duplicates or empty entries", () => {
        expect(
            serverPathWithCli("/custom/bin:/opt/homebrew/bin::/bin", "darwin"),
        ).toBe("/custom/bin:/opt/homebrew/bin:/bin:/usr/local/bin:/usr/bin")
    })

    it("provides standard paths when Finder supplies none", () => {
        expect(serverPathWithCli(undefined, "darwin")).toBe(
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        )
    })

    it("leaves other operating systems unchanged", () => {
        expect(serverPathWithCli("C:\\tools;C:\\Windows", "win32")).toBe(
            "C:\\tools;C:\\Windows",
        )
        expect(serverPathWithCli(undefined, "linux")).toBeUndefined()
    })
})
