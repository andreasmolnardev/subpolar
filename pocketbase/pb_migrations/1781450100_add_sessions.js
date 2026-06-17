/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = {
    name: "sessions",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE UNIQUE INDEX idx_sessions_session_id ON sessions(session_id)",
      "CREATE INDEX idx_sessions_project_id ON sessions(project_id)",
      "CREATE INDEX idx_sessions_directory ON sessions(directory)",
      "CREATE INDEX idx_sessions_updated_at ON sessions(updated_at)",
    ],
    fields: [
      { name: "session_id", type: "text", required: true, max: 256 },
      { name: "project_id", type: "text", required: false, max: 128 },
      { name: "directory", type: "text", required: false, max: 1024 },
      { name: "title", type: "text", required: false, max: 512 },
      { name: "created_at", type: "number", required: true },
      { name: "updated_at", type: "number", required: true },
    ],
  };

  return app.importCollections([collection], false);
}, () => null);
