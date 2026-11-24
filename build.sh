#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
glib-compile-schemas schemas
echo "Schemas compiled."
