export function jsonToolResult(value) {
    return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        structuredContent: value,
    };
}
//# sourceMappingURL=tool-result.js.map