import { GoogleGenAI } from '@google/genai';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// TTS model — Gemini 2.5 Flash with native TTS
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// Voice selection — configurable via env var
// Available voices: Zephyr, Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus
const TTS_VOICE = process.env.TTS_VOICE || 'Orus';

// Ensure temp directory exists
const TEMP_DIR = join(process.cwd(), 'data', 'temp_audio');
mkdirSync(TEMP_DIR, { recursive: true });

/**
 * Convert text to a WhatsApp-compatible voice note (OGG/Opus).
 * Uses Gemini's native TTS with pronunciation coaching.
 * 
 * @param {string} text - The text to convert to speech
 * @returns {Promise<Buffer|null>} OGG audio buffer, or null on failure
 */
export async function textToVoiceNote(text) {
    if (!text || text.trim().length < 5) return null;

    // Pre-process text for better pronunciation
    let spokenText = text
        .replace(/TZS\s*/gi, 'shilingi ')           // TZS → shilingi
        .replace(/Tshs?\s*/gi, 'shilingi ')          // Tsh/Tshs → shilingi
        .replace(/\bHP\b/g, 'H P')                    // HP → H P (spell out)
        .replace(/\bGB\b/g, 'giga')                   // GB → giga
        .replace(/\bRAM\b/g, 'ram')                   // RAM → ram
        .replace(/\bSSD\b/g, 'S S D')                 // SSD → S S D
        .replace(/\bi\d/g, (m) => m.replace('i', 'i ')) // i5 → i 5
        .replace(/\bG\d+/g, (m) => m.split('').join(' ')) // G4 → G 4
        .replace(/\*([^*]+)\*/g, '$1')                 // Remove *bold* markers
        .replace(/🔹|▪️|✅|📦|💰|🔥|👋|🎤|📸|🧠|📊|🚨|📉|🧾|📋|💡|📎|🎯|🛒/g, '') // Remove emojis
        .replace(/\s+/g, ' ')                          // Clean up spaces
        .trim();

    // Limit length for reasonable audio duration
    spokenText = spokenText.slice(0, 600);

    try {
        const response = await genai.models.generateContent({
            model: TTS_MODEL,
            contents: [{
                role: 'user',
                parts: [{ text: `Soma hii kwa sauti ya kawaida na ya kirafiki, kama mtu wa biashara anayeongea na mteja wake. Ongea kwa Kiswahili kizuri, polepole na kwa uwazi:\n\n${spokenText}` }]
            }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: TTS_VOICE
                        }
                    }
                }
            }
        });

        // Extract audio data
        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!audioData || !audioData.data) {
            console.error('❌ [TTS] No audio data in response');
            return null;
        }

        // Convert raw PCM → OGG/Opus for WhatsApp
        const timestamp = Date.now();
        const pcmPath = join(TEMP_DIR, `tts_${timestamp}.pcm`);
        const oggPath = join(TEMP_DIR, `tts_${timestamp}.ogg`);

        const pcmBuffer = Buffer.from(audioData.data, 'base64');
        writeFileSync(pcmPath, pcmBuffer);

        // Gemini TTS: 24kHz, 16-bit, mono PCM → OGG/Opus
        execSync(
            `ffmpeg -f s16le -ar 24000 -ac 1 -i "${pcmPath}" -c:a libopus -b:a 48k -ar 48000 "${oggPath}" -y 2>/dev/null`,
            { timeout: 15000 }
        );

        const oggBuffer = readFileSync(oggPath);

        // Cleanup
        try { unlinkSync(pcmPath); } catch { }
        try { unlinkSync(oggPath); } catch { }

        console.log(`🎤 [TTS] ${TTS_VOICE} voice, ${(oggBuffer.length / 1024).toFixed(1)}KB`);
        return oggBuffer;

    } catch (error) {
        console.error(`❌ [TTS] Error: ${error.message}`);
        return null;
    }
}

/**
 * Check if voice replies are enabled
 */
export function isVoiceEnabled() {
    return process.env.VOICE_REPLIES !== 'false';
}
