# Domainarr

DNS sync CLI for managing Pi-hole and Cloudflare DNS records together.

Keep your local Pi-hole DNS entries synchronized with Cloudflare DNS, enabling split-horizon DNS where local devices resolve to internal IPs while external clients use Cloudflare.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Configuration](#configuration)
- [Backup & Restore](#backup--restore)
- [License](#license)

## Features

- **Dual-provider sync**: Manage DNS records in both Pi-hole and Cloudflare from a single CLI
- **Pi-hole as source of truth**: Sync command pushes Pi-hole records to Cloudflare
- **Backup & restore**: Create timestamped backups and restore when needed
- **Interactive setup**: `domainarr init` guides you through configuration
- **Idempotent operations**: Safe to run multiple times without duplicating records

## Installation

[![Packaging status](https://repology.org/badge/vertical-allrepos/domainarr.svg)](https://repology.org/project/domainarr/versions)

### Quick Install (Linux/macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/ryanbas21/domainarr/main/install.sh | sh
```

### Package Managers

#### npm

```bash
npm install -g domainarr
```

#### Homebrew (macOS/Linux)

```bash
brew install ryanbas21/tap/domainarr
```

#### Arch Linux (AUR)

```bash
yay -S domainarr
# or
paru -S domainarr
```

#### Fedora (COPR)

```bash
sudo dnf copr enable ryanbas21/domainarr
sudo dnf install domainarr
```

### Download Binary

Pre-built binaries for all platforms are available on the [releases page](https://github.com/ryanbas21/domainarr/releases).

| Platform | Download |
|----------|----------|
| Linux x64 | [domainarr-linux-x64](https://github.com/ryanbas21/domainarr/releases/latest/download/domainarr-linux-x64) |
| Linux arm64 | [domainarr-linux-arm64](https://github.com/ryanbas21/domainarr/releases/latest/download/domainarr-linux-arm64) |
| macOS x64 | [domainarr-macos-x64](https://github.com/ryanbas21/domainarr/releases/latest/download/domainarr-macos-x64) |
| macOS arm64 | [domainarr-macos-arm64](https://github.com/ryanbas21/domainarr/releases/latest/download/domainarr-macos-arm64) |
| Windows x64 | [domainarr-win-x64.exe](https://github.com/ryanbas21/domainarr/releases/latest/download/domainarr-win-x64.exe) |

### Build from Source

```bash
git clone https://github.com/ryanbas21/domainarr.git
cd domainarr
pnpm install
pnpm build
pnpm link --global
```

## Quick Start

1. **Configure** your Pi-hole and Cloudflare credentials:

   ```bash
   domainarr init
   ```

   This creates `~/.config/domainarr/config.json` with your settings.

2. **Add a DNS record** to both providers:

   ```bash
   domainarr add homelab.example.com 192.168.1.100
   ```

3. **List all records** with sync status:

   ```bash
   domainarr list
   ```

4. **Sync Pi-hole to Cloudflare**:

   ```bash
   domainarr sync
   ```

## Commands

| Command | Description |
|---------|-------------|
| `domainarr add <domain> <ip>` | Add DNS record to both Pi-hole and Cloudflare |
| `domainarr remove <domain>` | Remove DNS record from both providers |
| `domainarr list` | List all records with sync status |
| `domainarr sync` | Sync Pi-hole records to Cloudflare (Pi-hole is source of truth) |
| `domainarr backup` | Create a timestamped backup |
| `domainarr restore [file]` | Restore from a backup file |
| `domainarr init` | Interactive setup wizard |

## Configuration

Configuration is stored at `~/.config/domainarr/config.json`:

```json
{
  "pihole": {
    "url": "http://pihole.local",
    "password": "your-pihole-password"
  },
  "dnsProvider": {
    "type": "cloudflare",
    "apiToken": "your-cloudflare-api-token",
    "zoneId": "your-zone-id",
    "zone": "example.com"
  },
  "backup": {
    "path": "/path/to/backups"
  }
}
```

### Pi-hole Setup

- Requires Pi-hole v6+ with REST API enabled
- Password is your Pi-hole web interface password

### Cloudflare Setup

1. Create an API token at [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Grant **Zone:DNS:Edit** permissions for your zone
3. Find your Zone ID on the zone overview page

## Backup & Restore

Create backups before making bulk changes:

```bash
# Create backup
domainarr backup
# Output: Backup saved to /path/to/backups/domainarr-backup-2024-01-15T10-30-00-000Z.json

# List available backups
domainarr restore
# Shows list of available backup files

# Restore from specific backup
domainarr restore domainarr-backup-2024-01-15T10-30-00-000Z.json
```

Backups include records from both Pi-hole and Cloudflare.

## License

ISC
