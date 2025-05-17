const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const twilio = require('twilio');
const dotenv = require('dotenv');
const fetch = require('node-fetch').default;

dotenv.config();

const app = express();
const server = http.createServer(app);

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const NGROK_URL = process.env.NGROK_URL || 'http://localhost:5050';
const PORT = process.env.PORT || 5050;


if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    throw new Error('Missing required environment variables');
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

app.use(express.json());

app.post('/make-call', async (req, res) => {
    const { to, prompt, initialScript } = req.body;
    if (!to) return res.status(400).json({ error: 'Phone number ("to") is required' });

    const encodedPrompt = encodeURIComponent(prompt);
    const encodedInitialScript = encodeURIComponent(initialScript);

    try {
        const call = await twilioClient.calls.create({
            url: `${NGROK_URL}/connect?prompt=${encodedPrompt}&initialScript=${encodedInitialScript}`,
            to,
            from: TWILIO_PHONE_NUMBER
        });
        console.log(`Call initiated: ${call.sid}`);
        res.json({ call_sid: call.sid, message: 'Call initiated successfully' });
    } catch (error) {
        console.error(`Call initiation failed: ${error.message}`);
        res.status(500).json({ error: `Failed to initiate call: ${error.message}` });
    }
});

app.all('/connect', (req, res) => {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say('Connecting to AI assistant...');
    const connect = response.connect();
    const stream = connect.stream({ url: `wss://${req.hostname}/media-stream` });
    stream.parameter({ name: 'prompt', value: req.query.prompt});
    stream.parameter({ name: 'initialScript', value: req.query.initialScript  });

    res.type('text/xml');
    res.send(response.toString());
});

async function getSignedUrl() {
    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
            {
                method: 'GET',
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to get signed URL: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Signed URL:', data.signed_url);
        return data.signed_url;
    } catch (error) {
        console.error('Error getting signed URL:', error);
        throw error;
    }
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Twilio connected');

    let streamSid;
    let elevenLabsWs;
    let customParameters;

    const setupElevenLabs = async () => {
        try {
            const signedUrl = await getSignedUrl();
            elevenLabsWs = new WebSocket(signedUrl);

            elevenLabsWs.on('open', () => {
                console.log('[ElevenLabs] Connected to Conversational AI');
                const initialConfig = {
                    type: 'conversation_initiation_client_data',
                    conversation_config_override: {
                        agent: {
                            prompt: { prompt: customParameters?.prompt},
                            first_message: customParameters?.initialScript
                        }
                    }
                };

                console.log('[ElevenLabs] Sending initial config - Prompt:', initialConfig.conversation_config_override.agent.prompt.prompt);
                console.log('[ElevenLabs] Sending initial config - First Message:', initialConfig.conversation_config_override.agent.first_message);
                elevenLabsWs.send(JSON.stringify(initialConfig));
            });

            elevenLabsWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data);

                    switch (message.type) {
                        case 'conversation_initiation_metadata':
                            console.log('[ElevenLabs] Received initiation metadata');
                            break;

                        case 'audio':
                            if (streamSid) {
                                if (message.audio?.chunk) {
                                    const audioData = {
                                        event: 'media',
                                        streamSid,
                                        media: { payload: message.audio.chunk }
                                    };
                                    ws.send(JSON.stringify(audioData));
                                } else if (message.audio_event?.audio_base_64) {
                                    const audioData = {
                                        event: 'media',
                                        streamSid,
                                        media: { payload: message.audio_event.audio_base_64 }
                                    };
                                    ws.send(JSON.stringify(audioData));
                                }
                            } else {
                                console.log('[ElevenLabs] Received audio but no StreamSid yet');
                            }
                            break;

                        case 'interruption':
                            if (streamSid) {
                                ws.send(JSON.stringify({ event: 'clear', streamSid }));
                            }
                            break;

                        case 'ping':
                            if (message.ping_event?.event_id) {
                                elevenLabsWs.send(JSON.stringify({
                                    type: 'pong',
                                    event_id: message.ping_event.event_id
                                }));
                            }
                            break;

                        default:
                            console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
                    }
                } catch (error) {
                    console.error('[ElevenLabs] Error processing message:', error);
                }
            });

            elevenLabsWs.on('error', (error) => {
                console.error('[ElevenLabs] WebSocket error:', error);
            });

            elevenLabsWs.on('close', () => {
                console.log('[ElevenLabs] Disconnected');
            });
        } catch (error) {
            console.error('[ElevenLabs] Setup error:', error);
        }
    };

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`[Twilio] Received event: ${data.event}`);

            if (data.event === 'media' && elevenLabsWs?.readyState === WebSocket.OPEN) {
                const audioMessage = {
                    user_audio_chunk: Buffer.from(data.media.payload, 'base64').toString('base64')
                };
                elevenLabsWs.send(JSON.stringify(audioMessage));
            } else if (data.event === 'start') {
                streamSid = data.start.streamSid;
                customParameters = data.start.customParameters; 
                console.log(`[Twilio] Stream started - StreamSid: ${streamSid}`);
                console.log('[Twilio] Custom Parameters:', customParameters);
                setupElevenLabs(); 
            } else if (data.event === 'stop') {
                console.log(`[Twilio] Stream ${streamSid} ended`);
                if (elevenLabsWs?.readyState === WebSocket.OPEN) {
                    elevenLabsWs.close();
                }
            }
        } catch (error) {
            console.error('[Twilio] Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('[Twilio] Disconnected');
        if (elevenLabsWs?.readyState === WebSocket.OPEN) {
            elevenLabsWs.close();
        }
    });

    ws.on('error', (error) => console.error('[Twilio] WebSocket error:', error));
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Ensure ngrok is running: ./ngrok http ${PORT}`);
    console.log(`Update NGROK_URL in .env with the ngrok URL after starting ngrok`);
});