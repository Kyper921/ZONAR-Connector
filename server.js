// Simple MCP → Zonar bridge
require('dotenv').config();
const fastify = require('fastify')();
const fetch = (...a) => import('node-fetch').then(({default: f}) => f(...a));
const { parseStringPromise } = require('xml2js');

// Let ChatGPT discover your tools
fastify.get('/tools/list', (_, reply) => {
  reply.send({
    tools: [
      { name: 'search', description: 'stub', parameters: { type: 'object' }, result_schema: { type: 'array' } },
      { name: 'fetch',  description: 'stub', parameters: { type: 'object' }, result_schema: { type: 'string' } },
      {
        name: 'get_bus_location',
        description: 'Return latest GPS fix for a bus',
        parameters: {
          type: 'object',
          properties: {
            bus_id:  { type: 'string',  description: 'Fleet number / dbid / vin / tag' },
            id_type: { type: 'string',  enum: ['fleet','dbid','vin','tag'], default: 'fleet' }
          },
          required: ['bus_id']
        },
        result_schema: { type: 'object' }
      }
    ]
  });
});

// Handle the actual call
fastify.post('/tools/call', async (req, reply) => {
  const { name, arguments: args = {} } = req.body;
  if (name !== 'get_bus_location') return reply.send({ ok: true }); // ignore stubs

  // URL now fetches all assets, like the working Apps Script. Using logvers 3.2 to match.
  const url = `https://omi.zonarsystems.net/interface.php?action=showposition&operation=current&format=xml&logvers=3.2&customer=${process.env.ZONAR_CUSTOMER}&username=${process.env.ZONAR_USERNAME}&password=${process.env.ZONAR_PASSWORD}`;

  try {
    const xml  = await (await fetch(url)).text();
    const json = await parseStringPromise(xml);

    // Check for API error response
    if (json.error) {
      console.error('Zonar API Error:', json.error.message[0]);
      return reply.status(502).send({ error: 'Failed to fetch data from Zonar', message: json.error.message[0] });
    }

    // The root element is <currentlocations>, not <assets>
    if (!json.currentlocations || !json.currentlocations.asset) {
      console.error('No assets found in Zonar response (expected <currentlocations> tag)');
      return reply.status(404).send({ error: 'No assets found in Zonar response (expected <currentlocations> tag)' });
    }

    const allAssets = json.currentlocations.asset;
    
    // Find the specific bus by its fleet number (which is in the '$' attribute)
    const targetBus = allAssets.find(asset => asset.$ && asset.$.fleet === args.bus_id);

    if (!targetBus) {
      return reply.status(404).send({ error: 'Bus not found', bus_id: args.bus_id });
    }

    // Extract data from the found bus
    reply.send({
      lat: +targetBus.lat[0],
      lon: +targetBus.long[0],
      speed: +targetBus.speed[0]._, // Speed value is text content
      timestamp: targetBus.time[0]
    });
  } catch (err) {
    console.error('Error processing Zonar request:', err);
    reply.status(500).send({ error: 'Internal Server Error', message: err.message });
  }
});

fastify.listen({ port: process.env.PORT || 3333, host: '0.0.0.0' }, (err) => {
  if (err) throw err;
  console.log('MCP server running on http://localhost:3333');
});
