/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("agents");

  collection.fields.add(new Field({
    "hidden": false,
    "id": "json1784402817",
    "maxSize": 0,
    "name": "skill_access",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }));

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("agents");

  collection.fields.removeById("json1784402817");

  return app.save(collection);
})
