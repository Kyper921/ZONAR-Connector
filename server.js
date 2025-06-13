// Simple MCP → Zonar bridge
require('dotenv').config();
const fastify = require('fastify')();
const fetchNode = (...a) => import('node-fetch').then(({default: f}) => f(...a)); // Renamed to avoid conflict
const { parseStringPromise } = require('xml2js');

// Let ChatGPT discover your tools
fastify.get('/tools/list', (_, reply) => {
  reply.send({
    tools: [
      {
        name: "search",
        description: "Searches for Zonar assets (buses) by fleet ID and returns matching results.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Fleet ID or partial Fleet ID of the bus to search for." }
          },
          required: ["query"]
        },
        output_schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Fleet ID of the bus." },
                  title: { type: "string", description: "Title representing the bus." },
                  text: { type: "string", description: "A text snippet or summary of the bus location." },
                  url: { type: ["string", "null"], description: "URL of the resource. Optional." },
                },
                required: ["id", "title", "text"]
              }
            }
          },
          required: ["results"]
        }
      },
      {
        name: "fetch",
        description: "Retrieves detailed content for a specific bus identified by its fleet ID.",
        input_schema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Fleet ID of the bus to fetch." }
          },
          required: ["id"]
        },
        output_schema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Fleet ID of the bus." },
            title: { type: "string", description: "Title representing the bus details." },
            text: { type: "string", description: "Complete textual content of the bus location and status." },
            url: { type: ["string", "null"], description: "URL of the resource. Optional." },
            metadata: {
              type: ["object", "null"],
              additionalProperties: { type: "string" },
              description: "Optional metadata providing additional context like speed and timestamp."
            }
          },
          required: ["id", "title", "text"]
        }
      }
    ]
  });
});

// Handle the actual call
fastify.post('/tools/call', async (req, reply) => {
  const { name, arguments: args = {} } = req.body;

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

    if (name === 'search') {
      const query = args.query ? args.query.toLowerCase() : '';
      const matchingAssets = allAssets.filter(asset => asset.$ && asset.$.fleet.toLowerCase().includes(query));
      
      const results = matchingAssets.map(asset => ({
        id: asset.$.fleet,
        title: `Bus ${asset.$.fleet}`,
        text: `Location for bus ${asset.$.fleet}: Lat ${asset.lat[0]}, Lon ${asset.long[0]}, Speed ${asset.speed[0]._} at ${new Date(parseInt(asset.time[0])*1000).toLocaleString()}`,
        url: null
      }));
      return reply.send({ results });

    } else if (name === 'fetch') {
      const targetBus = allAssets.find(asset => asset.$ && asset.$.fleet === args.id);

      if (!targetBus) {
        return reply.status(404).send({ error: 'Bus not found', id: args.id }); // Consider if error or specific JSON is better for MCP
      }

      reply.send({
        id: targetBus.$.fleet,
        title: `Bus ${targetBus.$.fleet} Details`,
        text: `Full details for bus ${targetBus.$.fleet}: Latitude: ${targetBus.lat[0]}, Longitude: ${targetBus.long[0]}, Speed: ${targetBus.speed[0]._}, GPS Time: ${new Date(parseInt(targetBus.time[0])*1000).toLocaleString()}`,
        url: null,
        metadata: {
          latitude: targetBus.lat[0],
          longitude: targetBus.long[0],
          speed: targetBus.speed[0]._,
          timestamp_unix: targetBus.time[0],
          timestamp_readable: new Date(parseInt(targetBus.time[0])*1000).toLocaleString(),
          raw_gps_time: targetBus.time[0]
        }
      });
    } else {
      return reply.send({ ok: true }); // Default for any other tool name (e.g. stubs from earlier)
    }

  } catch (err) {
    console.error('Error processing Zonar request:', err);
    reply.status(500).send({ error: 'Internal Server Error', message: err.message });
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
