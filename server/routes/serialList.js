const express = require('express');
const fs = require('fs');
const router = express.Router();
const { authorize, dosProtect } = require('../middleware');

const token = process.env.MIDDLEMAN_TOKEN;

router.get('/getGateways', ...dosProtect, authorize, async (req, res) => {
  try {
    const middlemanUrl = process.env.MIDDLEMAN_URL;
    
    if (!token) {
      return res.status(500).json({ 
        success: false, 
        message: 'MIDDLEMAN_TOKEN not configured' 
      });
    }
    
    const fetch = (...args) =>
      import('node-fetch').then(({ default: fetch }) => fetch(...args));
    
    const queryParams = new URLSearchParams();
    if (req.query.limit) queryParams.append('limit', req.query.limit);
    if (req.query.offset) queryParams.append('offset', req.query.offset);
    
    const url = `${middlemanUrl}/api/gateways${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `${token}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Middleman returned status ${response.status}`);
    }
    
    const data = await response.json();

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      res.set('Content-Range', contentRange);
    }
    
    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching gateways:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

router.post('/registerGateway', ...dosProtect, authorize, async (req, res) => {
  try {
    const { eurid, serial, cpu_serial, mac_address, productId } = req.body;
    
    if (!eurid || !serial) {
      return res.status(400).json({ 
        success: false, 
        message: 'EURID and Serial are required' 
      });
    }

    if (!token) {
      return res.status(500).json({ 
        success: false, 
        message: 'API token not configured' 
      });
    }

    const fetch = (...args) =>
      import('node-fetch').then(({ default: fetch }) => fetch(...args));
    
    const middlemanUrl = process.env.MIDDLEMAN_URL;
    
    const response = await fetch(`${middlemanUrl}/api/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      body: JSON.stringify({
        eurid,
        cpu_serial,
        mac_address,
        productId,
        serial,
      }),
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      return res.status(response.status).json({ 
        success: false, 
        message: responseText 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Gateway registered successfully',
      data: responseText 
    });
  } catch (error) {
    console.error('Error registering gateway:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;