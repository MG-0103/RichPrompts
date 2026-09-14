export const sampleRegistryTools = [
  {
    id: 'search_web',
    raw: JSON.stringify(
      {
        name: 'search_web',
        description: 'Search the public web for a query and return the top 10 results. Example: search_web(q="..."). Not for internal documents.',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string', description: 'natural language query' } },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'web_query',
    raw: JSON.stringify(
      {
        name: 'web_query',
        description: 'Query the public web for a search term and return the top results. Example: web_query(q="..."). Not for local files.',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string', description: 'search term in natural language' } },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'read_file',
    raw: JSON.stringify(
      {
        name: 'read_file',
        description: 'Read a local file from disk and return its UTF-8 contents. Example: read_file(path="/etc/hosts"). Do not use for network URLs.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'absolute path on the local filesystem' } },
        },
      },
      null,
      2,
    ),
  },
]

export const sampleRegistrySkills = [
  {
    id: 'weather-lookup',
    raw: `---
name: weather-lookup
description: Use when the user asks about weather, temperature, or forecast. Not for climate history.
---
Body.`,
  },
  {
    id: 'weather-forecast',
    raw: `---
name: weather-forecast
description: Use when the user asks about temperature, forecast, or weather conditions. Not for historical climate.
---
Body.`,
  },
]
