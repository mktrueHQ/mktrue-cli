/**
 * Creates or repairs the instance's users. Idempotent — safe to run on every deploy.
 *
 * **The two states this has to survive, and why the code looks like it does.**
 *
 * On a virgin instance no users exist, and MongoDB's *localhost exception* is the only way in. That
 * exception is far narrower than it first appears: it permits **creating the first user on admin
 * and nothing else** — not `usersInfo`, so `getUser()` fails `Unauthorized` rather than returning
 * null — and it closes the instant that first user exists. So a script that probes before creating,
 * or that creates all four users in one unauthenticated pass, fails on a fresh instance. Both were
 * tried; both failed exactly there.
 *
 * The shape below is what works: authenticate if possible, otherwise create the admin under the
 * exception and immediately authenticate as it, then do everything else as a normal privileged
 * client.
 *
 * **No password is ever printed, returned, or written to a log.** This script's output goes to
 * Dokploy's deploy log. Keep that true if you add a user.
 *
 * Least privilege is the whole point of this file:
 *   - each application user can read and write **its own database and no other**
 *   - the backup user can read everything and write nothing
 *   - only the admin can manage users, and no application ever authenticates as it
 */

function need(name) {
  const value = (process.env[name] || "").trim();
  if (value === "") throw new Error(`refusing to bootstrap: ${name} is blank`);
  return value;
}

const ADMIN_USER = process.env.MONGO_ADMIN_USER || "infra_admin";
const ADMIN_PASSWORD = need("MONGO_ADMIN_PASSWORD");
const BACKUP_USER = process.env.BACKUP_DB_USER || "backup_agent";

/**
 * Every product this instance serves, read from one list.
 *
 * The script knows no product names. Adding a consumer is a change to
 * INFRA_CONSUMERS and three environment variables, not an edit here — which is
 * what keeps this file the same in every repository that uses this template.
 */
const CONSUMERS = need("INFRA_CONSUMERS")
  .split(/\s+/)
  .filter(Boolean)
  .map((slug) => {
    const key = slug.toUpperCase().replace(/-/g, "_");
    return {
      slug,
      db: process.env[`${key}_DB_NAME`] || slug,
      user: process.env[`${key}_DB_USER`] || `${slug}_app`,
      passwordVar: `${key}_DB_PASSWORD`,
    };
  });
const ROTATE = (process.env.ROTATE_PASSWORDS || "") === "true";

const admin = db.getSiblingDB("admin");

function tryAuth() {
  try {
    // **mongosh returns `{ ok: 1 }` where the legacy shell returned `1`.** Comparing against `1`
    // alone silently treats every successful authentication as a failure — which sends this script
    // down the virgin-instance path on an instance that already has users, where it then fails on
    // a duplicate admin. Both shapes are accepted so the script does not depend on which shell it
    // is run under.
    const result = admin.auth(ADMIN_USER, ADMIN_PASSWORD);
    return result === 1 || (result !== null && typeof result === "object" && result.ok === 1);
  } catch (e) {
    return false;
  }
}

if (tryAuth()) {
  print(`authenticated as ${ADMIN_USER}`);
  admin.updateUser(ADMIN_USER, { roles: [{ role: "root", db: "admin" }] });
  if (ROTATE) {
    admin.changeUserPassword(ADMIN_USER, ADMIN_PASSWORD);
    print(`password rotated: ${ADMIN_USER}`);
  }
} else {
  // Virgin instance. This is the one operation the localhost exception allows, and it is only
  // reachable over the container's own loopback — which is why bootstrap-users.sh runs through
  // `docker exec` rather than over the network.
  print(`no users yet — creating ${ADMIN_USER} under the localhost exception`);
  admin.createUser({
    user: ADMIN_USER,
    pwd: ADMIN_PASSWORD,
    roles: [{ role: "root", db: "admin" }],
  });
  // The exception closed the moment that succeeded. Everything below needs a real session.
  if (!tryAuth()) throw new Error("created the admin user but could not authenticate as it");
  print(`created user: ${ADMIN_USER}`);
}

/**
 * Create the user, or bring an existing one back to the roles declared here.
 *
 * Roles are reasserted on every run deliberately: a grant made by hand during an incident is
 * exactly the kind of thing that outlives the incident, and this is where it gets taken back.
 *
 * The password is only written on creation, or when ROTATE_PASSWORDS is set — rewriting it every
 * deploy would mean a deploy with a stale env silently locks an app out of its own database.
 */
function upsertUser(name, password, roles) {
  if (admin.getUser(name) === null) {
    admin.createUser({ user: name, pwd: password, roles: roles });
    print(`created user: ${name}`);
    return;
  }

  admin.updateUser(name, { roles: roles });
  print(`user exists, roles reasserted: ${name}`);

  if (ROTATE) {
    admin.changeUserPassword(name, password);
    print(`password rotated: ${name}`);
  }
}

// Each consumer reads and writes its OWN database and nothing else. Never
// `readWriteAnyDatabase` — the whole reason several products may share one
// instance is that a compromise of the most exposed one cannot reach the data of
// the most private one, and that guarantee lives in this single line.
for (const consumer of CONSUMERS) {
  upsertUser(consumer.user, need(consumer.passwordVar), [{ role: "readWrite", db: consumer.db }]);
}

// Backups: read everything, write nothing. `backup` is the built-in role mongodump wants and it
// carries no write privilege on any application database, so a compromised backup agent can copy
// data but never corrupt it.
upsertUser(BACKUP_USER, need("BACKUP_DB_PASSWORD"), [{ role: "backup", db: "admin" }]);

print("bootstrap complete");
