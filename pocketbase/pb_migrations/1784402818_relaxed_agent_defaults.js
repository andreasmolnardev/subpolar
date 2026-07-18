/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("agents");
  collection.fields.getByName("description").required = false;
  collection.fields.getByName("sort_order").required = false;
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("agents");
  collection.fields.getByName("description").required = true;
  collection.fields.getByName("sort_order").required = true;
  return app.save(collection);
});
