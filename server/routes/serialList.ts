import express, { Request, Response } from 'express';
import { authorize, dosProtect } from '../middleware';

const router = express.Router();

const token = process.env.MIDDLEMAN_TOKEN;

router.get('/getGateways', ...dosProtect, authorize, async (req: Request, res: Response) => {
  try {
    const middlemanUrl = process.env.MIDDLEMAN_URL;

    if (!token) {
      return res.status(500).json({
        success: false,
        message: 'MIDDLEMAN_TOKEN not configured',
      });
    }

    const queryParams = new URLSearchParams();
    if (req.query.limit) queryParams.append('limit', String(req.query.limit));
    if (req.query.offset) queryParams.append('offset', String(req.query.offset));

    const url = `${middlemanUrl}/api/gateways${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `${token}`,
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
  } catch (error: any) {
    console.error('Error fetching gateways:', error);
    res.status(500).json({
      success: false,
      message: error?.message,
    });
  }
});

router.post('/registerGateway', ...dosProtect, authorize, async (req: Request, res: Response) => {
  try {
    const { eurid, serial, cpu_serial, mac_address, productId } = req.body;

    if (!eurid || !serial) {
      return res.status(400).json({
        success: false,
        message: 'EURID and Serial are required',
      });
    }

    if (!token) {
      return res.status(500).json({
        success: false,
        message: 'API token not configured',
      });
    }

    const middlemanUrl = process.env.MIDDLEMAN_URL;

    const response = await fetch(`${middlemanUrl}/api/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
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
        message: responseText,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Gateway registered successfully',
      data: responseText,
    });
  } catch (error: any) {
    console.error('Error registering gateway:', error);
    res.status(500).json({
      success: false,
      message: error?.message,
    });
  }
});

export default router;
