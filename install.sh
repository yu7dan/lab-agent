#!/usr/bin/env bash
set -euo pipefail

# Lab Agent CLI installer.
#
#   curl -fsSL https://raw.githubusercontent.com/yu7dan/lab-agent/main/install.sh | bash
#   curl -fsSL ... | bash -s -- --from-source
#
# Environment:
#   LAB_AGENT_INSTALL_DIR  install root (default: ~/.local/share/lab-agent)
#   LAB_AGENT_BIN_DIR      symlink directory (default: ~/.local/bin)
#   LAB_AGENT_VERSION      release tag (default: latest)

REPO="yu7dan/lab-agent"
INSTALL_DIR="${LAB_AGENT_INSTALL_DIR:-$HOME/.local/share/lab-agent}"
BIN_DIR="${LAB_AGENT_BIN_DIR:-$HOME/.local/bin}"
VERSION="${LAB_AGENT_VERSION:-latest}"
FROM_SOURCE=0
RELEASE_TMP=""

for arg in "$@"; do
  case "$arg" in
    --from-source) FROM_SOURCE=1 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info() { printf "${CYAN}[*]${RESET} %s\n" "$*"; }
ok()   { printf "${GREEN}[+]${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${RESET} %s\n" "$*"; }
fail() { printf "${RED}[x]${RESET} %s\n" "$*" >&2; exit 1; }

detect_platform() {
  case "$(uname -s)" in
    Darwin) OS="darwin" ;;
    Linux)  OS="linux" ;;
    *)      fail "Unsupported OS: $(uname -s). Use install.ps1 on Windows." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac
  PLATFORM="${OS}-${ARCH}"
  ok "Platform: ${PLATFORM}"
}

require_curl() {
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl is required for prebuilt installs."
    return 1
  fi
}

download() {
  local url="$1" out="$2"
  info "Downloading $(basename "$out")"
  if ! curl -fL --retry 3 --connect-timeout 15 "$url" -o "$out"; then
    warn "Download failed: $url"
    return 1
  fi
}

verify_checksum() {
  local file="$1" sums="$2" name line
  name="$(basename "$file")"
  [ -f "$sums" ] || { warn "No SHA256SUMS in release; skipping checksum."; return; }
  line="$(grep " ${name}\$" "$sums" || true)"
  [ -n "$line" ] || { warn "No checksum entry for ${name}; skipping."; return; }
  if command -v sha256sum >/dev/null 2>&1; then
    if ! (
      cd "$(dirname "$file")" &&
        printf '%s\n' "$line" | sha256sum -c - >/dev/null
    ); then
      fail "Checksum verification failed for $(basename "$file")."
    fi
  elif command -v shasum >/dev/null 2>&1; then
    if ! (
      cd "$(dirname "$file")" &&
        printf '%s\n' "$line" | shasum -a 256 -c - >/dev/null
    ); then
      fail "Checksum verification failed for $(basename "$file")."
    fi
  else
    warn "No sha256sum/shasum available; skipping checksum."
    return
  fi
  ok "Checksum verified"
}

install_release() {
  require_curl || return 1
  local base url
  RELEASE_TMP="$(mktemp -d)"
  trap 'rm -rf "${RELEASE_TMP:-}"' EXIT
  base="https://github.com/${REPO}/releases"
  if [ "$VERSION" = "latest" ]; then
    base="${base}/latest/download"
  else
    base="${base}/download/${VERSION}"
  fi

  url="${base}/lab-agent-${PLATFORM}.tar.gz"
  download "$url" "$RELEASE_TMP/lab-agent.tar.gz" || return 1
  download "${base}/SHA256SUMS" "$RELEASE_TMP/SHA256SUMS" || warn "SHA256SUMS not available."
  verify_checksum "$RELEASE_TMP/lab-agent.tar.gz" "$RELEASE_TMP/SHA256SUMS"

  mkdir -p "$INSTALL_DIR/bin"
  if ! tar -xzf "$RELEASE_TMP/lab-agent.tar.gz" -C "$INSTALL_DIR/bin"; then
    warn "Could not extract the release archive."
    return 1
  fi
  # Release archives contain lab and lab-engine at their root.
  for f in lab lab-engine; do
    [ -f "$INSTALL_DIR/bin/$f" ] || fail "Archive is missing $f"
    chmod +x "$INSTALL_DIR/bin/$f"
  done
}

install_source() {
  command -v git >/dev/null 2>&1 || fail "git is required for --from-source."
  command -v bun >/dev/null 2>&1 || fail "Bun is required for --from-source: https://bun.sh"
  local src="$INSTALL_DIR/src"
  mkdir -p "$INSTALL_DIR"
  if [ -d "$src/.git" ]; then
    info "Updating source"
    git -C "$src" pull --ff-only
  else
    info "Cloning ${REPO}"
    git clone --depth 1 "https://github.com/${REPO}.git" "$src"
  fi
  info "Installing dependencies and building"
  (cd "$src" && bun install --frozen-lockfile 2>/dev/null || bun install)
  (cd "$src" && bun run compile)
  mkdir -p "$INSTALL_DIR/bin"
  cp "$src/dist/lab" "$src/dist/lab-engine" "$INSTALL_DIR/bin/"
  chmod +x "$INSTALL_DIR/bin/lab" "$INSTALL_DIR/bin/lab-engine"
}

link_binary() {
  mkdir -p "$BIN_DIR"
  ln -sf "$INSTALL_DIR/bin/lab" "$BIN_DIR/lab"
  ok "Linked $BIN_DIR/lab"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *)
      warn "$BIN_DIR is not on PATH. Add this to your shell profile:"
      printf "${BOLD}    export PATH=\"%s:\$PATH\"${RESET}\n" "$BIN_DIR"
      ;;
  esac
}

main() {
  echo ""
  printf "${BOLD}Lab Agent CLI installer${RESET}\n"
  echo ""
  detect_platform
  mkdir -p "$INSTALL_DIR/bin"

  if [ "$FROM_SOURCE" = "1" ]; then
    install_source
  elif ! install_release; then
    warn "No prebuilt CLI release is available; falling back to a source build."
    install_source
  fi

  link_binary
  echo ""
  ok "Installed $( "$INSTALL_DIR/bin/lab" version 2>/dev/null || echo 'Lab Agent CLI' )"
  echo ""
  echo "Next:"
  echo "  lab setup     # configure a provider and API key"
  echo "  lab doctor    # verify the engine and connection"
  echo "  lab           # start coding"
  echo ""
}

main
