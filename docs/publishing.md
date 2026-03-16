# Publishing Guide

This document covers how to publish Domainarr to various package managers.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Release Process](#release-process)
- [Package Managers](#package-managers)
- [Secrets Configuration](#secrets-configuration)

## Overview

Domainarr uses [Changesets](https://github.com/changesets/changesets) for version management and is distributed through multiple channels:

| Channel | Installation | Audience |
|---------|-------------|----------|
| npm | `npm install -g domainarr` | Node.js users |
| GitHub Packages | `npm install -g @username/domainarr` | GitHub ecosystem |
| GitHub Releases | Download binary | All platforms |
| AUR | `yay -S domainarr` | Arch Linux users |
| Homebrew | `brew install username/tap/domainarr` | macOS/Linux users |

## Prerequisites

### Required Secrets

Configure these secrets in your GitHub repository settings:

| Secret | Purpose | How to Get |
|--------|---------|------------|
| `NPM_TOKEN` | Publish to npm | [npm Access Tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens) |
| `AUR_SSH_PRIVATE_KEY` | Push to AUR | Generate SSH key, add public key to AUR account |
| `HOMEBREW_TAP_TOKEN` | Update Homebrew tap | GitHub PAT with `repo` scope |

### Homebrew Tap Repository

Create a repository named `homebrew-tap` in your GitHub account. This will host your Homebrew formula.

### AUR Package

1. Create an account on [AUR](https://aur.archlinux.org/)
2. Add your SSH public key to your AUR account
3. Create the `domainarr` package on AUR (first time only)

## Release Process

Domainarr uses Changesets for automated versioning and changelog generation.

### 1. Add a Changeset

When making changes that should be released:

```bash
pnpm changeset
```

This prompts you to:
1. Select the type of change (major/minor/patch)
2. Write a summary of the change

Commit the generated `.changeset/*.md` file with your changes.

### 2. Automated Version PR

When changesets are pushed to `main`, the `release.yml` workflow:
1. Creates a "Version Packages" PR with updated `package.json` and `CHANGELOG.md`
2. Accumulates multiple changesets into a single release

### 3. Merge to Publish

When you merge the "Version Packages" PR, the workflow automatically:

1. **Builds and tests** the project
2. **Publishes to npm** and GitHub Packages
3. **Creates binaries** for Linux, macOS, Windows (x64 and arm64)
4. **Uploads binaries** to the GitHub Release
5. **Updates AUR** package with new version
6. **Updates Homebrew** tap with new formula

## Package Managers

### npm

Published automatically on release. Users install with:

```bash
npm install -g domainarr
# or
npx domainarr --help
```

### GitHub Packages

Published as `@username/domainarr`. Users install with:

```bash
npm install -g @username/domainarr --registry=https://npm.pkg.github.com
```

### GitHub Releases (Binaries)

Standalone binaries are created using [@yao-pkg/pkg](https://github.com/yao-pkg/pkg):

- `domainarr-linux-x64`
- `domainarr-linux-arm64`
- `domainarr-macos-x64`
- `domainarr-macos-arm64`
- `domainarr-win-x64.exe`

Checksums are provided in `checksums.sha256`.

### AUR (Arch Linux)

The PKGBUILD is automatically updated and pushed to AUR. Users install with:

```bash
yay -S domainarr
# or
paru -S domainarr
```

### Homebrew

After setting up your tap repository, users install with:

```bash
brew tap username/tap
brew install domainarr
```

## Secrets Configuration

### NPM_TOKEN

1. Go to [npmjs.com](https://www.npmjs.com/) → Account → Access Tokens
2. Generate new token → Automation
3. Add to GitHub secrets as `NPM_TOKEN`

### AUR_SSH_PRIVATE_KEY

```bash
# Generate dedicated key for AUR CI (no passphrase)
ssh-keygen -t ed25519 -f ~/.ssh/aur-ci -C "aur-ci@github-actions" -N ""

# Add public key to AUR account
cat ~/.ssh/aur-ci.pub
# Copy and paste to https://aur.archlinux.org/account/ (My Account → SSH Public Key)

# Add private key to GitHub secrets
cat ~/.ssh/aur-ci
# Copy and paste to GitHub secrets as AUR_SSH_PRIVATE_KEY
```

**Important:** The AUR package must be created manually the first time before CI can update it:

```bash
# Clone empty AUR repo
git clone ssh://aur@aur.archlinux.org/domainarr.git /tmp/domainarr-aur
cd /tmp/domainarr-aur

# Copy PKGBUILD and generate .SRCINFO
cp /path/to/domainarr/pkg/aur/PKGBUILD .
makepkg --printsrcinfo > .SRCINFO

# Commit and push
git add PKGBUILD .SRCINFO
git commit -m "Initial upload"
git push
```

After this one-time setup, CI will automatically update the AUR package on each release.

### HOMEBREW_TAP_TOKEN

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token (classic) with `repo` scope
3. Add to GitHub secrets as `HOMEBREW_TAP_TOKEN`

## Manual Publishing

### Using Changesets locally

```bash
# Add a changeset
pnpm changeset

# Apply changesets and update versions
pnpm version

# Build and publish
pnpm release
```

### npm (manual)

```bash
pnpm build
npm publish --access public
```

### AUR (manual)

```bash
cd pkg/aur
# Update pkgver and sha256sums in PKGBUILD
makepkg --printsrcinfo > .SRCINFO
git add PKGBUILD .SRCINFO
git commit -m "Update to version X.Y.Z"
git push
```

## Troubleshooting

### npm publish fails with 403

- Ensure `NPM_TOKEN` is set and valid
- Check package name isn't taken
- Verify you're logged in: `npm whoami`

### AUR push fails

- Verify SSH key is added to AUR account
- Check `AUR_SSH_PRIVATE_KEY` secret is correctly formatted
- Ensure the AUR package exists (create it manually first)

### Homebrew formula fails

- Verify `HOMEBREW_TAP_TOKEN` has `repo` scope
- Check `homebrew-tap` repository exists
- Ensure `Formula/` directory exists in tap repo
