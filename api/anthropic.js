// /api/anthropic.ts - Version that accepts user-provided API key
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { model, system, user, max_tokens, temperature, top_p, apiKey } = req.body;

    // Use provided API key or fall back to environment variable
    const ANTHROPIC_API_KEY = apiKey || process.env.ANTHROPIC_API_KEY;
    
    if (!ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: 'No API key provided' });
    }

    // Make the request to Anthropic's API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: user }
        ],
        system: system,
        max_tokens: max_tokens || 4096,
        temperature: temperature || 0.1,
        top_p: top_p || 1.0
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ 
        error: `Anthropic API error: ${response.status}`,
        details: errorText 
      });
    }

    const data = await response.json();
    
    // Return the response in the format expected by your frontend
    return res.status(200).json(data);

  } catch (error) {
    console.error('Error calling Anthropic API:', error);
    return res.status(500).json({ 
      error: 'Failed to call Anthropic API',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
