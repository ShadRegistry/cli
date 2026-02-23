import { describe, it, expect } from "vitest";
import { registryItemSchema, VALID_TYPE_LIST } from "./validator.js";

describe("VALID_TYPE_LIST", () => {
	it("contains all 10 expected types", () => {
		expect(VALID_TYPE_LIST).toEqual([
			"registry:component",
			"registry:block",
			"registry:ui",
			"registry:hook",
			"registry:lib",
			"registry:page",
			"registry:file",
			"registry:style",
			"registry:theme",
			"registry:item",
		]);
		expect(VALID_TYPE_LIST).toHaveLength(10);
	});
});

describe("registryItemSchema", () => {
	const validItem = {
		name: "my-button",
		type: "registry:component" as const,
		files: [{ path: "registry/my-button/my-button.tsx", type: "registry:component", content: "export function MyButton() {}" }],
	};

	it("validates a minimal valid item", () => {
		const result = registryItemSchema.safeParse(validItem);
		expect(result.success).toBe(true);
	});

	it("rejects name shorter than 2 characters", () => {
		const result = registryItemSchema.safeParse({ ...validItem, name: "a" });
		expect(result.success).toBe(false);
	});

	it("rejects name longer than 64 characters", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			name: "a".repeat(65),
		});
		expect(result.success).toBe(false);
	});

	it("rejects name with uppercase letters", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			name: "MyButton",
		});
		expect(result.success).toBe(false);
	});

	it("rejects name starting with hyphen", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			name: "-button",
		});
		expect(result.success).toBe(false);
	});

	it("rejects name ending with hyphen", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			name: "button-",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid type", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			type: "invalid:type",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing files", () => {
		const { files, ...noFiles } = validItem;
		const result = registryItemSchema.safeParse(noFiles);
		expect(result.success).toBe(false);
	});

	it("rejects file without content", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			files: [{ path: "test.tsx", type: "registry:component" }],
		});
		expect(result.success).toBe(false);
	});

	it("accepts all optional fields absent", () => {
		const result = registryItemSchema.safeParse(validItem);
		expect(result.success).toBe(true);
	});

	it("accepts item with dependencies arrays", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			dependencies: ["clsx", "zod"],
			devDependencies: ["@types/react"],
			registryDependencies: ["button"],
		});
		expect(result.success).toBe(true);
	});

	it("accepts item with cssVars", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			cssVars: {
				theme: { "--primary": "blue" },
				light: { "--bg": "white" },
				dark: { "--bg": "black" },
			},
		});
		expect(result.success).toBe(true);
	});

	it("accepts item with font", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			font: {
				family: "Inter",
				provider: "google",
				import: "https://fonts.googleapis.com/css2?family=Inter",
				variable: "--font-inter",
				weight: ["400", "700"],
				subsets: ["latin"],
			},
		});
		expect(result.success).toBe(true);
	});

	it("rejects font missing required fields", () => {
		const result = registryItemSchema.safeParse({
			...validItem,
			font: { family: "Inter" },
		});
		expect(result.success).toBe(false);
	});
});
