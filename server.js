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

  const url = `https://omi.zonarsystems.net/interface.php?action=showposition&operation=current&format=xml&version=2&logvers=3&customer=${process.env.ZONAR_CUSTOMER}&username=${process.env.ZONAR_USERNAME}&password=${process.env.ZONAR_PASSWORD}&target=${args.bus_id}&reqtype=${args.id_type || 'fleet'}`;

  const xml  = await (await fetch(url)).text();
  const json = await parseStringPromise(xml);
  const a    = (json.assets.asset || [])[0] || {};

  reply.send({
    lat: +a.lat?.[0], lon: +a.long?.[0],
    speed: +a.speed?.[0], timestamp: a.time?.[0]
  });
});

fastify.listen({ port: 3333 }, (err) => {
  if (err) throw err;
  console.log('MCP server running on http://localhost:3333');
});
