#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project: its folder, its project in containers and its host name.')
parser.add_argument('--runtime',
                    dest='RUNTIME',
                    default="_none_",
                    choices=['ddev', 'docker', 'podman', 'kubernetes'],
                    help='The container runtime to build on: ddev (the default), docker (Docker Compose), podman or kubernetes. Kanboard is not proven on Lando or Docksal yet.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Set Kanboard up with the workspace account in the place of the administrator its schema starts with (admin, password admin), so no default password is left.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='With --install, add the default accounts (owner: the manager of the project Webship site, member: its member, reader: its viewer; stranger: not in it): the ones the test scenarios log in as.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='With --install and --add-users, add the sample content the step pack and the tracker are tested on: the tasks of Webship site in its columns, one of them closed, a category, a tag, a comment and a subtask.')
parser.add_argument('-v', '--release',
                    dest='KANBOARD_VERSION',
                    default="",
                    help='The release of the site (Kanboard\'s image is tagged v<release>): 1.2.58 by default. Example: --release 1.2.58')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
ARGEOF
