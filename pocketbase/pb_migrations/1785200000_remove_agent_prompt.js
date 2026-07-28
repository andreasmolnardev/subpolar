/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("agents")
  const records = app.findRecordsByFilter(collection, "prompt != ''", "", 0, 0)

  for (const record of records) {
    if (!record.getString("systemPrompt")) {
      record.set("systemPrompt", record.getString("prompt"))
      app.save(record)
    }
  }

  const promptField = collection.fields.getByName("prompt")

  if (promptField) collection.fields.removeById(promptField.id)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("agents")

  collection.fields.addAt(3, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1659857976",
    "max": 0,
    "min": 0,
    "name": "prompt",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": true,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
