const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const definition = loader.loadSync(path.join(__dirname, 'proto/youtube-live-chat.proto'), {
  keepCase: false, longs: String, enums: String, defaults: false, arrays: true, objects: true
});
const Service = grpc.loadPackageDefinition(definition).youtube.api.v3.V3DataLiveChatMessageService;
const toType = value => typeof value === 'string' ? value.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()) : '';
function toPage(response) {
  return { nextPageToken: response.nextPageToken || null, offlineAt: response.offlineAt || null,
    items: (response.items || []).slice(0, 2000).map(item => ({
      id: item.id, snippet: item.snippet ? { ...item.snippet, type: toType(item.snippet.type) } : null,
      authorDetails: item.authorDetails
    })) };
}
function createGrpcAdapter({ address = 'youtube.googleapis.com:443', credentials = grpc.credentials.createSsl() } = {}) {
  const client = new Service(address, credentials, { 'grpc.max_receive_message_length': 4 * 1024 * 1024 });
  return { open({ token, liveChatId, pageToken }) {
    const metadata = new grpc.Metadata(); metadata.set('authorization', `Bearer ${token}`);
    return client.streamList({ liveChatId, part: ['id', 'snippet', 'authorDetails'], ...(pageToken ? { pageToken } : {}) }, metadata);
  }, close: () => client.close() };
}
module.exports = { createGrpcAdapter, toPage, Service, grpc };
