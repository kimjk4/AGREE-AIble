// /api/anthropic.js
// Using plain JavaScript for better compatibility

export default async function handler(req, res) {
  // Enable CORS if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Received request body:', JSON.stringify(req.body).substring(0, 200));
    
    const { model, system, user, max_tokens, temperature, top_p, apiKey } = req.body;

    // Validate required fields
    if (!user) {
      return res.status(400).json({ error: 'Missing required field: user' });
    }

    // Get API key from request or environment
    const ANTHROPIC_API_KEY = apiKey || process.env.ANTHROPIC_API_KEY;
    
    if (!ANTHROPIC_API_KEY) {
      console.error('No API key available');
      return res.status(400).json({ 
        error: 'No API key provided. Either pass apiKey in request or set ANTHROPIC_API_KEY env variable' 
      });
    }

    // Prepare the request to Anthropic
    const anthropicRequest = {
      model: model || 'claude-sonnet-4-20250514',
      messages: [
        { role: 'user', content: user }
      ],
      max_tokens: max_tokens || 4096,
      temperature: temperature !== undefined ? temperature : 0.1,
      top_p: top_p !== undefined ? top_p : 1.0
    };

    // Add system message if provided
    if (system) {
      anthropicRequest.system = system;
    }

    console.log('Calling Anthropic API with model:', anthropicRequest.model);

    // Make the request to Anthropic's API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicRequest)
    });

    const responseText = await response.text();
    console.log('Anthropic response status:', response.status);

    if (!response.ok) {
      console.error('Anthropic API error:', responseText);
      return res.status(response.status).json({ 
        error: `Anthropic API error: ${response.status}`,
        details: responseText 
      });
    }

    // Parse and return the response
    try {
      const data = JSON.parse(responseText);
      return res.status(200).json(data);
    } catch (parseError) {
      console.error('Failed to parse Anthropic response:', parseError);
      return res.status(500).json({ 
        error: 'Failed to parse Anthropic response',
        details: responseText.substring(0, 500)
      });
    }

  } catch (error) {
    console.error('Unexpected error in API route:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message || 'Unknown error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Export config to increase timeout and body size limit
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: '10mb',
  },
  maxDuration: 30, // Maximum function duration in seconds
};
