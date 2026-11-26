#!/usr/bin/env bash

# workspace-name: Kanboard (Kanban project management)

# Installed by the Kanboard plugin (plugins.sh --install kanboard); __WORKSPACE__ is the workspace it was installed into.
#
# Build a Kanboard site in containers from Kanboard's own image, on the project's own MariaDB: on DDEV at
# https://<name>.ddev.site. With --install the workspace account takes the place of the administrator Kanboard's schema
# starts with; with --add-users the default accounts are in their roles of the project Webship site; with
# --sample-content its tasks in the board's columns, one of them closed, a category, a tag, a comment and a subtask.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

# Distribution.
distribution_name="kanboard";
distribution_title="Kanboard";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} site in __WORKSPACE__"
# The args file comes with the plugin: core/scripts/plugins/kanboard/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/kanboard/args/arg-kanboard.sh || exit 1 ;

shift $#;

kanboard_build ;
