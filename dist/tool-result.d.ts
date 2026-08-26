export declare function jsonToolResult<T extends object>(value: T): {
    content: {
        type: "text";
        text: string;
    }[];
    structuredContent: Record<string, unknown>;
};
//# sourceMappingURL=tool-result.d.ts.map