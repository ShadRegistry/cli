import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as esbuild from "esbuild";
import type { ItemPayload } from "../types/index.js";

function isPreviewableFile(path: string): boolean {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return ["tsx", "jsx"].includes(ext);
}

export interface PreviewBundleResult {
	js: string;
	css: string | null;
}

export async function bundlePreviewCode(
	payload: ItemPayload,
	cwd: string,
	sourceDir: string,
): Promise<PreviewBundleResult | null> {
	// Find first previewable file
	const previewFile = payload.files.find((f) => isPreviewableFile(f.path));
	if (!previewFile) return null;

	// Try to resolve the source file on disk for best alias resolution.
	// Build output paths may already be fully qualified (e.g. "registry/new-york/blocks/comp/file.tsx"),
	// so try resolving directly from cwd first, then fall back to the composed path.
	let sourceFilePath = resolve(cwd, previewFile.path);
	if (!existsSync(sourceFilePath)) {
		sourceFilePath = resolve(cwd, sourceDir, payload.name, previewFile.path);
	}
	const sourceFileDir = dirname(sourceFilePath);
	const sourceFileExists = existsSync(sourceFilePath);

	// Look for tsconfig.json in cwd for path alias resolution
	const tsconfigPath = join(cwd, "tsconfig.json");
	const hasTsconfig = existsSync(tsconfigPath);

	try {
		const buildOptions: esbuild.BuildOptions = {
			bundle: true,
			format: "iife",
			globalName: "__previewExports",
			external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
			jsx: "transform",
			jsxFactory: "React.createElement",
			jsxFragment: "React.Fragment",
			minify: true,
			write: false,
			outdir: "out", // Required for esbuild to produce separate JS + CSS output files
			target: "es2020",
			loader: { ".tsx": "tsx", ".jsx": "jsx", ".ts": "ts", ".js": "js", ".css": "css" },
			...(hasTsconfig ? { tsconfig: tsconfigPath } : {}),
		};

		if (sourceFileExists) {
			// Source file exists on disk — use entryPoints for best resolution
			buildOptions.entryPoints = [sourceFilePath];
		} else {
			// Source file not on disk — use stdin with file content
			buildOptions.stdin = {
				contents: previewFile.content,
				loader: previewFile.path.endsWith(".tsx") ? "tsx" : "jsx",
				resolveDir: existsSync(sourceFileDir) ? sourceFileDir : cwd,
				sourcefile: previewFile.path,
			};
		}

		const result = await esbuild.build(buildOptions);

		if (result.outputFiles && result.outputFiles.length > 0) {
			let js: string | null = null;
			let css: string | null = null;
			for (const file of result.outputFiles) {
				if (file.path.endsWith(".css")) {
					css = file.text;
				} else {
					js = file.text;
				}
			}
			if (js) return { js, css };
		}

		return null;
	} catch {
		// Bundling is non-fatal — return null so publish continues without bundle
		return null;
	}
}
