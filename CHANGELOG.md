# domainarr

## 0.0.2

### Patch Changes

- [`a5365df`](https://github.com/ryanbas21/domainarr/commit/a5365df34438c61919c76518c0d9e71ac07c99ff) Thanks [@ryanbas21](https://github.com/ryanbas21)! - Add comprehensive test suite with 146 tests covering all services and domain models

- [`a5365df`](https://github.com/ryanbas21/domainarr/commit/a5365df34438c61919c76518c0d9e71ac07c99ff) Thanks [@ryanbas21](https://github.com/ryanbas21)! - Add cross-platform install script and expand installation documentation

  - Add `install.sh` for quick installation via `curl | sh`
  - Add RPM spec for Fedora COPR
  - Update README with comprehensive installation options (npm, Homebrew, AUR, COPR, binaries)
  - Add Repology badge for package status tracking
  - Optimize CI workflow with matrix strategy
  - Release workflow now depends on CI success

- [#6](https://github.com/ryanbas21/domainarr/pull/6) [`618be3c`](https://github.com/ryanbas21/domainarr/commit/618be3c69ea2133b80643b65d6e8ecdad8be4e06) Thanks [@ryanbas21](https://github.com/ryanbas21)! - Replace branching entry point with declarative layer graph, leveraging @effect/cli built-in help/wizard/completions

## 0.0.2

### Patch Changes

- [`a0933c0`](https://github.com/ryanbas21/domainarr/commit/a0933c039af5acf19c71a02eb7feeceeadfe712d) Thanks [@ryanbas21](https://github.com/ryanbas21)! - Add comprehensive test suite with 146 tests covering all services and domain models

- [`489f39e`](https://github.com/ryanbas21/domainarr/commit/489f39e41b94a8670a9eedcfa1bc1c270018cc63) Thanks [@ryanbas21](https://github.com/ryanbas21)! - Add cross-platform install script and expand installation documentation

  - Add `install.sh` for quick installation via `curl | sh`
  - Add RPM spec for Fedora COPR
  - Update README with comprehensive installation options (npm, Homebrew, AUR, COPR, binaries)
  - Add Repology badge for package status tracking
  - Optimize CI workflow with matrix strategy
  - Release workflow now depends on CI success

## 0.0.1

### Minor Changes

- Initial beta release of Domainarr - DNS sync CLI for Pi-hole and Cloudflare.

  Features:

  - Add/remove DNS records to both Pi-hole and Cloudflare simultaneously
  - List all records with sync status between providers
  - Sync Pi-hole records to Cloudflare (Pi-hole as source of truth)
  - Backup and restore DNS records to JSON files
  - Interactive setup wizard (`domainarr init`)
  - Cross-platform standalone binaries (Linux, macOS, Windows)

  Built with Effect TypeScript for robust error handling and type safety.
