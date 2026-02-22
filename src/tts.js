import { GoogleGenAI } from '@google/genai';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// TTS model — Gemini 2.5 Flash with native TTS
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// Ensure temp directory exists
const TEMP_DIR = join(process.cwd(), 'data', 'temp_audio');
mkdirSync(TEMP_DIR, { recursive: true });

/**
 * Convert text to a WhatsApp-compatible voice note (OGG/Opus).
 * Uses Gemini's native TTS with a Swahili-optimized voice.
 * 
 * @param {string} text - The text to convert to speech
 * @returns {Promise<Buffer|null>} OGG audio buffer, or null on failure
 */
export async function textToVoiceNote(text) {
    // Skip TTS for very short or empty texts
    if (!text || text.trim().length < 5) return null;

    // Limit text length to avoid huge audio files (WhatsApp has limits)
    const truncated = text.slice(0, 800);

    try {
        const response = await genai.models.generateContent({
            model: TTS_MODEL,
            contents: [{
                role: 'user',
                parts: [{ text: truncated }]
            }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: 'Kore'  // Clear, natural voice
                        }
                    }
                }
            }
        });

        // Extract audio data from response
        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!audioData || !audioData.data) {
            console.error('❌ [TTS] No audio data in response');
            return null;
        }

        // Gemini outputs raw PCM audio — convert to OGG/Opus for WhatsApp
        const timestamp = Date.now();
        const pcmPath = join(TEMP_DIR, `tts_${timestamp}.pcm`);
        const oggPath = join(TEMP_DIR, `tts_${timestamp}.ogg`);

        // Write raw PCM to temp file
        const pcmBuffer = Buffer.from(audioData.data, 'base64');
        writeFileSync(pcmPath, pcmBuffer);

        // Convert PCM → OGG/Opus using ffmpeg
        // Gemini TTS outputs: 24kHz, 16-bit, mono, little-endian PCM
        execSync(
            `ffmpeg -f s16le -ar 24000 -ac 1 -i "${pcmPath}" -c:a libopus -b:a 32k -ar 48000 "${oggPath}" -y 2>/dev/null`,
            { timeout: 10000 }
        );

        // Read the OGG file
        const { readFileSync } = await import('fs');
        const oggBuffer = readFileSync(oggPath);

        // Cleanup temp files
        try { unlinkSync(pcmPath); } catch { }
        try { unlinkSync(oggPath); } catch { }

        console.log(`🎤 [TTS] Generated ${(oggBuffer.length / 1024).toFixed(1)}KB voice note`);
        return oggBuffer;

    } catch (error) {
        console.error(`❌ [TTS] Error: ${error.message}`);
        return null; // Graceful fallback — text reply still works
    }
}

/**
 * Check if voice replies are enabled
 */
export function isVoiceEnabled() {
    return process.env.VOICE_REPLIES !== 'false'; // Enabled by default
}
