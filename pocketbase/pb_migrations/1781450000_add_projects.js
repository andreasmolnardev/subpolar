/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = {
    name: "projects",
    type: "base",
    system: false,
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE INDEX idx_projects_user_id ON projects(user_id)",
      "CREATE UNIQUE INDEX idx_projects_user_name ON projects(user_id, name)",
    ],
    fields: [
      { name: "user_id", type: "text", required: true, max: 128 },
      { name: "name", type: "text", required: true, max: 256 },
      { name: "directory", type: "text", required: false, max: 1024 },
      { name: "is_temporary", type: "bool", required: false },
      { name: "created_at", type: "number", required: true },
      { name: "updated_at", type: "number", required: true },
    ],
  };

  return app.importCollections([collection], false);
}, (app) => {
  return null;
});
