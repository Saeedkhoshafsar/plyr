#!/usr/bin/env bash
# ============================================================================
# automation-backend — interactive installer
# ----------------------------------------------------------------------------
# A guided, confirmation-driven setup for both the SERVER (the backend itself)
# and the CLIENT-side helpers (Chrome extension + n8n community node).
#
# Usage:
#   chmod +x install.sh
#   ./install.sh                 # interactive menu
#   ./install.sh --server-docker # non-interactive: Docker stack (app + redis)
#   ./install.sh --server-node   # non-interactive: native Node install + PM2
#   ./install.sh --client        # non-interactive: build client helpers
#   ./install.sh --yes ...       # assume "yes" for all confirmations
#   ./install.sh --help
#
# Safe by design: every step that changes the system asks for confirmation
# (unless --yes is passed) and prints exactly what it is about to do.
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Pretty output helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"; DIM="$(printf '\033[2m')"; RESET="$(printf '\033[0m')"
  RED="$(printf '\033[31m')"; GREEN="$(printf '\033[32m')"; YELLOW="$(printf '\033[33m')"
  BLUE="$(printf '\033[34m')"; CYAN="$(printf '\033[36m')"
else
  BOLD=""; DIM=""; RESET=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; CYAN=""
fi

info()  { printf "%s\n" "${CYAN}ℹ ${*}${RESET}"; }
ok()    { printf "%s\n" "${GREEN}✔ ${*}${RESET}"; }
warn()  { printf "%s\n" "${YELLOW}⚠ ${*}${RESET}"; }
err()   { printf "%s\n" "${RED}✗ ${*}${RESET}" 1>&2; }
title() { printf "\n%s\n%s\n" "${BOLD}${BLUE}== ${*} ==${RESET}" "${DIM}$(printf '%.0s-' {1..60})${RESET}"; }

# Resolve the directory this script lives in (project root).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ASSUME_YES=0
MODE=""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
print_help() {
  cat <<EOF
${BOLD}automation-backend installer${RESET}

${BOLD}Targets${RESET}
  ${GREEN}server (docker)${RESET}  Run the full stack (app + redis) with Docker Compose.
                   The simplest path — bundles Chromium + system deps.
  ${GREEN}server (node)${RESET}    Install Node deps + Playwright Chromium natively,
                   build, and run under PM2 (with optional systemd unit).
  ${GREEN}client${RESET}           Build the client-side helpers on this machine:
                   the Chrome extension and the n8n community node.

${BOLD}Options${RESET}
  --server-docker      Non-interactive Docker server install
  --server-node        Non-interactive native Node server install
  --client             Non-interactive client helpers build
  -y, --yes            Assume "yes" for all confirmations
  -h, --help           Show this help

With no flags, an interactive menu is shown.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --server-docker) MODE="server-docker" ;;
    --server-node)   MODE="server-node" ;;
    --client)        MODE="client" ;;
    -y|--yes)        ASSUME_YES=1 ;;
    -h|--help)       print_help; exit 0 ;;
    *) err "Unknown option: $1"; print_help; exit 1 ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Confirmation prompt (respects --yes)
# ---------------------------------------------------------------------------
confirm() {
  # confirm "Question?" [default:Y|N]
  local prompt="${1:-Proceed?}"
  local default="${2:-Y}"
  if [ "$ASSUME_YES" = "1" ]; then
    info "$prompt ${DIM}(auto-yes)${RESET}"
    return 0
  fi
  local hint="[Y/n]"; [ "$default" = "N" ] && hint="[y/N]"
  local reply
  read -r -p "${YELLOW}» ${prompt} ${hint} ${RESET}" reply || true
  reply="${reply:-$default}"
  case "$reply" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Tool detection helpers
# ---------------------------------------------------------------------------
has() { command -v "$1" >/dev/null 2>&1; }

require_node() {
  if ! has node; then
    err "Node.js is not installed. Install Node.js >= 20 first: https://nodejs.org"
    return 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -lt 20 ]; then
    warn "Node.js ${major}.x detected; the project targets Node >= 20. Continuing anyway."
  else
    ok "Node.js $(node -v) detected."
  fi
}

detect_pkg_mgr() {
  if has apt-get; then echo "apt"; elif has dnf; then echo "dnf";
  elif has yum; then echo "yum"; elif has pacman; then echo "pacman";
  elif has brew; then echo "brew"; else echo ""; fi
}

# Run a command with sudo only if not already root.
maybe_sudo() {
  if [ "$(id -u)" = "0" ]; then "$@"; else sudo "$@"; fi
}

