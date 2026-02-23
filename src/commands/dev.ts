import { createServer } from "node:http";
import { readFileSync, existsSync, watch, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { Command } from "commander";
import { log } from "../lib/logger.js";
import { readConfig, readManifest } from "../lib/config.js";
import { DEFAULT_BUILD_OUTPUT } from "../lib/constants.js";

export const devCommand = new Command("dev")
  .description("Build and serve registry locally for testing")
  .option("--port <port>", "Port to serve on", "4200")
  .option("--no-watch", "Disable file watching")
  .option("--preview", "Launch Vite preview app alongside the registry server", false)
  .option("--preview-port <port>", "Port for Vite preview server", "4201")
  .option("--output <dir>", "Build output directory", DEFAULT_BUILD_OUTPUT)
  .action(async (opts) => {
    const cwd = process.cwd();

    // Read config
    const config = readConfig(cwd);
    if (!config) {
      log.error(
        "No shadregistry.config.json found. Run `shadregistry init` first.",
      );
      process.exit(1);
    }

    // Read manifest to get item names for display
    const manifest = readManifest(cwd);

    const port = parseInt(opts.port, 10);
    const outputDir = resolve(cwd, opts.output);
    const sourceDir = resolve(cwd, config.sourceDir);

    // Run initial build
    runBuild(cwd);

    // Check build output exists
    if (!existsSync(outputDir)) {
      log.error(
        `Build output directory not found: ${opts.output}\n` +
          `  Make sure \`shadcn build\` is configured correctly.`,
      );
      process.exit(1);
    }

    // Start HTTP server
    const server = createServer((req, res) => {
      // Set CORS headers for shadcn CLI compatibility
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }

      // Map URL to file path
      const urlPath = req.url?.replace(/\?.*$/, "") ?? "/";
      const filePath = resolve(outputDir, urlPath === "/" ? "registry.json" : urlPath.slice(1));

      // Security: prevent path traversal
      if (!filePath.startsWith(outputDir)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden");
        return;
      }

      if (!existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      try {
        const content = readFileSync(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(content);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    });

    // Launch Vite preview if requested
    let viteProcess: ChildProcess | null = null;
    if (opts.preview) {
      viteProcess = startVitePreview(cwd, parseInt(opts.previewPort, 10));
    }

    server.listen(port, () => {
      log.newline();
      log.success(`Serving registry at http://localhost:${port}`);
      if (opts.preview) {
        log.success(`Preview app at http://localhost:${opts.previewPort}`);
      }
      log.newline();

      // List available items
      const items = listBuildItems(outputDir);
      if (items.length > 0) {
        log.bold("Install commands:");
        for (const item of items) {
          log.info(`  npx shadcn@latest add http://localhost:${port}/r/${item}.json`);
        }
      } else {
        log.warn("No items found in build output.");
      }

      log.newline();

      if (opts.watch) {
        log.dim("Watching for changes...");
        log.dim("Press Ctrl+C to stop.");
      }
    });

    // Watch source files for changes and rebuild
    if (opts.watch) {
      let rebuildTimeout: ReturnType<typeof setTimeout> | null = null;

      const scheduleRebuild = () => {
        if (rebuildTimeout) clearTimeout(rebuildTimeout);
        rebuildTimeout = setTimeout(() => {
          log.newline();
          log.info("Changes detected, rebuilding...");
          runBuild(cwd);
          const items = listBuildItems(outputDir);
          log.success(`Rebuilt ${items.length} item${items.length !== 1 ? "s" : ""}`);
        }, 300);
      };

      // Watch source directory
      if (existsSync(sourceDir)) {
        try {
          watch(sourceDir, { recursive: true }, () => {
            scheduleRebuild();
          });
        } catch {
          log.warn("File watching not supported on this platform. Use --no-watch.");
        }
      }

      // Watch registry.json
      const registryJsonPath = resolve(cwd, "registry.json");
      if (existsSync(registryJsonPath)) {
        try {
          watch(registryJsonPath, () => {
            scheduleRebuild();
          });
        } catch {
          // Silently ignore if we can't watch this file
        }
      }
    }

    // Keep process alive
    process.on("SIGINT", () => {
      if (viteProcess) viteProcess.kill();
      server.close();
      process.exit(0);
    });
  });

function runBuild(cwd: string): void {
  log.info("Building registry...");
  try {
    execSync("npx shadcn build", { cwd, stdio: "pipe" });
    log.success("Build complete.");
  } catch (e: any) {
    const stderr = e.stderr?.toString() ?? "";
    const stdout = e.stdout?.toString() ?? "";
    log.error("Build failed.");
    if (stderr) log.error(stderr);
    if (stdout) log.info(stdout);
    log.info("Make sure shadcn is installed: npm install -D shadcn");
  }
}

function listBuildItems(outputDir: string): string[] {
  if (!existsSync(outputDir)) return [];

  return readdirSync(outputDir)
    .filter((f) => f.endsWith(".json") && f !== "registry.json")
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

function startVitePreview(cwd: string, port: number): ChildProcess {
  const viteConfigPath = resolve(cwd, "vite.config.ts");
  if (!existsSync(viteConfigPath)) {
    log.warn(
      "No vite.config.ts found. Run `shadregistry init` to set up the preview app.",
    );
    return spawn("true");
  }

  const previewDir = resolve(cwd, "src/preview");
  if (!existsSync(previewDir)) {
    log.warn(
      "No src/preview/ directory found. Run `shadregistry init` to set up the preview app.",
    );
    return spawn("true");
  }

  log.info("Starting preview server...");
  const child = spawn("npx", ["vite", "--port", String(port)], {
    cwd,
    stdio: "pipe",
    env: { ...process.env },
  });

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) log.info(text);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text && !text.includes("ExperimentalWarning")) {
      log.warn(text);
    }
  });

  child.on("error", () => {
    log.error("Failed to start Vite. Is it installed? Run `npm install`.");
  });

  return child;
}
