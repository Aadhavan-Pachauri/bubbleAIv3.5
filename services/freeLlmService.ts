
import { Message } from "../types";

const SYSTEM_PROMPT = `You are Bubble, a helpful, friendly, and intelligent AI assistant. 
You are currently in "Instant Mode" (Guest Mode).
- Be concise and direct.
- Use a warm, conversational tone.
- Do not hallucinate features you don't have access to (like memory or file editing).
`;

export const generateFreeCompletion = async (
    messages: { role: string; content: string }[], 
    onStream?: (chunk: string) => void,
    signal?: AbortSignal
): Promise<string> => {
    try {
        // Construct the prompt. We prepend the system prompt.
        const conversationPrompt = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
        
        const fullPayload = `${SYSTEM_PROMPT}\n\n=== CONVERSATION HISTORY ===\n${conversationPrompt}\n\nAssistant:`;

        const response = await fetch('https://apifreellm.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: fullPayload
            }),
            signal
        });

        if (!response.ok) {
             throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status === 'success') {
            const aiText = data.response;
            
            // Simulate streaming for UI consistency
            if (onStream) {
                const chunkSize = 4;
                for (let i = 0; i < aiText.length; i += chunkSize) {
                    if (signal?.aborted) break;
                    const chunk = aiText.slice(i, i + chunkSize);
                    onStream(chunk);
                    await new Promise(r => setTimeout(r, 15));
                }
            }
            return aiText;
        } else {
            throw new Error(data.error || 'API returned error status');
        }

    } catch (error: any) {
        if (error.name === 'AbortError') {
            return '';
        }
        console.error("Free LLM Service Failed:", error);
        
        let errorMessage = "Unable to connect to the free AI service.";
        if (error.message.includes("Rate limit") || (typeof error.message === 'string' && error.message.toLowerCase().includes("wait"))) {
            errorMessage = "Rate limit exceeded (1 request per 5s). Please wait a moment.";
        } else {
            errorMessage = `[Instant Mode Error] ${error.message}`;
        }

        if (onStream) onStream(errorMessage);
        return errorMessage;
    }
};

export const generateFreeTitle = async (userMessage: string, aiResponse: string): Promise<string> => {
    const words = userMessage.split(' ').slice(0, 5).join(' ');
    const title = words.charAt(0).toUpperCase() + words.slice(1);
    return title.length > 0 ? title : "New Chat";
};