# ---------------------------------------------------------------------------
# .env bootstrap (shared by both server paths)
# ---------------------------------------------------------------------------
ensure_env_file() {
  if [ -f .env ]; then
    ok ".env already exists — leaving it untouched."
    return 0
  fi
  if [ ! -f .env.example ]; then
    err ".env.example not found; cannot create .env."
    return 1
  fi
  if confirm "Create .env from .env.example now?"; then
    cp .env.example .env
    ok "Created .env"
    # Offer to generate a stable API_TOKEN for single mode.
    if confirm "Generate a random API_TOKEN for single-user mode and write it into .env?"; then
      local token
      if has node; then
        token="tok_$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
      elif has openssl; then
        token="tok_$(openssl rand -hex 24)"
      else
        token="tok_$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      fi
      # Replace the API_TOKEN= line (BSD/GNU sed compatible).
      if grep -q '^API_TOKEN=' .env; then
        if sed --version >/dev/null 2>&1; then
          sed -i "s|^API_TOKEN=.*|API_TOKEN=${token}|" .env
        else
          sed -i '' "s|^API_TOKEN=.*|API_TOKEN=${token}|" .env
        fi
      else
        printf "\nAPI_TOKEN=%s\n" "$token" >> .env
      fi
      ok "Wrote API_TOKEN to .env"
      printf "%s\n" "  ${BOLD}API_TOKEN=${token}${RESET}"
      printf "%s\n" "  ${DIM}Send it as: Authorization: Bearer <API_TOKEN>${RESET}"
    fi
  else
    warn "Skipped .env creation. The server needs a .env to run."
  fi
}

# ---------------------------------------------------------------------------
# SERVER — Docker path
# ---------------------------------------------------------------------------
install_server_docker() {
  title "Server install — Docker Compose (app + redis)"

  if ! has docker; then
    err "Docker is not installed. Install Docker Engine first: https://docs.docker.com/engine/install/"
    return 1
  fi
  # docker compose (v2) or docker-compose (v1)
  local COMPOSE=""
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif has docker-compose; then
    COMPOSE="docker-compose"
  else
    err "Docker Compose not found. Install the Compose plugin: https://docs.docker.com/compose/install/"
    return 1
  fi
  ok "Using: ${COMPOSE}"

  ensure_env_file

  info "About to build and start the stack:"
  printf "    %s up -d --build\n" "$COMPOSE"
  if ! confirm "Build and start the Docker stack now?"; then
    warn "Aborted by user. You can run it later with: ${COMPOSE} up -d --build"
    return 0
  fi

  $COMPOSE up -d --build
  ok "Stack started."
  info "Service URL:    http://localhost:3000"
  info "Health check:   http://localhost:3000/health"
  info "Follow logs:    ${COMPOSE} logs -f app"
  info "Stop the stack: ${COMPOSE} down"

  # Surface the auto-generated token from logs if API_TOKEN was left empty.
  if [ -f .env ] && grep -q '^API_TOKEN=$' .env 2>/dev/null; then
    warn "API_TOKEN is empty in .env — a random one is generated at boot."
    info "Reveal it with: ${COMPOSE} logs app | grep API_TOKEN"
  fi
}

# ---------------------------------------------------------------------------
# SERVER — native Node path
# ---------------------------------------------------------------------------
install_redis_native() {
  if has redis-server || has redis-cli; then
    ok "Redis appears to be installed."
    return 0
  fi
  warn "Redis is not installed."
  local pm; pm="$(detect_pkg_mgr)"
  case "$pm" in
    apt)
      if confirm "Install redis-server via apt-get (needs sudo)?"; then
        maybe_sudo apt-get update
        maybe_sudo apt-get install -y redis-server
        maybe_sudo systemctl enable --now redis-server 2>/dev/null || true
        ok "Redis installed."
      fi ;;
    dnf|yum)
      if confirm "Install redis via ${pm} (needs sudo)?"; then
        maybe_sudo "$pm" install -y redis
        maybe_sudo systemctl enable --now redis 2>/dev/null || true
        ok "Redis installed."
      fi ;;
    pacman)
      if confirm "Install redis via pacman (needs sudo)?"; then
        maybe_sudo pacman -S --noconfirm redis
        maybe_sudo systemctl enable --now redis 2>/dev/null || true
        ok "Redis installed."
      fi ;;
    brew)
      if confirm "Install redis via Homebrew?"; then
        brew install redis
        brew services start redis 2>/dev/null || true
        ok "Redis installed."
      fi ;;
    *)
      warn "Could not detect a package manager. Install Redis manually, or run it with Docker:"
      printf "    docker run -d --name redis -p 6379:6379 redis:7-alpine\n" ;;
  esac
}

