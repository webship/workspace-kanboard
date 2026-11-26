#!/usr/bin/env bash

# Kanboard for the Webship Workspace: build a site of Kanboard (the open-source Kanban project management software)
# from its own image, run Kanboard's own console in its container, add its default accounts and their roles in a
# sample project, add its sample content, and wire its step pack into the testing setup.
#
# Placed by `plugins.sh --install kanboard` in core/scripts/plugins/kanboard/functions/, where bootstrap sources it
# after the core's own functions. Everything runs in containers, never on the host:
#   - DDEV (the default): Kanboard's image is a service of a generic project, on the project's own MariaDB (the db
#     service), at https://<name>.ddev.site; the project's web container keeps the mail catcher.
#   - Docker Compose, Podman and Kubernetes (--runtime docker|podman|kubernetes), through the core's runtime layer:
#     Kanboard's image is the web container's (rt_stack image), and its own start (its entrypoint: a certificate, then
#     s6 with nginx, PHP-FPM and the daily cronjob) runs as the host user (rt_serve), on the project's own MariaDB, at the
#     address the runtime gives it (http://127.0.0.1:<port>, or the node's address on Kubernetes); the stack's Mailpit
#     catches the site's mail.
# Lando and Docksal are not proven yet: asked for one, the builder says so and changes nothing.
# The site's accounts and content go through Kanboard's own code in its container (kanboard-site.php, on its models):
# what it reads (accounts, passwords) comes on its input, never on a command line. Kanboard's core only: no plugin of
# its directory is installed.
#
# The container tool has no project type for Kanboard, so a site of this plugin is recognised by a file on DDEV
# (.ddev/config.kanboard.yaml, written by the builder).
# Four names are the ones the core's tools look for:
#   set_kanboard_users          the default accounts                     (cmd-tools-add-users.sh <project> kanboard)
#   add_kanboard_users          make them, and their roles               (the same tool, and --add-users of the builder)
#   cancel_kanboard_users       keep them from logging in                (cmd-tools-cancel-users.sh <project> kanboard)
#   testing_configure_kanboard  the step pack in the testing stack       (cmd-tools-testing.sh <project>)

# The step pack a site is tested with, and the release line it is required at.
readonly KANBOARD_STEPS_PACKAGE='@webship-js/kanboard-steps';
readonly KANBOARD_STEPS_VERSION='^2.0.0';

# The release the builder runs when none is asked for (Kanboard's image is tagged v<release>).
readonly KANBOARD_DEFAULT_RELEASE='1.2.58';

# The sample project the default accounts are in, and the folder of a site with the plugin's scripts and the site's
# own values (its container reads them at /opt/webship).
readonly KANBOARD_PROJECT_NAME='Webship site';
readonly KANBOARD_FILES='kanboard';

# The free memory a build asks for, in MB: Kanboard's web server and PHP, beside MariaDB.
readonly KANBOARD_MEMORY_MB=1024;

# On another runtime than DDEV: the port nginx listens on in the web container (a user's port: the image's own start
# runs as the host user there), and where Kanboard's code is in it (where its image keeps it).
readonly KANBOARD_SERVE_PORT=8080;
readonly KANBOARD_CODE='/var/www/app';

# The database of the project: Kanboard supports SQLite, MySQL, MariaDB and PostgreSQL; the Workspace uses MariaDB,
# so a site's database is the same on every runtime.
readonly KANBOARD_DATABASE='mariadb:11.4';

# The default accounts, the ones a scenario logs in as, each with a role in the sample project: its manager (owner,
# who manages projects on the site too), a member (member), a viewer (reader), and an account the project does not
# have (stranger), whom it is refused. Kanboard logs in by username and shows the name. Accounts are configuration,
# made once on the site; a test suite never creates or deletes one. The workspace account the builder puts in the
# place of Kanboard's own administrator with --install is the site's administrator and is not in this list.
function set_kanboard_users() {
  users=(owner member reader stranger);
  local user ;
  for user in "${users[@]}" ; do
    printf -v "user_${user}_name" '%s' "${user}" ;
    printf -v "user_${user}_mail" '%s' "${user}@example.com" ;
    printf -v "user_${user}_password" '%s' 'dD.123123ddd' ;
    printf -v "user_${user}_fullname" '%s' "${user^} Test" ;
    printf -v "user_${user}_role" '%s' "${user}" ;
  done
  user_stranger_role='' ;
}

# The runtime of the project in this folder, or of a new build (--runtime, else the workspace's setting, else DDEV).
# A core without the runtime layer has DDEV only.
function kanboard_runtime() {
  if declare -f runtime_of > /dev/null ; then runtime_of "$@" ; else echo 'ddev' ; fi
}

