/**
 * PocketBase Collections Schema
 * 
 * This defines the schema for PocketBase collections that correspond to the SQLite tables.
 * 
 * To use this, you need to:
 * 1. Start PocketBase with Docker
 * 2. Import this schema via PocketBase UI or API
 * 3. Or use the PocketBase Admin UI to create these collections manually
 */

// Collection: repos
// Corresponds to SQLite table: repos
export const REPOS_COLLECTION = {
  name: 'repos',
  schema: [
    { name: 'repo_url', type: 'text', required: false },
    { name: 'local_path', type: 'text', required: true },
    { name: 'source_path', type: 'text', required: false },
    { name: 'branch', type: 'text', required: false },
    { name: 'default_branch', type: 'text', required: false },
    { name: 'clone_status', type: 'text', required: true },
    { name: 'cloned_at', type: 'number', required: true },
    { name: 'last_pulled', type: 'number', required: false },
    { name: 'last_accessed_at', type: 'number', required: false },
    { name: 'opencode_config_name', type: 'text', required: false },
    { name: 'is_worktree', type: 'bool', required: false, default: false },
    { name: 'is_local', type: 'bool', required: false, default: false },
  ],
  indexes: [
    { field: 'local_path', unique: true },
    { field: 'source_path', unique: false },
    { field: 'repo_url', unique: false },
    { field: 'clone_status' },
  ]
}

// Collection: user_preferences
// Corresponds to SQLite table: user_preferences
export const USER_PREFERENCES_COLLECTION = {
  name: 'user_preferences',
  schema: [
    { name: 'user_id', type: 'text', required: true, default: 'default' },
    { name: 'preferences', type: 'json', required: true, default: '{}' },
    { name: 'updated_at', type: 'number', required: true },
  ],
  indexes: [
    { field: 'user_id', unique: true },
  ]
}

// Collection: opencode_configs
// Corresponds to SQLite table: opencode_configs
export const OPENCODE_CONFIGS_COLLECTION = {
  name: 'opencode_configs',
  schema: [
    { name: 'user_id', type: 'text', required: true, default: 'default' },
    { name: 'config_name', type: 'text', required: true },
    { name: 'config_content', type: 'json', required: true },
    { name: 'is_default', type: 'bool', required: false, default: false },
    { name: 'created_at', type: 'number', required: true },
    { name: 'updated_at', type: 'number', required: true },
  ],
  indexes: [
    { field: 'user_id' },
    { field: 'config_name' },
    { field: 'is_default' },
  ]
}

// Collection: user (from better-auth)
// This is managed by better-auth, but we need it for references
export const USER_COLLECTION = {
  name: 'user',
  schema: [
    { name: 'id', type: 'text', required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'text', required: true },
    { name: 'emailVerified', type: 'bool', required: false, default: false },
    { name: 'image', type: 'text', required: false },
    { name: 'createdAt', type: 'number', required: true },
    { name: 'updatedAt', type: 'number', required: true },
    { name: 'role', type: 'text', required: false, default: 'user' },
  ]
}

// Collection: session (from better-auth)
export const SESSION_COLLECTION = {
  name: 'session',
  schema: [
    { name: 'id', type: 'text', required: true },
    { name: 'expiresAt', type: 'number', required: true },
    { name: 'token', type: 'text', required: true },
    { name: 'createdAt', type: 'number', required: true },
    { name: 'updatedAt', type: 'number', required: true },
    { name: 'ipAddress', type: 'text', required: false },
    { name: 'userAgent', type: 'text', required: false },
    { name: 'userId', type: 'relation', required: true, options: { collection: 'user' } },
  ]
}

