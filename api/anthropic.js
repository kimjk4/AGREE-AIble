// /api/anthropic.js
// This API route requires users to provide their own Anthropic API key

export default async function handler(req, res) {
  // Enable CORS
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
    const { model, system, user, max_tokens, temperature, top_p, apiKey } = req.body;

    // Validate required fields
    if (!user) {
      return res.status(400).json({ error: 'Missing required field: user' });
    }

    // API key is required from the user
    if (!apiKey) {
      return res.status(400).json({ 
        error: 'Anthropic API key is required. Please provide your API key in the interface.' 
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

    // Make the request to Anthropic's API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,  // Use the user-provided API key
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicRequest)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch {
        errorDetails = errorText;
      }
      
      return res.status(response.status).json({ 
        error: `Anthropic API error: ${response.status}`,
        details: errorDetails
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('Error in Anthropic API route:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message || 'Unknown error'
    });
  }
}

// Configuration for Vercel
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
