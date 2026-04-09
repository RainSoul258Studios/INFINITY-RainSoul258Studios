import { GoogleGenAI } from '@google/genai';

function getAiClient() {
  // Use process.env.API_KEY if available (from aistudio key selection), otherwise fallback to default
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  return new GoogleGenAI({ apiKey });
}

export async function generateMusic(prompt: string, duration: 'clip' | 'full' = 'clip', modelChoice: string = 'N258Z', seed?: string): Promise<{ audioUrl: string, lyrics: string }> {
  const ai = getAiClient();
  let model = modelChoice;
  
  // Handle specific model logic
  if (modelChoice === 'lyria-3-pro-preview' && duration === 'clip') {
    model = 'lyria-3-clip-preview';
  } else if (modelChoice === 'N258Z') {
    // Si es el modelo propio N258Z, usamos el nombre del modelo o endpoint correspondiente.
    // Asumimos que está desplegado como un tunedModel o endpoint accesible vía la API de Gemini.
    // Si es un nombre de modelo custom, lo pasamos tal cual.
    model = 'models/n258z'; // O el identificador real del modelo en tu proyecto de Google Cloud
  }
  
  let finalPrompt = prompt;
  if (seed) {
    finalPrompt += `\nSeed: ${seed}`;
  }

  const response = await ai.models.generateContentStream({
    model,
    contents: finalPrompt,
  });
  
  let audioBase64 = "";
  let lyrics = "";
  let mimeType = "audio/wav";

  for await (const chunk of response) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (!audioBase64 && part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
        audioBase64 += part.inlineData.data;
      }
      if (part.text && !lyrics) {
        lyrics = part.text;
      }
    }
  }

  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  
  const audioUrl = `data:${mimeType};base64,${audioBase64}`;
  
  return { audioUrl, lyrics };
}

export async function generateImage(prompt: string): Promise<string> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-image-preview',
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
        imageSize: "1K"
      }
    }
  });
  
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/jpeg;base64,${part.inlineData.data}`;
    }
  }
  throw new Error('No image generated');
}

export async function groundedSearch(prompt: string): Promise<string> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    }
  });
  return response.text || '';
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        inlineData: {
          data: audioBase64,
          mimeType,
        }
      },
      "Please transcribe this audio accurately."
    ]
  });
  return response.text || '';
}

export async function deepThink(prompt: string): Promise<string> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      thinkingConfig: {
        thinkingLevel: 'HIGH' as any // Using any to bypass potential TS type issues if ThinkingLevel enum isn't exported correctly
      }
    }
  });
  return response.text || '';
}

export async function getSuggestions(recentActivity: {type: string, prompt: string}[]): Promise<string> {
  const ai = getAiClient();
  const prompt = `You are an AI assistant in a creative studio app called INFINITY. The app has these studios: Music Gen, Image Studio, Search Lab, Audio Transcribe, Deep Thinker, and Text to Speech.
  Here is the user's recent activity:
  ${JSON.stringify(recentActivity)}
  
  Based on this activity (or if empty, just general inspiration), suggest 3 specific, creative ideas for what they should make next using the app's capabilities. Keep it brief, inspiring, and format as a bulleted list. Do not use overly verbose introductions.`;
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
  });
  return response.text || '';
}

export async function textToSpeech(text: string, voiceName: string = 'Kore'): Promise<string> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'] as any,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });
  
  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (base64Audio) {
    // Convert base64 PCM to WAV
    const binary = atob(base64Audio);
    const pcmData = new Int16Array(binary.length / 2);
    for (let i = 0; i < pcmData.length; i++) {
      pcmData[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    }
    
    const sampleRate = 24000;
    const numChannels = 1;
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    const dataSize = pcmData.length * 2;
    
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    
    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // BitsPerSample
    
    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Write PCM data
    let offset = 44;
    for (let i = 0; i < pcmData.length; i++, offset += 2) {
      view.setInt16(offset, pcmData[i], true);
    }
    
    // Convert buffer to base64
    const bytes = new Uint8Array(buffer);
    let binaryWav = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binaryWav += String.fromCharCode(bytes[i]);
    }
    const base64Wav = btoa(binaryWav);
    
    return `data:audio/wav;base64,${base64Wav}`;
  }
  throw new Error('No audio generated');
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