// Collection: account (from better-auth)
export const ACCOUNT_COLLECTION = {
  name: 'account',
  schema: [
    { name: 'id', type: 'text', required: true },
    { name: 'accountId', type: 'text', required: true },
    { name: 'providerId', type: 'text', required: true },
    { name: 'userId', type: 'relation', required: true, options: { collection: 'user' } },
    { name: 'accessToken', type: 'text', required: false },
    { name: 'refreshToken', type: 'text', required: false },
    { name: 'idToken', type: 'text', required: false },
    { name: 'accessTokenExpiresAt', type: 'number', required: false },
    { name: 'refreshTokenExpiresAt', type: 'number', required: false },
    { name: 'scope', type: 'text', required: false },
    { name: 'password', type: 'text', required: false },
    { name: 'createdAt', type: 'number', required: true },
    { name: 'updatedAt', type: 'number', required: true },
  ]
}

// Collection: verification (from better-auth)
export const VERIFICATION_COLLECTION = {
  name: 'verification',
  schema: [
    { name: 'id', type: 'text', required: true },
    { name: 'identifier', type: 'text', required: true },
    { name: 'value', type: 'text', required: true },
    { name: 'expiresAt', type: 'number', required: true },
    { name: 'createdAt', type: 'number', required: false },
    { name: 'updatedAt', type: 'number', required: false },
  ]
}

// Collection: passkey (from better-auth)
export const PASSKEY_COLLECTION = {
  name: 'passkey',
  schema: [
    { name: 'id', type: 'text', required: true },
    { name: 'name', type: 'text', required: false },
    { name: 'publicKey', type: 'text', required: true },
    { name: 'userId', type: 'relation', required: true, options: { collection: 'user' } },
    { name: 'credentialID', type: 'text', required: true },
    { name: 'counter', type: 'number', required: true },
    { name: 'deviceType', type: 'text', required: true },
    { name: 'backedUp', type: 'bool', required: false, default: false },
    { name: 'transports', type: 'text', required: false },
    { name: 'createdAt', type: 'number', required: false },
    { name: 'aaguid', type: 'text', required: false },
  ]
}

// Collection: trusted_ssh_hosts
export const TRUSTED_SSH_HOSTS_COLLECTION = {
  name: 'trusted_ssh_hosts',
  schema: [
    { name: 'host', type: 'text', required: true },
    { name: 'key_type', type: 'text', required: true },
    { name: 'public_key', type: 'text', required: true },
    { name: 'created_at', type: 'number', required: true },
    { name: 'updated_at', type: 'number', required: true },
  ],
  indexes: [
    { field: 'host', unique: true },
  ]
}

// Collection: repo_settings
export const REPO_SETTINGS_COLLECTION = {
  name: 'repo_settings',
  schema: [
    { name: 'repo_id', type: 'relation', required: true, options: { collection: 'repos' } },
    { name: 'key', type: 'text', required: true },
    { name: 'value', type: 'json', required: true },
    { name: 'updated_at', type: 'number', required: true },
  ],
  indexes: [
    { field: 'repo_id' },
    { fields: ['repo_id', 'key'], unique: true },
  ]
}

// Collection: opencode_model_state
export const OPENCODE_MODEL_STATE_COLLECTION = {
  name: 'opencode_model_state',
  schema: [
    { name: 'user_id', type: 'text', required: true, default: 'default' },
    { name: 'recent', type: 'json', required: false, default: '[]' },
    { name: 'favorite', type: 'json', required: false, default: '[]' },
    { name: 'variant', type: 'json', required: false, default: '{}' },
    { name: 'updated_at', type: 'number', required: true },
  ],
  indexes: [
    { field: 'user_id', unique: true },
  ]
}

// Collection: app_secrets
export const APP_SECRETS_COLLECTION = {
  name: 'app_secrets',
  schema: [
    { name: 'key', type: 'text', required: true },
    { name: 'value', type: 'text', required: true },
    { name: 'created_at', type: 'number', required: true },
    { name: 'updated_at', type: 'number', required: true },
  ],
  indexes: [
    { field: 'key', unique: true },
  ]
}

// Collection: schema_migrations
export const SCHEMA_MIGRATIONS_COLLECTION = {
  name: 'schema_migrations',
  schema: [
    { name: 'version', type: 'number', required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'applied_at', type: 'number', required: true },
  ],
  indexes: [
    { field: 'version', unique: true },
  ]
}