install_server_node() {
  title "Server install — native Node.js + PM2"

  require_node || return 1

  install_redis_native

  info "About to install npm dependencies (npm install)."
  if confirm "Run 'npm install' now?"; then
    npm install
    ok "Dependencies installed."
  else
    warn "Skipped npm install — the server cannot run without it."
  fi

  # Playwright Chromium (+ optional system deps)
  if confirm "Install the Playwright Chromium browser now?"; then
    if confirm "Also install system libraries for Chromium (needs sudo, recommended on a fresh server)?" "N"; then
      npm run install:browser:deps
    else
      npm run install:browser
    fi
    ok "Browser ready."
  fi

  ensure_env_file

  info "About to build the project (npm run build -> dist/)."
  if confirm "Build now?"; then
    npm run build
    ok "Build complete."
  fi

  # Process manager
  title "Run the server"
  if confirm "Start the server under PM2 (cluster mode, auto-restart)?"; then
    if ! has pm2; then
      if confirm "PM2 is not installed. Install it globally (npm i -g pm2)?"; then
        npm install -g pm2 || maybe_sudo npm install -g pm2
      fi
    fi
    if has pm2; then
      pm2 start ecosystem.config.js
      pm2 save || true
      ok "Server started under PM2."
      info "Status: pm2 status   |   Logs: pm2 logs Hybrid-Automation --nostream"
      if confirm "Generate a systemd startup unit so PM2 resurrects on boot?" "N"; then
        pm2 startup || warn "Run the command PM2 printed above (it needs sudo) to finish."
      fi
    else
      warn "PM2 unavailable. You can run the server directly with: npm start"
    fi
  else
    info "Start it later with either:"
    printf "    npm start                       %s\n" "${DIM}# single process${RESET}"
    printf "    pm2 start ecosystem.config.js   %s\n" "${DIM}# cluster${RESET}"
  fi

  ok "Server URL (default): http://localhost:3000  (health: /health)"
}

# ---------------------------------------------------------------------------
# CLIENT — extension + n8n node
# ---------------------------------------------------------------------------
install_client() {
  title "Client helpers — Chrome extension + n8n community node"
  require_node || return 1

  # --- Chrome extension (no build step; load unpacked) ---
  if [ -d extension ]; then
    info "Chrome extension is a plain MV3 extension (no build needed)."
    if confirm "Show instructions to load the Chrome extension?"; then
      cat <<EOF
${BOLD}Load the Chrome extension:${RESET}
  1. Open  chrome://extensions
  2. Enable ${BOLD}Developer mode${RESET} (top-right toggle)
  3. Click ${BOLD}Load unpacked${RESET}
  4. Select this folder:
       ${CYAN}${SCRIPT_DIR}/extension${RESET}
  5. Open the extension popup and set your server URL + API token.
EOF
    fi
  else
    warn "extension/ folder not found — skipping."
  fi

  # --- n8n community node (build + optional local link) ---
  if [ -d n8n-node ]; then
    title "n8n community node"
    info "This builds the n8n node package (TypeScript -> dist) in ./n8n-node."
    if confirm "Install deps and build the n8n node now?"; then
      ( cd n8n-node && npm install && npm run build )
      ok "n8n node built at ${SCRIPT_DIR}/n8n-node/dist"

      # Offer to install it into the user's ~/.n8n custom extensions folder.
      local N8N_CUSTOM="${HOME}/.n8n/custom"
      info "n8n loads community nodes from: ${N8N_CUSTOM}"
      if confirm "Install (npm install) the built node into ${N8N_CUSTOM}?" "N"; then
        mkdir -p "$N8N_CUSTOM"
        ( cd "$N8N_CUSTOM" && npm init -y >/dev/null 2>&1 || true && npm install "${SCRIPT_DIR}/n8n-node" )
        ok "Installed into ${N8N_CUSTOM}. Restart n8n to pick it up."
      else
        info "Manual option: in n8n, install community node 'n8n-nodes-automationbackend',"
        info "or run:  cd ~/.n8n/custom && npm install \"${SCRIPT_DIR}/n8n-node\""
      fi
    fi
  else
    warn "n8n-node/ folder not found — skipping."
  fi

  ok "Client helpers done."
  info "Point both helpers at your server URL and API token (single mode: the API_TOKEN)."
}

# ---------------------------------------------------------------------------
# Interactive menu
# ---------------------------------------------------------------------------
menu() {
  title "automation-backend installer"
  cat <<EOF
What would you like to install on ${BOLD}this machine${RESET}?

  ${BOLD}1)${RESET} Server (Docker)   ${DIM}— app + redis via docker compose (easiest)${RESET}
  ${BOLD}2)${RESET} Server (Node)     ${DIM}— native Node + Playwright + PM2${RESET}
  ${BOLD}3)${RESET} Client            ${DIM}— Chrome extension + n8n node helpers${RESET}
  ${BOLD}4)${RESET} Quit
EOF
  local choice
  read -r -p "${YELLOW}» Choose [1-4]: ${RESET}" choice || true
  case "$choice" in
    1) install_server_docker ;;
    2) install_server_node ;;
    3) install_client ;;
    4|q|Q) info "Bye."; exit 0 ;;
    *) err "Invalid choice."; exit 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
main() {
  case "$MODE" in
    server-docker) install_server_docker ;;
    server-node)   install_server_node ;;
    client)        install_client ;;
    "")            menu ;;
  esac
  printf "\n%s\n" "${GREEN}${BOLD}Done.${RESET}"
}

main "$@"
