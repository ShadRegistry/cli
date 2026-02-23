import { describe, it, expect } from "vitest";
import {
	computeDiff,
	formatDiffSummary,
	formatItemDiff,
} from "./diff-utils.js";
import type { ItemPayload } from "../types/index.js";

function makeItem(name: string, content = "default"): ItemPayload {
	return {
		name,
		type: "registry:component",
		files: [
			{
				path: `registry/${name}/${name}.tsx`,
				type: "registry:component",
				content,
			},
		],
	};
}

// ── computeDiff ──────────────────────────────────────────────────

describe("computeDiff", () => {
	it("detects new items (local only)", () => {
		const local = [makeItem("button")];
		const remote: ItemPayload[] = [];
		const diff = computeDiff(local, remote);
		expect(diff.newItems).toHaveLength(1);
		expect(diff.newItems[0].name).toBe("button");
		expect(diff.updatedItems).toHaveLength(0);
		expect(diff.unchangedNames).toHaveLength(0);
		expect(diff.orphanedNames).toHaveLength(0);
	});

	it("detects unchanged items", () => {
		const item = makeItem("button");
		const diff = computeDiff([item], [item]);
		expect(diff.unchangedNames).toEqual(["button"]);
		expect(diff.newItems).toHaveLength(0);
		expect(diff.updatedItems).toHaveLength(0);
	});

	it("detects updated items", () => {
		const local = makeItem("button", "new content");
		const remote = makeItem("button", "old content");
		const diff = computeDiff([local], [remote]);
		expect(diff.updatedItems).toHaveLength(1);
		expect(diff.updatedItems[0].name).toBe("button");
	});

	it("detects orphaned items (remote only)", () => {
		const remote = [makeItem("old-comp")];
		const diff = computeDiff([], remote);
		expect(diff.orphanedNames).toEqual(["old-comp"]);
	});

	it("handles both empty", () => {
		const diff = computeDiff([], []);
		expect(diff.newItems).toHaveLength(0);
		expect(diff.updatedItems).toHaveLength(0);
		expect(diff.unchangedNames).toHaveLength(0);
		expect(diff.orphanedNames).toHaveLength(0);
	});

	it("treats items with undefined fields as equal", () => {
		const a: ItemPayload = {
			name: "my-comp",
			type: "registry:component",
			description: undefined,
			files: [
				{
					path: "a.tsx",
					type: "registry:component",
					content: "x",
				},
			],
		};
		const b: ItemPayload = {
			name: "my-comp",
			type: "registry:component",
			files: [
				{
					path: "a.tsx",
					type: "registry:component",
					content: "x",
				},
			],
		};
		const diff = computeDiff([a], [b]);
		expect(diff.unchangedNames).toEqual(["my-comp"]);
	});

	it("categorizes mixed items correctly", () => {
		const localItems = [
			makeItem("new-comp", "new"),
			makeItem("changed-comp", "v2"),
			makeItem("same-comp", "same"),
		];
		const remoteItems = [
			makeItem("changed-comp", "v1"),
			makeItem("same-comp", "same"),
			makeItem("deleted-comp", "old"),
		];
		const diff = computeDiff(localItems, remoteItems);
		expect(diff.newItems.map((i) => i.name)).toEqual(["new-comp"]);
		expect(diff.updatedItems.map((i) => i.name)).toEqual(["changed-comp"]);
		expect(diff.unchangedNames).toEqual(["same-comp"]);
		expect(diff.orphanedNames).toEqual(["deleted-comp"]);
	});
});

// ── formatDiffSummary ────────────────────────────────────────────

describe("formatDiffSummary", () => {
	it("shows correct counts for mixed categories", () => {
		const diff = computeDiff(
			[makeItem("new-a"), makeItem("updated-b", "v2"), makeItem("same-c")],
			[makeItem("updated-b", "v1"), makeItem("same-c"), makeItem("orphan-d")],
		);
		const summary = formatDiffSummary(diff, "test-registry");
		// Should mention "2 items to publish (1 new, 1 updated)"
		expect(summary).toContain("2 items to publish");
		expect(summary).toContain("1 new");
		expect(summary).toContain("1 updated");
		// Should mention orphaned
		expect(summary).toContain("1 item");
		expect(summary).toContain("--prune");
	});

	it("shows 'No changes' when nothing to publish", () => {
		const diff = computeDiff(
			[makeItem("same")],
			[makeItem("same")],
		);
		const summary = formatDiffSummary(diff, "test");
		expect(summary).toContain("No changes to publish");
	});

	it("handles singular item count", () => {
		const diff = computeDiff(
			[makeItem("new-item")],
			[],
		);
		const summary = formatDiffSummary(diff, "test");
		expect(summary).toContain("1 item to publish");
	});
});

// ── formatItemDiff ───────────────────────────────────────────────

describe("formatItemDiff", () => {
	it("generates unified diff string for different items", () => {
		const local = makeItem("button", "new content");
		const remote = makeItem("button", "old content");
		const diff = formatItemDiff(local, remote);
		expect(diff).toContain("remote: button");
		expect(diff).toContain("local: button");
		expect(diff).toContain("old content");
		expect(diff).toContain("new content");
	});

	it("generates diff with no changes for identical items", () => {
		const item = makeItem("button", "same");
		const diff = formatItemDiff(item, item);
		expect(diff).toContain("remote: button");
		expect(diff).toContain("local: button");
		// No content change lines (lines starting with just + or - followed by content)
		// The diff header has +++ and --- which are normal
		const lines = diff.split("\n");
		const contentChanges = lines.filter(
			(l) =>
				(l.startsWith("+") && !l.startsWith("+++")) ||
				(l.startsWith("-") && !l.startsWith("---")),
		);
		expect(contentChanges).toHaveLength(0);
	});
});