// Collection: automation_jobs
export const AUTOMATION_JOBS_COLLECTION = {
  name: 'automation_jobs',
  schema: [
    { name: 'repo_id', type: 'relation', required: true, options: { collection: 'repos' } },
    { name: 'name', type: 'text', required: true },
    { name: 'description', type: 'text', required: false },
    { name: 'enabled', type: 'bool', required: true, default: true },
    { name: 'automation_mode', type: 'text', required: false, default: 'interval' },
    { name: 'interval_minutes', type: 'number', required: false },
    { name: 'cron_expression', type: 'text', required: false },
    { name: 'timezone', type: 'text', required: false },
    { name: 'agent_slug', type: 'text', required: false },
    { name: 'prompt', type: 'text', required: true },
    { name: 'model', type: 'text', required: false },
    { name: 'skill_metadata', type: 'json', required: false },
    { name: 'created_at', type: 'number', required: true },
    { name: 'updated_at', type: 'number', required: true },
    { name: 'last_run_at', type: 'number', required: false },
    { name: 'next_run_at', type: 'number', required: false },
  ],
  indexes: [
    { field: 'repo_id' },
    { field: 'enabled' },
    { field: 'next_run_at' },
  ]
}

// Collection: automation_runs
export const AUTOMATION_RUNS_COLLECTION = {
  name: 'automation_runs',
  schema: [
    { name: 'job_id', type: 'relation', required: true, options: { collection: 'automation_jobs' } },
    { name: 'repo_id', type: 'relation', required: true, options: { collection: 'repos' } },
    { name: 'trigger_source', type: 'text', required: true },
    { name: 'status', type: 'text', required: true },
    { name: 'started_at', type: 'number', required: true },
    { name: 'finished_at', type: 'number', required: false },
    { name: 'created_at', type: 'number', required: true },
    { name: 'session_id', type: 'text', required: false },
    { name: 'session_title', type: 'text', required: false },
    { name: 'log_text', type: 'text', required: false, options: { maxLength: 100000 } },
    { name: 'response_text', type: 'text', required: false, options: { maxLength: 100000 } },
    { name: 'error_text', type: 'text', required: false, options: { maxLength: 10000 } },
  ],
  indexes: [
    { field: 'job_id' },
    { field: 'repo_id' },
    { field: 'status' },
    { field: 'started_at' },
    { field: 'finished_at' },
  ]
}

// Collection: prompt_templates
export const PROMPT_TEMPLATES_COLLECTION = {
  name: 'prompt_templates',
  schema: [
    { name: 'title', type: 'text', required: true },
    { name: 'category', type: 'text', required: true },
    { name: 'cadence_hint', type: 'text', required: true },
    { name: 'suggested_name', type: 'text', required: true },
    { name: 'suggested_description', type: 'text', required: true },
    { name: 'description', type: 'text', required: true },
    { name: 'prompt', type: 'text', required: true, options: { maxLength: 50000 } },
    { name: 'created_at', type: 'number', required: true },
    { name: 'updated_at', type: 'number', required: true },
  ]
}

// All collections for easy import
export const ALL_COLLECTIONS = [
  REPOS_COLLECTION,
  USER_PREFERENCES_COLLECTION,
  OPENCODE_CONFIGS_COLLECTION,
  USER_COLLECTION,
  SESSION_COLLECTION,
  ACCOUNT_COLLECTION,
  VERIFICATION_COLLECTION,
  PASSKEY_COLLECTION,
  TRUSTED_SSH_HOSTS_COLLECTION,
  REPO_SETTINGS_COLLECTION,
  OPENCODE_MODEL_STATE_COLLECTION,
  APP_SECRETS_COLLECTION,
  SCHEMA_MIGRATIONS_COLLECTION,
  AUTOMATION_JOBS_COLLECTION,
  AUTOMATION_RUNS_COLLECTION,
  PROMPT_TEMPLATES_COLLECTION,
]
