#!/usr/bin/env bash

# Installed by the Kanboard plugin (plugins.sh --install kanboard); __WORKSPACE__ is the workspace it was installed into.
#
# A Kanboard site of this folder: what it is and its accounts; --run one of Kanboard's own commands in its container;
# --add-users and --cancel-users the default accounts; --sample-content the sample content; --tidy what a stopped test
# run left; --connect the dashboard's Kanboard to this site.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

ARGPARSE_DESCRIPTION="A Kanboard site of __WORKSPACE__: what it is, its accounts, Kanboard's own commands"
# The args file comes with the plugin: core/scripts/plugins/kanboard/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/kanboard/args/arg-kanboard-cli.sh || exit 1 ;

shift $#;

kanboard_cli_tool ;
