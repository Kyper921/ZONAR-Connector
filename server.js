// Simple MCP → Zonar bridge
require('dotenv').config();
const fastify = require('fastify')();
const fetchNode = (...a) => import('node-fetch').then(({default: f}) => f(...a));
const { parseStringPromise } = require('xml2js');

// Root route for health checks
fastify.get('/', async (request, reply) => {
  return { status: 'ok', message: 'ZONAR Connector is running.' };
});

// Let ChatGPT discover your tools
fastify.get('/tools/list', (request, reply) => {
  console.log(`[${new Date().toISOString()}] Received request for /tools/list from IP: ${request.ip}`);
  try {
    const toolData = {
      tools: [
        {
          name: "get_bus_location",
          description: "Returns the latest GPS location, speed, and timestamp for a specific bus by its fleet ID.",
          input_schema: {
            type: "object",
            properties: {
              bus_id: { type: "string", description: "The fleet ID of the bus." }
            },
            required: ["bus_id"]
          },
          output_schema: {
            type: "object",
            properties: {
              latitude: { type: "number", description: "Latitude of the bus." },
              longitude: { type: "number", description: "Longitude of the bus." },
              speed: { type: "number", description: "Speed of the bus." }, // Unit depends on Zonar data, assumed MPH or similar
              timestamp_unix: { type: "string", description: "GPS fix timestamp (Unix epoch seconds)." },
              timestamp_readable: { type: "string", description: "GPS fix timestamp (human-readable)." }
            },
            required: ["latitude", "longitude", "speed", "timestamp_unix", "timestamp_readable"]
          }
        }
      ]
    };
    console.log(`[${new Date().toISOString()}] Attempting to send /tools/list response.`);
    reply.send(toolData);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] !!! Critical error in /tools/list handler:`, error);
    reply.status(500).send({ error: 'Internal server error in /tools/list', details: error.message });
  }
});

// Handle the actual call
fastify.post('/tools/call', async (req, reply) => {
  const { name, arguments: args = {} } = req.body;

  if (name === 'get_bus_location') {
    const zonarUrl = `https://omi.zonarsystems.net/interface.php?action=showposition&operation=current&format=xml&logvers=3.2&customer=${process.env.ZONAR_CUSTOMER}&username=${process.env.ZONAR_USERNAME}&password=${process.env.ZONAR_PASSWORD}`;

    try {
      const xml = await (await fetchNode(zonarUrl)).text();
      const json = await parseStringPromise(xml);

      if (json.error) {
        console.error('Zonar API Error:', json.error.message[0]);
        return reply.status(502).send({ error: 'Failed to fetch data from Zonar', message: json.error.message[0] });
      }

      if (!json.currentlocations || !json.currentlocations.asset) {
        console.error('No assets found in Zonar response');
        return reply.status(404).send({ error: 'No assets found in Zonar response' });
      }
      const allAssets = Array.isArray(json.currentlocations.asset) ? json.currentlocations.asset : [json.currentlocations.asset];

      const targetBus = allAssets.find(asset => asset.$ && asset.$.fleet === args.bus_id);

      if (!targetBus) {
        return reply.status(404).send({ error: 'Bus not found', bus_id: args.bus_id });
      }

      reply.send({
        latitude: +targetBus.lat[0],
        longitude: +targetBus.long[0],
        speed: +targetBus.speed[0]._, 
        timestamp_unix: targetBus.time[0],
        timestamp_readable: new Date(parseInt(targetBus.time[0]) * 1000).toLocaleString()
      });

    } catch (err) {
      console.error('Error processing Zonar request for get_bus_location:', err);
      reply.status(500).send({ error: 'Internal Server Error', message: err.message });
    }
  } else {
    // Handle other tools or send a generic 'ok' if no specific tool is matched
    console.warn(`Unknown tool called: ${name}`);
    reply.send({ ok: true, message: `Tool '${name}' not recognized or implemented.` });
  }
});

const port = process.env.PORT || 3333;
const host = '0.0.0.0';
fastify.listen({ port, host }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`MCP server running on http://${host}:${port}`);
});
