import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApiClient, ApiError, createUnauthClient } from "./api-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
	mockFetch.mockReset();
});

function mockResponse(data: unknown, status = 200, ok = true) {
	mockFetch.mockResolvedValueOnce({
		ok,
		status,
		json: async () => data,
	});
}

describe("ApiClient", () => {
	const client = new ApiClient("https://api.example.com", "test_token");

	describe("get", () => {
		it("calls fetch with GET method and returns data", async () => {
			mockResponse({ registries: [] });
			const data = await client.get<{ registries: never[] }>("/api/cli/registries");
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.example.com/api/cli/registries",
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						Authorization: "Bearer test_token",
					}),
				}),
			);
			expect(data).toEqual({ registries: [] });
		});
	});

	describe("post", () => {
		it("calls fetch with POST method and JSON body", async () => {
			mockResponse({ success: true });
			await client.post("/api/cli/items/publish", { items: [] });
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.example.com/api/cli/items/publish",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ items: [] }),
					headers: expect.objectContaining({
						"Content-Type": "application/json",
					}),
				}),
			);
		});
	});

	describe("delete", () => {
		it("calls fetch with DELETE method", async () => {
			mockResponse({ success: true });
			await client.delete("/api/cli/items/delete", { names: ["a"] });
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.example.com/api/cli/items/delete",
				expect.objectContaining({
					method: "DELETE",
					body: JSON.stringify({ names: ["a"] }),
				}),
			);
		});
	});

	describe("auth header", () => {
		it("includes Authorization header when token is set", async () => {
			mockResponse({});
			await client.get("/test");
			const [, opts] = mockFetch.mock.calls[0];
			expect(opts.headers.Authorization).toBe("Bearer test_token");
		});

		it("omits Authorization header when token is empty", async () => {
			const unauthClient = createUnauthClient("https://api.example.com");
			mockResponse({});
			await unauthClient.get("/test");
			const [, opts] = mockFetch.mock.calls[0];
			expect(opts.headers.Authorization).toBeUndefined();
		});
	});

	describe("error handling", () => {
		it("throws ApiError on non-ok response", async () => {
			mockResponse({ error: "Not found" }, 404, false);
			await expect(client.get("/missing")).rejects.toThrow(ApiError);
		});

		it("uses data.error as message when available", async () => {
			mockResponse({ error: "Registry not found" }, 404, false);
			try {
				await client.get("/missing");
			} catch (e) {
				expect(e).toBeInstanceOf(ApiError);
				expect((e as ApiError).message).toBe("Registry not found");
				expect((e as ApiError).status).toBe(404);
			}
		});

		it("uses fallback message when data.error is absent", async () => {
			mockResponse({}, 500, false);
			try {
				await client.get("/error");
			} catch (e) {
				expect(e).toBeInstanceOf(ApiError);
				expect((e as ApiError).message).toBe(
					"Request failed with status 500",
				);
			}
		});

		it("treats 207 response as success", async () => {
			mockResponse(
				{ created: 1, updated: 0, errors: [] },
				207,
				false,
			);
			const data = await client.post<{ created: number }>("/publish");
			expect(data.created).toBe(1);
		});
	});
});

describe("createUnauthClient", () => {
	it("creates ApiClient with empty token", async () => {
		const client = createUnauthClient("https://api.example.com");
		mockResponse({ ok: true });
		await client.get("/test");
		const [, opts] = mockFetch.mock.calls[0];
		expect(opts.headers.Authorization).toBeUndefined();
	});
});
