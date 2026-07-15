migrate((app) => {
  const collection = new Collection({
    name: 'openapi_secrets',
    type: 'base',
    fields: [
      { name: 'server_id', type: 'text', required: true },
      { name: 'ciphertext', type: 'text', required: true },
      { name: 'created_at', type: 'number', required: true },
      { name: 'updated_at', type: 'number', required: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_openapi_secrets_server ON openapi_secrets (server_id)'],
  })
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId('openapi_secrets')
  app.delete(collection)
})
