
import { GoogleGenAI } from "@google/genai";
import { AgentInput, AgentOutput, AgentExecutionResult } from '../../types';
import { presentationAgentInstruction } from './instructions';
import { getUserFriendlyError } from '../../errorUtils';

export const runPresentationAgent = async (input: AgentInput): Promise<AgentExecutionResult> => {
    const { prompt, apiKey, model, project, chat, onStreamChunk, history, memoryContext } = input;
    try {
        const ai = new GoogleGenAI({ apiKey });
        
        // Filter history to keep context clean
        const geminiHistory = history.map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'model' as 'user' | 'model',
            parts: [{ text: msg.text }],
        })).filter(msg => msg.parts[0].text.trim() !== '');

        const contents = [...geminiHistory, { role: 'user', parts: [{ text: prompt }] }];
        const systemInstruction = `${presentationAgentInstruction}\n\nMEMORY CONTEXT:\n${memoryContext || 'No memory context available.'}`;

        onStreamChunk?.("Drafting presentation slides... 📊");

        const responseStream = await ai.models.generateContentStream({
            model: model,
            contents: contents,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.7,
                maxOutputTokens: 4096,
            },
        });

        let fullText = '';
        for await (const chunk of responseStream) {
            const chunkText = chunk.text;
            if (chunkText) {
                fullText += chunkText;
                onStreamChunk?.(chunkText);
            }
        }

        // We wrap the output in a code block with '---' delimiters if the AI didn't do it perfectly,
        // but the instruction asks for '---' separators which the PresentationWorkspace parses.
        // We'll trust the AI followed instructions but the workspace logic handles raw markdown too.
        
        // We inject a special "CODE" block for the workspace to pick up as "slides"
        // This effectively treats the markdown slides as the "code" for this project type.
        const aiMessage: AgentOutput[0] = {
            project_id: project.id,
            chat_id: chat.id,
            sender: 'ai',
            text: "Here is the presentation draft. You can view the rendered slides in the workspace panel.",
            code: fullText, // Store slides in code field for the workspace parser
            language: 'markdown'
        };

        return { messages: [aiMessage] };
    } catch (error) {
        console.error("Error in runPresentationAgent:", error);
        const errorMessage = getUserFriendlyError(error);
        const fallbackMessage: AgentOutput[0] = {
            project_id: project.id,
            chat_id: chat.id,
            sender: 'ai',
            text: errorMessage
        };
        return { messages: [fallbackMessage] };
    }
};