# The address of the site in this folder (or of a new build named PROJECT_NAME, on DDEV); on another runtime the one
# the runtime gives it.
function kanboard_url() {
  if [ "$(kanboard_runtime)" != 'ddev' ] && declare -f rt_url > /dev/null ; then rt_url ; return ; fi
  echo "https://${1:-${PROJECT_NAME}}.ddev.site" ;
}

# Is this folder a Kanboard site of this plugin? On DDEV the builder leaves .ddev/config.kanboard.yaml in it; on
# another runtime the project carries the plugin's claim.
function kanboard_is_project() {
  local project_path="$1" ;
  [ -f "${project_path}/.ddev/config.kanboard.yaml" ] && return 0 ;
  if declare -f rt_is_platform > /dev/null ; then rt_is_platform "${project_path}" kanboard ; return $? ; fi
  return 1 ;
}

# Go to the project a tool was asked about, or say why not.
function kanboard_enter_project() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  if [ ! -d "${project_path}" ] ; then
    echo "No project ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}." ;
    return 1 ;
  fi
  if ! kanboard_is_project "${project_path}" ; then
    echo "${doc_name}/${PROJECT_NAME} is not a Kanboard site of this plugin." ;
    return 1 ;
  fi
  kanboard_refresh_files "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;
}

# The site's copy of the plugin's scripts (kanboard/), brought up to the installed plugin's, so a plugin updated with
# --install reaches the sites built before it. The site's own values (kanboard/env) are left as they are.
function kanboard_refresh_files() {
  local project_path="$1" from="${WORKSPACE_SCRIPTS}/plugins/kanboard" f ;
  [ -d "${project_path}/${KANBOARD_FILES}" ] || return 0 ;
  for f in kanboard-site.php kanboard-serve.sh ; do
    if [ -f "${from}/${f}" ] && ! cmp -s "${from}/${f}" "${project_path}/${KANBOARD_FILES}/${f}" ; then
      cp "${from}/${f}" "${project_path}/${KANBOARD_FILES}/${f}" || return 1 ;
    fi
  done
}

# A value of the site's own values (kanboard/env), never printed by the tools: KANBOARD_RELEASE.
function kanboard_setting() {
  sed -n "s/^$1=\\(.*\\)\$/\\1/p" "${2:-.}/${KANBOARD_FILES}/env" 2>/dev/null | head -n 1 ;
}

# The free memory of this machine, in MB (what the kernel says is available).
function kanboard_free_memory() {
  awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null ;
}

