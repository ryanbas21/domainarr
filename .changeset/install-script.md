---
"domainarr": patch
---

Add cross-platform install script and expand installation documentation

- Add `install.sh` for quick installation via `curl | sh`
- Add RPM spec for Fedora COPR
- Update README with comprehensive installation options (npm, Homebrew, AUR, COPR, binaries)
- Add Repology badge for package status tracking
- Optimize CI workflow with matrix strategy
- Release workflow now depends on CI success
