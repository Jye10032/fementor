#!/bin/sh
set -eu
# Invoked by the trusted SDK exec as root, in NEW network/PID/mount namespaces.
# Never attach a veth, default route or host network socket to this namespace.
test "$(id -u)" = 0
ip link set lo up
case "${1:-}" in
  probe) target=/capabilities/network-probe.cjs ;;
  bridge) target=/capabilities/sandbox-bridge.cjs ;;
  *) exit 64 ;;
esac
exec setpriv --reuid=fementor --regid=fementor --init-groups \
  --no-new-privs --bounding-set=-all \
  env -i PATH=/opt/fementor/bin:/usr/local/bin:/usr/bin:/bin \
  HOME=/work/home CODEX_HOME=/work/home/.codex \
  /bin/sh -ec 'if [ "$1" != /capabilities/network-probe.cjs ]; then node /capabilities/network-probe.cjs --quiet; fi; exec node "$1"' sh "$target"
