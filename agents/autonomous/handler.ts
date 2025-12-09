
import { GoogleGenAI } from "@google/genai";
import { AgentInput, AgentExecutionResult } from '../types';
import { getUserFriendlyError } from '../errorUtils';
import { generateImage } from '../../services/geminiService';
import { incrementThinkingCount } from '../../services/databaseService';
import { researchService } from "../../services/researchService";
import { BubbleSemanticRouter, RouterAction } from "../../services/semanticRouter";
import { Memory5Layer } from "../../services/memoryService";
import { autonomousInstruction } from './instructions';
import { runCanvasAgent } from "../canvas/handler";
import { generateFreeCompletion } from "../../services/freeLlmService";
import { 
    shouldUseExternalSearch, 
    runMcpWebSearch, 
    fetchContentsForResults,
    fetchPageContentWithJina,
    WebSearchResult 
} from "../../services/externalSearchService";

const formatTimestamp = () => {
    return new Date().toLocaleString(undefined, { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', 
        hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' 
    });
};

const isGoogleModel = (model: string) => {
    if (!model) return true; 
    return model.startsWith('gemini') || model.startsWith('veo') || model.includes('google');
};

// Helper: Convert File to base64 string
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            // Remove data:image/png;base64, prefix
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
};

const generateContentStreamWithRetry = async (
    ai: GoogleGenAI, 
    params: any, 
    retries = 3,
    onRetry?: (msg: string) => void
) => {
    if (!params.model) {
        console.warn("Model undefined in generateContent call, defaulting to gemini-2.5-flash");
        params.model = 'gemini-2.5-flash';
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await ai.models.generateContentStream(params);
        } catch (error: any) {
            const isQuotaError = error.status === 429 || 
                                 (error.message && error.message.includes('429')) ||
                                 (error.message && error.message.includes('quota'));
            
            if (isQuotaError && attempt < retries) {
                const delay = Math.pow(2, attempt) * 2000 + 1000; 
                console.warn(`Quota limit hit. Retrying in ${delay}ms...`);
                if (onRetry) onRetry(`(Rate limit hit. Retrying in ${Math.round(delay/1000)}s...)`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error("Max retries exceeded");
};

// Helper for reading file text in browser environment
const readTextFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
};

export const runAutonomousAgent = async (input: AgentInput): Promise<AgentExecutionResult> => {
    let { prompt, files, apiKey, project, chat, history, supabase, user, profile, onStreamChunk, model, thinkingMode, signal } = input;
    
    // INSTANT MODE: Bypass normal routing and use Free LLM Provider
    if (thinkingMode === 'instant') {
        try {
            const historyWithoutLast = history.length > 0 && history[history.length - 1].sender === 'user' ? history.slice(0, -1) : history;
            const messages = historyWithoutLast.map(m => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.text
            }));
            
            let fileContext = "";
            let imageNote = "";

            if (files && files.length > 0) {
                for (const file of files) {
                    if (file.type.startsWith('image/')) {
                        imageNote += `\n[User attached an image: "${file.name}". Note: I cannot see images in Instant Mode, so I should ask the user to describe it if needed.]`;
                    } else if (
                        file.type.startsWith('text/') || 
                        file.name.endsWith('.js') || 
                        file.name.endsWith('.ts') || 
                        file.name.endsWith('.tsx') || 
                        file.name.endsWith('.jsx') || 
                        file.name.endsWith('.py') || 
                        file.name.endsWith('.json') || 
                        file.name.endsWith('.md') ||
                        file.name.endsWith('.html') ||
                        file.name.endsWith('.css') ||
                        file.name.endsWith('.lua')
                    ) {
                        try {
                            const content = await readTextFile(file);
                            fileContext += `\n\n--- FILE CONTENT: ${file.name} ---\n${content}\n--- END FILE ---\n`;
                        } catch (e) {
                            console.warn(`Failed to read file ${file.name}`, e);
                            fileContext += `\n[Error reading file: ${file.name}]`;
                        }
                    } else {
                        fileContext += `\n[Attached file: ${file.name} (Binary/Unsupported for read)]`;
                    }
                }
            }

            const finalPrompt = `${prompt}${imageNote}${fileContext}`;
            messages.push({ role: 'user', content: finalPrompt });

            const finalResponseText = await generateFreeCompletion(messages, onStreamChunk, signal);
            return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: finalResponseText }] };
        } catch (e) {
            console.error("Instant mode failed", e);
            throw new Error("Instant mode service unavailable.");
        }
    }

    if (!model || model.trim() === '') {
        model = 'gemini-2.5-flash';
    }

    let thinkingBudget = 0;
    
    if (thinkingMode === 'deep') {
        const preferredDeep = profile?.preferred_deep_model;
        model = preferredDeep || 'gemini-3-pro-preview';
        thinkingBudget = 8192; 
    } else if (thinkingMode === 'think') {
        model = 'gemini-2.5-flash';
        thinkingBudget = 2048; 
    }

    if (thinkingBudget > 0 && !model.includes('gemini-2.5') && !model.includes('gemini-3')) {
        onStreamChunk?.(`\n*(Switched to Gemini 2.5 Flash for Thinking mode compatibility)*\n`);
        model = 'gemini-2.5-flash';
    }

    let finalResponseText = '';

    try {
        const isNative = isGoogleModel(model);
        const modelSupportsSearch = isNative || model.includes('perplexity');
        const openRouterKey = profile?.openrouter_api_key;

        if (!isNative && !openRouterKey) {
             onStreamChunk?.("\n*(OpenRouter key missing, falling back to Gemini...)*\n");
             model = 'gemini-2.5-flash';
        }

        const ai = new GoogleGenAI({ apiKey }); 
        const router = new BubbleSemanticRouter(supabase);
        const memory = new Memory5Layer(supabase, user.id);

        // ... (YouTube handling omitted for brevity, logic remains same) ...

        const fileCount = files ? files.length : 0;
        let routing = await router.route(prompt, user.id, apiKey, fileCount);
        
        // Initial External Search Detection
        let externalSearchContext = "";
        let externalMetadata: any[] = [];
        
        if (shouldUseExternalSearch(prompt, modelSupportsSearch, false)) {
            // Signal UI we are starting a search immediately
            onStreamChunk?.("<SEARCH>" + prompt + "</SEARCH>");
            
            try {
                const searchResults = await runMcpWebSearch(prompt, 15);
                if (searchResults.length > 0) {
                    const pages = await fetchContentsForResults(searchResults, 15);
                    
                    externalMetadata = pages.map(p => ({ 
                        web: { uri: p.url, title: p.title } 
                    }));

                    externalSearchContext = `
=== EXTERNAL WEB SEARCH RESULTS (JINA READER) ===
Query: "${prompt}"
${pages.map((p, i) => `
--- RESULT ${i+1} ---
Title: ${p.title}
URL: ${p.url}
Content: ${p.content || p.snippet || '(No content available)'}
`).join('\n')}
=================================================
`;
                }
            } catch (err) {
                console.warn("External search failed gracefully:", err);
            }
        }

        const memoryContext = await memory.getContext([
            'inner_personal', 'outer_personal', 'personal', 
            'interests', 'preferences', 'custom', 
            'codebase', 'aesthetic', 'project'
        ]);
        const dateTimeContext = `[CURRENT DATE & TIME]\n${formatTimestamp()}\n`;
        
        const rawModelName = model.split('/').pop() || model;
        const friendlyModelName = rawModelName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            
        let modelIdentityBlock = `You are currently running on the model: **${friendlyModelName}**.\nIf the user asks "Which AI model are you?", reply that you are Bubble, running on ${friendlyModelName}.`;
        
        if (thinkingBudget > 0) {
            modelIdentityBlock += `\n\n[THINKING ENABLED]\nBudget: ${thinkingBudget} tokens. MANDATORY: Wrap thought process in <THINK> tags.`;
        }

        const baseSystemInstruction = autonomousInstruction.replace('[MODEL_IDENTITY_BLOCK]', modelIdentityBlock);

        let metadataPayload: any = { groundingMetadata: externalMetadata.length > 0 ? externalMetadata : undefined };
        let fallbackSearchContext = ''; 
        
        let currentAction: RouterAction = routing.action;
        let currentPrompt = prompt;
        let loopCount = 0;
        const MAX_LOOPS = 6; 

        while (loopCount < MAX_LOOPS) {
            if (signal?.aborted) break;
            loopCount++;

            const enrichedMemoryContext = { ...memoryContext, external_web_search: externalSearchContext };

            switch (currentAction) {
                // ... (Other action cases like IMAGE, CANVAS, PROJECT, STUDY remain same) ...

                case 'SIMPLE':
                default: {
                    const systemPrompt = `${baseSystemInstruction}\n\n[MEMORY]\n${JSON.stringify(enrichedMemoryContext)}\n\n${dateTimeContext}`;
                    
                    const historyWithoutLast = (history.length > 0 && history[history.length - 1].sender === 'user') 
                        ? history.slice(0, -1) 
                        : history;

                    const historyMessages = historyWithoutLast.map(msg => ({
                        role: msg.sender === 'user' ? 'user' : (isNative ? 'model' : 'assistant'),
                        parts: [{ text: msg.text }] 
                    })).filter(msg => msg.parts[0].text.trim() !== '');

                    // === IMAGE & FILE HANDLING START ===
                    // Attach files to the current user turn
                    const userParts: any[] = [{ text: currentPrompt }];

                    if (files && files.length > 0 && isNative) {
                        for (const file of files) {
                            if (file.type.startsWith('image/')) {
                                try {
                                    const base64Data = await fileToBase64(file);
                                    userParts.push({
                                        inlineData: {
                                            mimeType: file.type,
                                            data: base64Data
                                        }
                                    });
                                } catch (e) {
                                    console.error("Failed to process image attachment:", e);
                                    userParts.push({ text: `[Error attaching image: ${file.name}]` });
                                }
                            } else if (file.type.startsWith('text/') || file.name.match(/\.(js|ts|jsx|tsx|html|css|json|md|py|lua)$/)) {
                                try {
                                    const content = await readTextFile(file);
                                    userParts.push({ text: `\n\n--- FILE: ${file.name} ---\n${content}\n--- END FILE ---\n` });
                                } catch (e) {
                                    userParts.push({ text: `[Error reading text file: ${file.name}]` });
                                }
                            }
                        }
                    }
                    // === IMAGE & FILE HANDLING END ===

                    historyMessages.push({ role: 'user', parts: userParts } as any);

                    const contents = historyMessages.map(m => ({ role: m.role, parts: m.parts }));
                    const config: any = { systemInstruction: systemPrompt };
                    config.tools = [{ googleSearch: {} }];
                    
                    if (thinkingBudget > 0) config.thinkingConfig = { thinkingBudget: thinkingBudget };

                    const generator = await generateContentStreamWithRetry(ai, {
                        model,
                        contents,
                        config
                    }, 3, (msg) => onStreamChunk?.(msg));

                    let generatedThisLoop = "";

                    for await (const chunk of generator) {
                        if (signal?.aborted) break;
                        if (chunk.text) {
                            generatedThisLoop += chunk.text;
                            finalResponseText += chunk.text;
                            onStreamChunk?.(chunk.text);
                            
                            if (isNative) {
                                const candidate = (chunk as any).candidates?.[0];
                                if (candidate?.groundingMetadata?.groundingChunks) {
                                    if (!metadataPayload.groundingMetadata) metadataPayload.groundingMetadata = [];
                                    metadataPayload.groundingMetadata.push(...candidate.groundingMetadata.groundingChunks);
                                }
                            }

                            // Check for closing tags to break and execute tools
                            if (generatedThisLoop.includes('</CANVAS_TRIGGER>') ||
                                generatedThisLoop.includes('</CANVASTRIGGER>') || // Handle typo
                                generatedThisLoop.includes('</SEARCH>') || 
                                generatedThisLoop.includes('</DEEP>') || 
                                generatedThisLoop.includes('</IMAGE>') ||
                                generatedThisLoop.includes('</PROJECT>') ||
                                generatedThisLoop.includes('</CANVAS>') ||
                                generatedThisLoop.includes('</STUDY>')
                            ) {
                                break; 
                            }
                        }
                    }
                    
                    // --- MULTI-SEARCH DETECTION ---
                    const searchMatches = [...generatedThisLoop.matchAll(/<SEARCH>([\s\S]*?)<\/SEARCH>/g)];
                    
                    if (searchMatches.length > 0) {
                        const queries = searchMatches.map(m => m[1].trim());
                        
                        // Check if we should use the new pipeline for these queries
                        if (shouldUseExternalSearch(queries[0], modelSupportsSearch, true)) {
                             // Force UI to show all queries being searched
                             // This relies on the ChatMessage parsing logic to pick up the tags
                             
                             const parallelResults = await Promise.all(
                                queries.map(async (q) => {
                                    try {
                                        const results = await runMcpWebSearch(q, 20);
                                        const pages = await fetchContentsForResults(results, 20);
                                        return { query: q, pages };
                                    } catch (e) {
                                        return { query: q, pages: [] };
                                    }
                                })
                             );

                             const validResults = parallelResults.filter(r => r.pages.length > 0);
                             
                             if (validResults.length > 0) {
                                 // Aggregate metadata
                                 const allNewMeta: any[] = [];
                                 let aggregatedContext = "";

                                 validResults.forEach(res => {
                                     res.pages.forEach(p => allNewMeta.push({ web: { uri: p.url, title: p.title } }));
                                     
                                     aggregatedContext += `\n\n=== WEB RESULTS FOR QUERY: "${res.query}" ===\n`;
                                     aggregatedContext += res.pages.map((p, i) => `[${i+1}] ${p.title} (${p.url}):\n${p.content}`).join('\n\n');
                                 });

                                 if (!metadataPayload.groundingMetadata) metadataPayload.groundingMetadata = [];
                                 metadataPayload.groundingMetadata.push(...allNewMeta);
                                 
                                 fallbackSearchContext = aggregatedContext;
                                 
                                 const synthesisPrompt = `USER ORIGINALLY ASKED: ${prompt}\n\nI have performed the following searches based on my previous thought process:\n${queries.map(q => `- ${q}`).join('\n')}\n\nSEARCH CONTEXT:\n${fallbackSearchContext}\n\nINSTRUCTIONS: Synthesize a comprehensive answer to the user's original query using this search data. Cite sources using [1], [2] format. Do NOT repeat the <SEARCH> tags.`;
                                 
                                 currentPrompt = synthesisPrompt;
                                 currentAction = 'SIMPLE';
                                 continue;
                             }
                        }
                    }

                    // ... (Logic for other tags like DEEP, IMAGE etc.) ...
                    const deepMatch = generatedThisLoop.match(/<DEEP>([\s\S]*?)<\/DEEP>/);
                    const imageMatch = generatedThisLoop.match(/<IMAGE>([\s\S]*?)<\/IMAGE>/);
                    const projectMatch = generatedThisLoop.match(/<PROJECT>([\s\S]*?)<\/PROJECT>/);
                    
                    // Match standard and potential malformed tag
                    const canvasMatch = generatedThisLoop.match(/<CANVAS_TRIGGER>([\s\S]*?)<\/CANVAS_TRIGGER>/) || 
                                        generatedThisLoop.match(/<CANVAS_TRIGGER>([\s\S]*?)<\/CANVASTRIGGER>/) || // Handle mismatched closing
                                        generatedThisLoop.match(/<CANVAS>([\s\S]*?)<\/CANVAS>/);
                                        
                    const studyMatch = generatedThisLoop.match(/<STUDY>([\s\S]*?)<\/STUDY>/);

                    if (deepMatch) { currentAction = 'DEEP_SEARCH'; currentPrompt = deepMatch[1]; continue; }
                    // Only use single search logic if multi-search didn't catch it
                    if (searchMatches.length === 1 && !fallbackSearchContext) { 
                        currentAction = 'SEARCH'; currentPrompt = searchMatches[0][1]; continue; 
                    }
                    if (imageMatch) { currentAction = 'IMAGE'; currentPrompt = imageMatch[1]; routing.parameters = { prompt: imageMatch[1] }; continue; }
                    if (projectMatch) { currentAction = 'PROJECT'; currentPrompt = projectMatch[1]; continue; }
                    if (canvasMatch) { currentAction = 'CANVAS'; currentPrompt = canvasMatch[1]; continue; }
                    if (studyMatch) { currentAction = 'STUDY'; currentPrompt = studyMatch[1]; continue; }
                    
                    if (!finalResponseText.trim() && fallbackSearchContext) {
                        finalResponseText = fallbackSearchContext;
                        onStreamChunk?.(fallbackSearchContext);
                    }

                    return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: finalResponseText, ...metadataPayload }] };
                }
            }
        }
        
        return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: finalResponseText, ...metadataPayload }] };

    } catch (error: any) {
        if (error.name === 'AbortError') {
            return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: finalResponseText || "(Generation stopped by user)" }] };
        }
        console.error("Error in runAutonomousAgent:", error);
        const errorMessage = error.message && error.message.includes("OpenRouter") ? error.message : getUserFriendlyError(error);
        return { messages: [{ project_id: project.id, chat_id: chat.id, sender: 'ai', text: `An error occurred: ${errorMessage}` }] };
    }
};