# Write the project's files: the plugin's scripts; on DDEV Kanboard's service (.ddev/docker-compose.kanboard.yaml), its
# image in .ddev/.env and the claim (.ddev/config.kanboard.yaml); on another runtime the claim, Kanboard's image as the
# web container's, what the project's web image adds to it, and its server.
function kanboard_write_config() {
  local project_path="$1" release="$2" runtime="${3:-ddev}" ;
  local from="${WORKSPACE_SCRIPTS}/plugins/kanboard" f ;
  for f in docker-compose.kanboard.yaml kanboard-site.php kanboard-serve.sh ; do
    if [ ! -f "${from}/${f}" ] ; then
      echo "${f} is not in ${from}: install the plugin (plugins.sh --install kanboard)." ;
      return 1 ;
    fi
  done
  mkdir -p "${project_path}/${KANBOARD_FILES}" || return 1 ;
  cp "${from}/kanboard-site.php" "${from}/kanboard-serve.sh" "${project_path}/${KANBOARD_FILES}/" || return 1 ;

  if [ "${runtime}" != 'ddev' ] ; then
    # Another runtime: Kanboard's image is the web container's, and the stack starts it as the host user.
    ( cd "${project_path}" \
      && rt_claim kanboard \
      && rt_stack image "docker.io/kanboard/kanboard:v${release}" \
      && rt_web_build kanboard <<'DOCKEREOF'
# Kanboard's image is the web container's here (rt_stack image): its code stays where its image keeps it (/var/www/app),
# and the stack mounts the project on /var/www/html. The image's own start (its entrypoint, then s6 with nginx, PHP-FPM
# and the daily cronjob) runs as the host user, www-data with the host's UID by now, so: nginx listens on 8080, plain
# http, with no certificate (a user has no port under 1024, and the stack's address is http), and the entrypoint makes
# none: on Podman the folder Kanboard's image declares for it is an empty volume, which a user cannot write; PHP-FPM
# runs its pool as the user it starts as; s6's service folders, the socket, the pid, nginx's temporary files and the
# folders the image declares as its data and plugins volumes are the host user's, so the entrypoint's chown of them has
# nothing to do; Kanboard keeps its data in the project's kanboard/data (DATA_DIR, in the site's values), and its
# plugins where its image does; and the daily cronjob runs at 08:00, as Kanboard's crontab says, from the cron service
# itself: BusyBox's crond needs root to run a job ("can't set groups"). tini is the container's first process, and the
# stack's start runs under it.
RUN apk add --no-cache tini \
  && sed -i -e '/^user nginx;/d' -e 's#^pid /var/run/nginx.pid;#pid /run/nginx.pid;#' -e 's/listen  *80;/listen 8080;/' -e '/listen  *443 ssl;/d' -e '/^ *ssl_/d' /etc/nginx/nginx.conf \
  && if grep -qE '^user |listen +(80|443)[ ;]|ssl_certificate' /etc/nginx/nginx.conf ; then echo "Kanboard's image serves nginx in a way the Kanboard plugin does not know: build this release on DDEV, or update the plugin." >&2 ; exit 1 ; fi \
  && sed -i -e '/^user = /d' -e '/^group = /d' -e '/^listen.owner = /d' -e '/^listen.group = /d' /etc/php*/php-fpm.conf /etc/php*/php-fpm.d/*.conf \
  && sed -i -e 's#^ *openssl req .*#    : no certificate: nginx serves plain http on 8080 here#' -e 's#^chown -R nginx:nginx /var/www/app/data$#: the host user owns /var/www/app/data already#' -e 's#^chown -R nginx:nginx /var/www/app/plugins$#: the host user owns /var/www/app/plugins already#' /usr/local/bin/entrypoint.sh \
  && if grep -qE '^ *(openssl|chown) ' /usr/local/bin/entrypoint.sh ; then echo "Kanboard's entrypoint does what the Kanboard plugin does not know: build this release on DDEV, or update the plugin." >&2 ; exit 1 ; fi \
  && printf '%s\n' '#!/bin/sh' '# Kanboard'"'"'s daily cronjob at 08:00 (its crontab: 0 8 * * *), as the host user.' 'while : ; do' '  now=$(date +%s) ; next=$(date -d "$(date +%Y-%m-%d) 08:00" +%s)' '  [ "${next}" -le "${now}" ] && next=$((next + 86400))' '  sleep $((next - now))' '  cd /var/www/app && php ./cli cronjob > /dev/null 2>&1' 'done' > /etc/services.d/cron/run \
  && chmod 755 /etc/services.d/cron/run \
  && chown -R www-data:www-data /etc/services.d /run /var/lib/nginx /var/log/nginx /var/www/app/data /var/www/app/plugins
ENTRYPOINT ["/sbin/tini", "--"]
# Kanboard's own health check (its healthcheck.php), on the port nginx listens on here.
HEALTHCHECK --timeout=5s --start-period=3s CMD curl -f http://127.0.0.1:8080/healthcheck.php || exit 1
DOCKEREOF
    ) || return 1 ;
    ( cd "${project_path}" && rt_serve "${KANBOARD_SERVE_PORT}" "bash ${KANBOARD_FILES}/kanboard-serve.sh" ) || return 1 ;
    return 0 ;
  fi

  cp "${from}/docker-compose.kanboard.yaml" "${project_path}/.ddev/docker-compose.kanboard.yaml" || return 1 ;
  printf 'KANBOARD_IMAGE=%s\n' "docker.io/kanboard/kanboard:v${release}" > "${project_path}/.ddev/.env" || return 1 ;
  cat > "${project_path}/.ddev/config.kanboard.yaml" <<YAMLEOF
# Kanboard in this project: its service (docker-compose.kanboard.yaml), its image in .env, the site's own values in
# ../kanboard/env. Written by the Kanboard builder of the workspace; build again rather than editing.
web_environment:
  - KANBOARD_RELEASE=${release}
YAMLEOF
}

# The site's own values (kanboard/env, which only you can read): the address, the project's database and the mail
# catcher. Kanboard keeps no secret of its own in its environment: the token of its API is made in its database.
function kanboard_write_env() {
  local project_path="$1" release="$2" base_url="$3" runtime="${4:-ddev}" mail='web' data='' ;
  # The mail catcher: DDEV's web container on DDEV, the stack's own Mailpit elsewhere; elsewhere Kanboard's data (its
  # files, its cache) in the project's kanboard/data, the host user's (on DDEV a volume named after the project).
  if [ "${runtime}" != 'ddev' ] ; then mail='mail' ; data="DATA_DIR=/var/www/html/${KANBOARD_FILES}/data" ; fi
  ( umask 077 && cat > "${project_path}/${KANBOARD_FILES}/env" <<ENVEOF
# The values of this Kanboard site, made by the Kanboard builder of the workspace. Read by Kanboard's container; never
# printed.
KANBOARD_RELEASE=${release}
KANBOARD_URL=${base_url}
DB_DRIVER=mysql
DB_HOSTNAME=db
DB_PORT=3306
DB_USERNAME=db
DB_PASSWORD=db
DB_NAME=db
MAIL_TRANSPORT=smtp
MAIL_SMTP_HOSTNAME=${mail}
MAIL_SMTP_PORT=1025
MAIL_FROM=kanboard@example.com
${data}
ENVEOF
  ) ;
}

# Run a command line where Kanboard's code is (/var/www/app); what is piped in reaches it. On DDEV in Kanboard's own
# container; on another runtime in the web container, as the host user, with the site's values.
function kanboard_exec() {
  if [ "$(kanboard_runtime)" = 'ddev' ] ; then
    ddev exec -s kanboard "sh -c $(printf '%q' "cd /var/www/app && ${1}")" ;
  else
    ddev exec "set -a ; . /var/www/html/${KANBOARD_FILES}/env ; set +a ; cd ${KANBOARD_CODE} && ${1}" ;
  fi
}

# The folder the plugin's scripts are read from where Kanboard runs.
function kanboard_scripts_dir() {
  if [ "$(kanboard_runtime)" = 'ddev' ] ; then echo '/opt/webship' ; else echo "/var/www/html/${KANBOARD_FILES}" ; fi
}

# Where Kanboard answers inside the project's network: on DDEV its own service, from the web container; on another
# runtime its nginx, in the web container itself.
function kanboard_inside_url() {
  if [ "$(kanboard_runtime)" = 'ddev' ] ; then echo 'http://kanboard' ; else echo "http://127.0.0.1:${KANBOARD_SERVE_PORT}" ; fi
}

# The answer of Kanboard's login page, asked inside the project's network: 200 once Kanboard reaches its database (it
# makes its tables on its first request).
function kanboard_probe() {
  ddev exec "curl -s -o /dev/null -m 15 -w '%{http_code}' $(kanboard_inside_url)/login" < /dev/null 2>/dev/null | tr -d '\r' | tail -1 ;
}

# Wait until the site answers, in the project's folder: up to five minutes.
function kanboard_wait() {
  local attempt code="" ;
  for attempt in $(seq 1 100) ; do
    code="$(kanboard_probe)" ;
    [ "${code}" = '200' ] && return 0 ;
    sleep 3 ;
  done
  echo "Kanboard did not answer (its login page: ${code:-none}); the end of its log:" ;
  if [ "$(kanboard_runtime)" = 'ddev' ] ; then ddev logs -s kanboard --tail 40 < /dev/null 2>/dev/null ; else ddev logs --tail 40 < /dev/null 2>/dev/null ; fi
  return 1 ;
}

# Run verbs of kanboard-site.php (version, install, accounts, content, tidy, list, token, counts) with Kanboard's own
# code in its container. A payload (an account, passwords, a login) travels on the input, never on a command line.
function kanboard_site() {
  kanboard_exec "php $(kanboard_scripts_dir)/kanboard-site.php $*" ;
}

# The release the site runs, as Kanboard says it.
function kanboard_version() {
  ( cd "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" 2>/dev/null && kanboard_site version < /dev/null 2>/dev/null ) | tr -d '\r' | sed -n 's/^VERSION //p' | tail -n 1 ;
}

# The payload of kanboard-site.php, as the base64 of its JSON. For install: the workspace account (its login, address,
# password and name in KANBOARD_LOGIN, _MAIL, _PASSWORD, _NAME). For accounts: rows ("login|mail|password|name|role|
# action" lines in KANBOARD_ROWS). Both travel to Python in the environment, never on a command line.
function kanboard_install_payload() {
  KANBOARD_LOGIN="$1" KANBOARD_MAIL="$2" KANBOARD_PASSWORD="$3" KANBOARD_NAME="$4" python3 -c '
import base64, json, os
print(base64.b64encode(json.dumps({"login": os.environ["KANBOARD_LOGIN"], "mail": os.environ["KANBOARD_MAIL"],
      "password": os.environ["KANBOARD_PASSWORD"], "name": os.environ["KANBOARD_NAME"]}).encode()).decode())' ;
}

function kanboard_accounts_payload() {
  KANBOARD_ROWS="$1" python3 -c '
import base64, json, os
rows = []
for line in os.environ["KANBOARD_ROWS"].split("\x1e"):
    if not line:
        continue
    login, mail, password, name, role, action = line.split("\x1f")
    rows.append({"login": login, "mail": mail, "password": password, "name": name, "role": role, "action": action})
print(base64.b64encode(json.dumps({"rows": rows}).encode()).decode())' ;
}

# The rows of the default accounts (set_kanboard_users), with an action.
function kanboard_rows() {
  local action="$1" user user_name user_mail user_password user_fullname user_role rows="" ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password";
    user_fullname="user_${user}_fullname"; user_role="user_${user}_role";
    rows="${rows}${!user_name}"$'\x1f'"${!user_mail}"$'\x1f'"${!user_password}"$'\x1f'"${!user_fullname}"$'\x1f'"${!user_role}"$'\x1f'"${action}"$'\x1e' ;
  done
  printf '%s' "${rows}" ;
}

# Build a Kanboard site from nothing: the project and Kanboard; with --install the workspace account in the place of
# Kanboard's own administrator; with --add-users the default accounts in their roles of the sample project; with
# --sample-content its tasks, a category, a tag, a comment and a subtask.
function kanboard_build() {
  trim_project_name ;
  local release="${KANBOARD_VERSION:-${site_kanboard_release:-${KANBOARD_DEFAULT_RELEASE}}}" ;
  release="${release#v}" ;
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" ;
  local runtime ; runtime="$(cd "${WORKSPACE_ROOT}/${doc_name}" && kanboard_runtime)" ;

  case "${runtime}" in
    ddev|docker|podman|kubernetes) ;;
    *) echo "Kanboard builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed." ; exit 1 ;;
  esac
  if [ "${runtime}" != 'ddev' ] && ! declare -f rt_serve > /dev/null ; then
    echo "--runtime ${runtime} needs a Webship Workspace whose runtimes serve an application of its own (rt_serve, webship/workspace#841): update the workspace, or build on DDEV. Nothing was changed." ;
    exit 1 ;
  fi
  if ! [[ "${release}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ; then
    echo "--release takes a release of Kanboard (1.2.58), not ${release}. Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${ADD_USERS}" == 'yes' ] && [ "${INSTALL}" != 'yes' ] ; then
    echo "--add-users needs --install: the default accounts go into the site --install sets up." ;
    exit 1 ;
  fi
  if [ "${SAMPLE_CONTENT}" == 'yes' ] && [ "${ADD_USERS}" != 'yes' ] ; then
    echo "--sample-content needs --add-users: the sample project's people are the default accounts." ;
    exit 1 ;
  fi
  if [ ${#PROJECT_NAME} -gt 40 ] || ! [[ "${PROJECT_NAME}" =~ ^[a-z0-9][a-z0-9-]*$ ]] ; then
    echo "The project name ${PROJECT_NAME} must be small letters, digits and dashes (its address and its containers take it). Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${INSTALL}" == 'yes' ] && [ ${#account_pass} -lt 6 ] ; then
    echo "The workspace account's password (core/config/settings.yml) has fewer than six characters, which Kanboard asks of a password: --install makes it the site's administrator. Nothing was changed." ;
    exit 1 ;
  fi
  local free ; free="$(kanboard_free_memory)" ;
  if [ -n "${free}" ] && [ "${free}" -lt "${KANBOARD_MEMORY_MB}" ] ; then
    echo "Kanboard needs about ${KANBOARD_MEMORY_MB} MB of free memory (its web server and PHP, and MariaDB); this machine has ${free} MB available now. Stop a site you do not need, then build again. Nothing was changed." ;
    exit 1 ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  # A project of the same name goes first, with its containers and its volumes (Kanboard's database and files).
  drop_database ;
  rm -rf "${PROJECT_NAME:?}" ;
  mkdir -p "${PROJECT_NAME}" ;
  cd "${project_path}" || exit 1 ;

  if [ "${runtime}" = 'ddev' ] ; then
    ddev config --project-type=generic --project-name=${PROJECT_NAME} --database=${KANBOARD_DATABASE} \
      --nodejs-version=$(ddev_nodejs_version) < /dev/null || exit 1 ;
  else
    # The runtime's own project: Docker Compose, Podman or Kubernetes, through the runtime layer.
    ddev config --project-type=generic --webserver-type=generic --project-name=${PROJECT_NAME} --database=${KANBOARD_DATABASE} --auto < /dev/null || exit 1 ;
  fi
  kanboard_write_config "${project_path}" "${release}" "${runtime}" || exit 1 ;
  # The address once the runtime has given the project its port.
  local base_url ; base_url="$(kanboard_url)" ;
  kanboard_write_env "${project_path}" "${release}" "${base_url}" "${runtime}" || exit 1 ;

  if [ "${runtime}" = 'ddev' ] ; then
    echo "Starting the project and Kanboard ${release}: its image is a download of about 35 MB the first time." ;
  else
    echo "Starting the project and Kanboard ${release}: its image is a download of about 35 MB the first time, and the project's web image is built from it." ;
  fi
  ddev_up start -y < /dev/null || exit 1 ;
  kanboard_wait || exit 1 ;

  if [ "${INSTALL}" == 'yes' ] ; then
    echo "Setting Kanboard up: the workspace account in the place of the administrator its schema starts with (admin, password admin)." ;
    kanboard_install_payload "${account_name}" "${account_mail:-${account_name}@example.com}" "${account_pass}" "${account_name^} Workspace" \
      | kanboard_site install || { echo "Kanboard could not be set up." ; exit 1 ; } ;
    if [ "${ADD_USERS}" == 'yes' ] ; then
      set_kanboard_users ;
      add_kanboard_users || exit 1 ;
      if [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
        echo "Adding the sample content: the tasks of ${KANBOARD_PROJECT_NAME}, a category, a tag, a comment and a subtask." ;
        ( cd "${project_path}" && kanboard_site content < /dev/null ) || exit 1 ;
      fi
      users=() ;
    fi
    echo "${doc_name} ${PROJECT_NAME} has been installed: Kanboard $(kanboard_version).";
    echo "The site: ${base_url}" ;
    echo "The workspace account logs in as ${account_name}, the site's administrator; Kanboard has no sign-up: an administrator makes the accounts." ;
  else
    echo "${doc_name} ${PROJECT_NAME} is ready at ${base_url}: Kanboard's own administrator is there (admin, password admin)." ;
    echo "Build it again with --install (and --add-users) for the workspace account in its place and the default accounts.";
  fi

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# Make the default accounts, or give them back their names, passwords and roles: each in its role of the sample
# project, the stranger in none. The list is loaded by the caller (set_kanboard_users): the core's add_users, the
# builder, the tool.
function add_kanboard_users() {
  kanboard_enter_project || return 1 ;
  local user user_name user_mail user_password user_role ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail"; user_password="user_${user}_password"; user_role="user_${user}_role";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo "  User password: ${!user_password}";
    echo "      User role: $([ -n "${!user_role}" ] && echo "${!user_role} of ${KANBOARD_PROJECT_NAME}" || echo "not in ${KANBOARD_PROJECT_NAME}")";
    echo " ================================================================= ";
  done
  kanboard_accounts_payload "$(kanboard_rows '')" | kanboard_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Keep the default accounts from logging in (their work stays), never the workspace account.
function cancel_kanboard_users() {
  kanboard_enter_project || return 1 ;
  local user user_name user_mail ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo " ================================================================= ";
  done
  kanboard_accounts_payload "$(kanboard_rows 'lock')" | kanboard_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Point the dashboard's Kanboard (core/config/plugin.kanboard.settings.yml) at this site, as an account of it: a new
# API access token of that account (made by Kanboard's own code in its container, in the place of its earlier one)
# goes into the settings file, which only you can read, never on a screen or in a log; with it the account's username
# and the site's address, and the sample project as the default one when none was set.
function kanboard_connect() {
  local login="$1" settings="${WORKSPACE_CONFIG}/plugin.kanboard.settings.yml" out token url ;
  if ! [[ "${login}" =~ ^[A-Za-z0-9._@-]+$ ]] ; then echo "--connect takes the username of an account of the site." ; return 1 ; fi
  if [ ! -f "${settings}" ] ; then echo "No ${settings}: install the plugin first (plugins.sh --install kanboard)." ; return 1 ; fi
  out="$(KANBOARD_LOGIN="${login}" python3 -c 'import base64, json, os; print(base64.b64encode(json.dumps({"login": os.environ["KANBOARD_LOGIN"]}).encode()).decode())' | kanboard_site token 2>/dev/null)" ;
  token="$(printf '%s\n' "${out}" | tr -d '\r' | sed -n 's/^TOKEN //p' | tail -n 1)" ;
  out='' ;
  if ! [[ "${token}" =~ ^[a-f0-9]{40,}$ ]] ; then echo "No token could be made for ${login} (is it an active account of the site?)." ; return 1 ; fi
  url="$(kanboard_url)" ;
  KANBOARD_NEW_TOKEN="${token}" python3 - "${settings}" "${url}" "${login}" "${KANBOARD_PROJECT_NAME}" <<'PYEOF' || return 1
import os, re, sys
path, url, login, scope = sys.argv[1:5]
token = os.environ['KANBOARD_NEW_TOKEN']
text = open(path).read()
def put(text, key, value):
    line = '%s: %s' % (key, value)
    if re.search(r'^%s:.*$' % key, text, re.M):
        return re.sub(r'^%s:.*$' % key, lambda m: line, text, count=1, flags=re.M)
    return text.rstrip('\n') + '\n' + line + '\n'
text = put(text, 'url', url)
text = put(text, 'username', login)
text = put(text, 'token', token)
if not re.search(r'^default_scope:[ \t]*[^ \t\n"]', text, re.M) and not re.search(r'^default_scope:[ \t]*"[^"]', text, re.M):
    text = put(text, 'default_scope', '"%s"' % scope)
fd = os.open(path + '.new', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
os.replace(path + '.new', path)
PYEOF
  token='' ;
  echo "The dashboard reads the tasks of ${url} as ${login} now: a new API access token of that account is in ${settings} (not shown here, its earlier one replaced), and ${KANBOARD_PROJECT_NAME} is the default project when none was set." ;
}

# What cmd-tools-kanboard-cli.sh does: the first of --run, --add-users, --cancel-users, --sample-content, --tidy,
# --connect that was asked for; with none of them, what the site is and its accounts.
function kanboard_cli_tool() {
  trim_project_name ;
  kanboard_enter_project || exit 1 ;

  [ "$(kanboard_probe)" = '200' ] || ddev start -y < /dev/null || exit 1 ;
  kanboard_wait > /dev/null || { echo "Kanboard of ${PROJECT_NAME} does not answer; start it again (ddev restart in ${doc_name}/${PROJECT_NAME})." ; exit 1 ; } ;

  if [ ! "${RUN}" == '_none_' ] ; then
    # Kanboard's own console (./cli <command>), as the user who owns its files: on DDEV the web server's, in Kanboard's
    # container; on another runtime the host user, in the web container.
    local words ; read -r -a words <<< "${RUN}" ;
    if [ "$(kanboard_runtime)" = 'ddev' ] ; then
      ddev exec -s kanboard "su -s /bin/sh nginx -c $(printf '%q' "cd /var/www/app && ./cli $(printf '%q ' "${words[@]}")")" < /dev/null ;
    else
      kanboard_exec "./cli $(printf '%q ' "${words[@]}")" < /dev/null ;
    fi
    exit $? ;
  fi

  set_kanboard_users ;
  if [ "${ADD_USERS}" == 'yes' ] ; then
    add_kanboard_users ;
  elif [ "${CANCEL_USERS}" == 'yes' ] ; then
    cancel_kanboard_users ;
  elif [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
    kanboard_site content list < /dev/null ;
  elif [ "${TIDY}" == 'yes' ] ; then
    # What a test run that was stopped half way left: its tasks ("Webship test …"), with what Kanboard keeps of them.
    kanboard_site tidy list < /dev/null ;
  elif [ "${CONNECT}" != '_none_' ] ; then
    kanboard_connect "${CONNECT}" ;
  else
    echo "${doc_name}/${PROJECT_NAME}: Kanboard $(kanboard_version)" ;
    echo "  the site:  $(kanboard_url)" ;
    echo "" ;
    kanboard_site list < /dev/null ;
  fi
  cd ${WORKSPACE_ROOT}/${doc_name};
}

# The step pack in the testing stack of a Kanboard site. The core's testing_configure calls this in the project
# folder once webship-js is scaffolded and before the dependencies are installed; for a project that is not one of
# this plugin's it changes nothing.
#
# It adds the pack to package.json, lists its step definitions in cucumber.js after webship-js's own, gives cucumber.js
# the tags that keep the pack's assertions that must fail out of a normal run, the account that prepares and removes
# test content (manager), the project the steps work in when they name none, and the users registry of the default
# accounts (a handle a scenario reads, mapped to an account; never the workspace account), and writes a first feature
# when the project has none of its own. Every part is skipped when it is already there, so a second run adds what the
# first missed and never resets a suite.
function testing_configure_kanboard() {
  local project_path="$1";
  kanboard_is_project "${project_path}" || return 0 ;
  if [ ! -f "${project_path}/cucumber.js" ] || [ ! -f "${project_path}/package.json" ] ; then
    echo "  Kanboard: cucumber.js is not here yet — run the testing setup again once webship-js is scaffolded." ;
    return 1 ;
  fi

  echo "Adding the Kanboard step pack (${KANBOARD_STEPS_PACKAGE} ${KANBOARD_STEPS_VERSION}).";
  set_kanboard_users ;
  # Kanboard logs in with the username, and shows the person's name.
  local registry="" user user_name user_password user_fullname ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_password="user_${user}_password"; user_fullname="user_${user}_fullname";
    registry="${registry}${user}|${!user_name}|${!user_password}|${!user_fullname}"$'\n' ;
  done

  local address ;
  address="$(cd "${project_path}" && kanboard_url "$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' .ddev/config.yaml 2>/dev/null | head -n 1)")" ;

  python3 - "${project_path}" "${KANBOARD_STEPS_PACKAGE}" "${KANBOARD_STEPS_VERSION}" 'KANBOARD' "${registry}" "${address}" "${KANBOARD_PROJECT_NAME}" <<'PYEOF' || return 1
import json, re, sys

project, pack, version, prefix, registry, address, sample = sys.argv[1:8]

# package.json: the pack as a dev dependency, at the release line this plugin was proven on.
pkg_file = project + '/package.json'
pkg = json.load(open(pkg_file))
if pack not in pkg.get('dependencies', {}) and pack not in pkg.get('devDependencies', {}):
    pkg.setdefault('devDependencies', {})[pack] = version
    open(pkg_file, 'w').write(json.dumps(pkg, indent=4) + '\n')
    print('  package.json: %s %s' % (pack, version))

cucumber_file = project + '/cucumber.js'
src = open(cucumber_file).read()
before = src

if ('node_modules/%s/' % pack) not in src:
    line = "'node_modules/%s/tests/step-definitions/**/*.js'," % pack
    core = re.search(r"^([ \t]*)'node_modules/webship-js/tests/step-definitions/[^']*',.*$", src, re.M)
    opening = re.search(r"^([ \t]*)require:[ \t]*\[[ \t]*$", src, re.M)
    if core:
        src = src[:core.end()] + '\n' + core.group(1) + line + src[core.end():]
    elif opening:
        src = src[:opening.end()] + '\n' + opening.group(1) + '  ' + line + src[opening.end():]
    else:
        sys.exit("  cucumber.js has no require list this can add to. Add this line to it:\n    " + line)
    print('  cucumber.js: the step definitions of %s' % pack)

if not re.search(r"^[ \t]*tags:", src, re.M):
    default = re.search(r"^([ \t]*)default:[ \t]*\{[ \t]*$", src, re.M)
    if default:
        pad = default.group(1) + '  '
        block = [
            pad + "// The pack's assertions that must fail are no part of a normal run.",
            pad + "tags: process.env.CUCUMBER_TAGS || 'not @wip and not @must-fail',",
        ]
        src = src[:default.end()] + '\n' + '\n'.join(block) + src[default.end():]
        print('  cucumber.js: the tags that keep the assertions that must fail out of a normal run')

world = re.search(r"^([ \t]*)worldParameters:[ \t]*\{[ \t]*$", src, re.M)
if not world:
    sys.exit("  cucumber.js has no worldParameters block to add the users registry to.")
pad = world.group(1) + '  '
additions = []
if not re.search(r"^[ \t]*manager:", src, re.M):
    additions += [
        pad + "// The account that prepares and removes test content through the site's API: the manager of the project.",
        pad + "manager: process.env.MANAGER || 'owner',",
    ]
if not re.search(r"^[ \t]*project:", src, re.M):
    additions += [
        pad + "// The project the steps work in when they name none (its name).",
        pad + "project: process.env.PROJECT || '%s'," % sample,
    ]
if not re.search(r"^[ \t]*users:[ \t]*\{", src, re.M):
    rows = [r.split('|') for r in registry.splitlines() if r.strip()]
    additions += [
        pad + "// The users registry: a handle a scenario reads, mapped to an account of the site (the default accounts:",
        pad + "// cmd-tools-kanboard-cli.sh --add-users). Override one with %s_<HANDLE>_USER and %s_<HANDLE>_PASSWORD." % (prefix, prefix),
        pad + "users: {",
    ]
    for handle, login, password, display in rows:
        env = '%s_%s' % (prefix, handle.upper())
        additions.append(pad + "  %s: { username: process.env.%s_USER || '%s', password: process.env.%s_PASSWORD || '%s', name: '%s' }," % (handle, env, login, env, password, display))
    additions.append(pad + "},")
    print('  cucumber.js: the users registry (%s)' % ', '.join(r[0] for r in rows))
if additions:
    src = src[:world.end()] + '\n' + '\n'.join(additions) + src[world.end():]
    print('  cucumber.js: the managing account and the project of the steps')

# The address the suite opens when LAUNCH_URL is not set: the placeholder of the scaffold becomes the site's.
placeholder = "process.env.LAUNCH_URL || 'http://localhost:8080'"
if placeholder in src:
    src = src.replace(placeholder, "process.env.LAUNCH_URL || '%s'" % address)
    print('  cucumber.js: the address of the site (%s)' % address)

if src != before:
    open(cucumber_file, 'w').write(src)
PYEOF

  # A first feature, when the project has none for the site yet.
  local feature="${WORKSPACE_SCRIPTS}/plugins/kanboard/site.feature" ;
  if [ -f "${feature}" ] && [ ! -f "${project_path}/tests/features/site.feature" ] ; then
    mkdir -p "${project_path}/tests/features" && cp "${feature}" "${project_path}/tests/features/site.feature" \
      && echo "  tests/features/site.feature: a first feature for the board and its tasks" ;
  fi

  # The scenarios log in as the default accounts and read the sample project: make sure the site has them, once it
  # answers again (installing the testing stack may restart the project, and Kanboard with it). Each part says when it
  # did not work, and each runs in the project (add_kanboard_users ends in the folder).
  if ! ( cd "${project_path}" && kanboard_wait > /dev/null 2>&1 ) ; then
    echo "  Kanboard does not answer: is the site running (ddev start in ${project_path})? The default accounts and the sample content were not checked." ;
  elif ! ( cd "${project_path}" && add_kanboard_users > /dev/null 2>&1 ) ; then
    echo "  The default accounts could not be written (bash cmd-tools-kanboard-cli.sh <site> --add-users says why)." ;
  elif ! ( cd "${project_path}" && kanboard_site content < /dev/null > /dev/null 2>&1 ) ; then
    echo "  The sample content could not be written (bash cmd-tools-kanboard-cli.sh <site> --sample-content says why)." ;
  else
    echo "  the default accounts and the sample content are on the site (${users[*]})" ;
  fi
}
