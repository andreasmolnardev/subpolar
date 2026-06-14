/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_544682841")

  // remove field
  collection.fields.removeById("json1835227006")

  // remove field
  collection.fields.removeById("json1757777625")

  // remove field
  collection.fields.removeById("json4047749037")

  // add field
  collection.fields.addAt(2, new Field({
    "hidden": false,
    "id": "json3014255481",
    "maxSize": 0,
    "name": "recent",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "json3931651555",
    "maxSize": 0,
    "name": "favorite",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "json369120316",
    "maxSize": 0,
    "name": "variant",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_544682841")

  // add field
  collection.fields.addAt(2, new Field({
    "hidden": false,
    "id": "json1835227006",
    "maxSize": 0,
    "name": "recent",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "json1757777625",
    "maxSize": 0,
    "name": "favorite",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "json4047749037",
    "maxSize": 0,
    "name": "variant",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "json"
  }))

  // remove field
  collection.fields.removeById("json3014255481")

  // remove field
  collection.fields.removeById("json3931651555")

  // remove field
  collection.fields.removeById("json369120316")

  return app.save(collection)
})
