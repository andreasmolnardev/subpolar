/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text3519405507",
        "max": 0,
        "min": 0,
        "name": "automation_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text376250268",
        "max": 0,
        "min": 0,
        "name": "project_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text1608375510",
        "max": 0,
        "min": 0,
        "name": "trigger_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "select3182748164",
        "maxSelect": 1,
        "name": "trigger_type",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": [
          "manual",
          "schedule",
          "cron",
          "webhook"
        ]
      },
      {
        "hidden": false,
        "id": "json1181510956",
        "maxSize": 0,
        "name": "trigger_payload",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "hidden": false,
        "id": "select2063623452",
        "maxSelect": 1,
        "name": "status",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "select",
        "values": [
          "running",
          "waiting_for_input",
          "completed",
          "failed",
          "cancelled",
          "skipped"
        ]
      },
      {
        "hidden": false,
        "id": "number222754019",
        "max": null,
        "min": null,
        "name": "started_at",
        "onlyInt": false,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "number902724141",
        "max": null,
        "min": null,
        "name": "finished_at",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text1631579359",
        "max": 0,
        "min": 0,
        "name": "session_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text2536156509",
        "max": 0,
        "min": 0,
        "name": "response_text",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "hidden": false,
        "id": "text2147248891",
        "max": 0,
        "min": 0,
        "name": "error_text",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      }
    ],
    "id": "pbc_3501037547",
    "indexes": [
      "CREATE INDEX idx_automation_definition_runs_automation_started ON automation_definition_runs (automation_id, started_at)",
      "CREATE INDEX idx_automation_definition_runs_project_started ON automation_definition_runs (project_id, started_at)"
    ],
    "listRule": null,
    "name": "automation_definition_runs",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3501037547");

  return app.delete(collection);
})
