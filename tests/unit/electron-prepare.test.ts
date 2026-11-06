// @vitest-environment node
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

const files = vi.hoisted(() => ({
    copy: vi.fn(),
    remove: vi.fn(),
}))
vi.mock("node:fs", () => ({
    existsSync: () => true,
    mkdirSync: vi.fn(),
    rmSync: files.remove,
    readdirSync: (directory: string) =>
        directory.endsWith(`${path.sep}.next${path.sep}standalone`)
            ? [
                  "server.js",
                  "node_modules",
                  ".next",
                  ".env.local",
                  "release",
                  "electron-standalone",
                  "dist-electron",
              ]
            : [".env.local", "server.js"],
}))
vi.mock("../../scripts/copy-dereferenced.cjs", () => ({
    default: files.copy,
}))

describe("desktop package preparation", () => {
    it("excludes previous build artifacts while retaining runtime files and removing env files", async () => {
        await import("../../scripts/prepare-electron-build.mjs")
        const root = process.cwd()
        const target = path.join(root, "electron-standalone")
        for (const entry of ["server.js", "node_modules", ".next"]) {
            expect(files.copy).toHaveBeenCalledWith(
                path.join(root, ".next", "standalone", entry),
                path.join(target, entry),
            )
        }
        for (const entry of [
            "release",
            "electron-standalone",
            "dist-electron",
        ]) {
            expect(files.copy).not.toHaveBeenCalledWith(
                path.join(root, ".next", "standalone", entry),
                path.join(target, entry),
            )
        }
        expect(files.remove).toHaveBeenCalledWith(
            path.join(target, ".env.local"),
        )
    })
})
