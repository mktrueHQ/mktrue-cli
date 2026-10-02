// A developer's .env must not change what the suite proves: every variable a subject reads is
// blanked before config loads, and loadEnvFile never overrides a variable that is already set.
process.env.MONGO_URI = "";
process.env.MONGO_DB_NAME = "";
process.env.CLERK_SECRET_KEY = "";
process.env.CLERK_ISSUER = "";
process.env.OWNER_USER_ID = "";
process.env.ALLOWED_USER_IDS = "";
process.env.GIT_SHA = "";
process.env.DEFAULT_TIMEZONE = "";
process.env.DEV_AUTH_USER_ID = "";
