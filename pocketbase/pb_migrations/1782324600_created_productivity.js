/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const todoLists = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "text3208210256", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1000000001", "max": 0, "min": 0, "name": "user_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1000000002", "max": 0, "min": 0, "name": "name", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "number1000000001", "max": null, "min": null, "name": "created_at", "onlyInt": false, "presentable": false, "required": true, "system": false, "type": "number" },
      { "hidden": false, "id": "number1000000002", "max": null, "min": null, "name": "updated_at", "onlyInt": false, "presentable": false, "required": true, "system": false, "type": "number" }
    ],
    "id": "pbc_2324600001",
    "indexes": ["CREATE INDEX idx_todo_lists_user_updated ON todo_lists (user_id, updated_at)"],
    "listRule": null,
    "name": "todo_lists",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  const todoItems = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "text3208210256", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1000000003", "max": 0, "min": 0, "name": "user_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1000000004", "max": 0, "min": 0, "name": "list_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1000000005", "max": 0, "min": 0, "name": "text", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "bool1000000001", "name": "completed", "presentable": false, "required": false, "system": false, "type": "bool" },
      { "hidden": false, "id": "number1000000003", "max": null, "min": null, "name": "created_at", "onlyInt": false, "presentable": false, "required": true, "system": false, "type": "number" },
      { "hidden": false, "id": "number1000000004", "max": null, "min": null, "name": "updated_at", "onlyInt": false, "presentable": false, "required": true, "system": false, "type": "number" }
    ],
    "id": "pbc_2324600002",
    "indexes": ["CREATE INDEX idx_todo_items_list_updated ON todo_items (list_id, updated_at)", "CREATE INDEX idx_todo_items_user_completed ON todo_items (user_id, completed)"],
    "listRule": null,
    "name": "todo_items",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  const notes = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      { "autogeneratePattern": "[a-z0-9]{15}", "hidden": false, "id": "text3208210256", "max": 15, "min": 15, "name": "id", "pattern": "^[a-z0-9]+$", "presentable": false, "primaryKey": true, "required": true, "system": true, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1000000006", "max": 0, "min": 0, "name": "user_id", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1000000007", "max": 0, "min": 0, "name": "title", "pattern": "", "presentable": false, "primaryKey": false, "required": true, "system": false, "type": "text" },
      { "hidden": false, "id": "json1000000001", "maxSize": 0, "name": "tags", "presentable": false, "required": false, "system": false, "type": "json" },
      { "autogeneratePattern": "", "hidden": false, "id": "text1000000008", "max": 0, "min": 0, "name": "text", "pattern": "", "presentable": false, "primaryKey": false, "required": false, "system": false, "type": "text" },
      { "hidden": false, "id": "number1000000005", "max": null, "min": null, "name": "created_at", "onlyInt": false, "presentable": false, "required": true, "system": false, "type": "number" },
      { "hidden": false, "id": "number1000000006", "max": null, "min": null, "name": "updated_at", "onlyInt": false, "presentable": false, "required": true, "system": false, "type": "number" }
    ],
    "id": "pbc_2324600003",
    "indexes": ["CREATE INDEX idx_notes_user_updated ON notes (user_id, updated_at)"],
    "listRule": null,
    "name": "notes",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  app.save(todoLists);
  app.save(todoItems);
  return app.save(notes);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("pbc_2324600003"));
  app.delete(app.findCollectionByNameOrId("pbc_2324600002"));
  return app.delete(app.findCollectionByNameOrId("pbc_2324600001"));
})
