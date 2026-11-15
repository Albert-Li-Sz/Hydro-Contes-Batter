#!/usr/bin/env bash
set -euo pipefail

# Hydro's standard installation puts Node.js and PM2 in the Nix profile.
if [[ -d "$HOME/.nix-profile/bin" ]]; then
    export PATH="$PATH:$HOME/.nix-profile/bin"
fi
if ! command -v node >/dev/null 2>&1; then
    echo '请先加载 Hydro 的运行环境，确保 Node.js 22+ 和 hydrooj 命令可用。' >&2
    exit 1
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/scripts/manage-addon.mjs" "$@"
