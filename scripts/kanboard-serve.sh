#!/usr/bin/env bash
# Kanboard on Docker Compose, Podman and Kubernetes (rt_serve, webship/workspace#841): the web container runs this as
# the host user, from the project's folder, once the project's database takes connections. The site's values go into
# the environment (PHP-FPM hands them to Kanboard), the folder of what Kanboard keeps beside its database (its data:
# files and cache, DATA_DIR) is made in the project, and then the image's own start runs: its entrypoint, then s6 with
# nginx (on 8080), PHP-FPM and the daily cronjob. On DDEV Kanboard's own container starts as its image says, and this is not used.
here="$(cd "$(dirname "$0")" && pwd)"
set -a
# shellcheck disable=SC1091
. "${here}/env" || exit 1
set +a
mkdir -p "${here}/data" || exit 1
# The image's own start opens /dev/stderr by its name (nginx, PHP-FPM), which the host user cannot open again when the
# container's own output belongs to root (the stack starts this through runuser): it becomes a pipe of this user's,
# which copies to the container's output.
exec > >(cat) 2>&1
exec /usr/local/bin/entrypoint.sh
