import { execSync } from "node:child_process";

export function runBuild(cwd: string): void {
	try {
		execSync("npx shadcn build", { cwd, stdio: "pipe" });
	} catch (e: any) {
		const stderr = e.stderr?.toString() ?? "";
		const msg = stderr
			? `shadcn build failed:\n${stderr}`
			: "shadcn build failed.";
		throw new Error(
			`${msg}\nMake sure shadcn is installed: npm install -D shadcn`,
		);
	}
}
