export function serverPathWithCli(
    inheritedPath: string | undefined,
    platform: NodeJS.Platform,
): string | undefined {
    if (platform !== "darwin") return inheritedPath
    // Finder does not load shell startup files. Preserve PATH precedence
    // while including both standard Homebrew installations.
    return [
        ...new Set([
            ...(inheritedPath || "").split(":").filter(Boolean),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
        ]),
    ].join(":")
}
