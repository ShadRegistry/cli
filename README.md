# shadregistry

CLI for publishing and managing [shadcn](https://ui.shadcn.com)-compatible component registries on [ShadRegistry](https://shadregistry.com).

## Install

```bash
npm install -g shadregistry
```

## Quick Start

```bash
# Authenticate with your ShadRegistry account
shadregistry login

# Initialize a new registry project
shadregistry init

# Add a component
shadregistry add my-button --type registry:component

# Preview changes
shadregistry diff

# Publish to ShadRegistry
shadregistry publish
```

## Commands

### `shadregistry login`

Authenticate with the ShadRegistry platform using a device authorization flow (similar to `gh auth login`).

```bash
shadregistry login              # Interactive device auth
echo "$TOKEN" | shadregistry login --with-token  # CI/CD with token from stdin
```

### `shadregistry logout`

Remove stored authentication credentials.

### `shadregistry init`

Initialize a local registry project. Creates `shadregistry.config.json` and `registry.json`, and optionally creates a new remote registry.

```bash
shadregistry init
shadregistry init --name my-registry --private
```

### `shadregistry add <name>`

Scaffold a new component locally and add it to `registry.json`.

```bash
shadregistry add my-button                          # Default: registry:component
shadregistry add use-toggle --type registry:hook
shadregistry add my-block --type registry:block
```

Supported types: `registry:component`, `registry:hook`, `registry:lib`, `registry:block`, `registry:page`, `registry:file`, `registry:style`, `registry:theme`

### `shadregistry publish`

Publish components to the remote registry. Reads local files, diffs against remote, and uploads changes.

```bash
shadregistry publish                  # Interactive confirmation
shadregistry publish --dry-run        # Preview only, no upload
shadregistry publish --force          # Skip confirmation (for CI)
shadregistry publish --prune          # Delete remote items not in local registry.json
shadregistry publish --filter a,b     # Publish only specific items
```

### `shadregistry list [registry]`

List registries or items within a registry.

```bash
shadregistry list                     # List all your registries
shadregistry list my-registry         # List items in a registry
shadregistry list --json              # JSON output
```

### `shadregistry diff`

Show what would change if `publish` were run (dry-run diff).

```bash
shadregistry diff
shadregistry diff --filter my-button
shadregistry diff --json
```

## CI/CD

Use server API keys for automated publishing. Create a server key from the ShadRegistry dashboard and set it as a CI secret.

```yaml
# GitHub Actions example
- run: npx shadregistry publish --force
  env:
    SHADREGISTRY_TOKEN: ${{ secrets.SHADREGISTRY_TOKEN }}
```

### Token Resolution Order

1. `--token <token>` flag
2. `SHADREGISTRY_TOKEN` environment variable
3. `~/.shadregistry/auth.json` (from `shadregistry login`)

## Project Structure

After `shadregistry init`, your project will have:

```
my-registry/
  shadregistry.config.json    # Where to publish (registry name, API URL)
  registry.json               # What to publish (standard shadcn format)
  registry/                   # Component source files
    my-button/
      my-button.tsx
```

## License

MIT
