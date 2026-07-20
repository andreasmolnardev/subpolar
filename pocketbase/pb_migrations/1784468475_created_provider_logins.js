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
        "id": "text173254826",
        "max": 0,
        "min": 0,
        "name": "provider_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "json92216651",
        "maxSize": 0,
        "name": "credential",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "hidden": false,
        "id": "number2341372968",
        "max": null,
        "min": null,
        "name": "created_at",
        "onlyInt": false,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "number1130519967",
        "max": null,
        "min": null,
        "name": "updated_at",
        "onlyInt": false,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      }
    ],
    "id": "pbc_1064229286",
    "indexes": [
      "CREATE UNIQUE INDEX idx_provider_logins_provider ON provider_logins (provider_id)"
    ],
    "listRule": null,
    "name": "provider_logins",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1064229286");

  return app.delete(collection);
})
