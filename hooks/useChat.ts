
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './useToast';
import { Project, Message, Chat, WorkspaceMode, ChatWithProjectData } from '../types';
import { 
    getAllChatsForUser, 
    addMessage, 
    updateChat as updateDbChat, 
    getMessages, 
    deleteChat, 
    updateMessagePlan,
    getChatsForProject,
    extractAndSaveMemory
} from '../services/databaseService';
import { localChatService } from '../services/localChatService';
import { generateChatTitle } from '../services/geminiService';
import { runAgent } from '../agents';
import { User } from '@supabase/supabase-js';
import { AgentExecutionResult } from '../agents/types';
import { NEW_CHAT_NAME } from '../constants';

const DUMMY_AUTONOMOUS_PROJECT: Project = {
  id: 'autonomous-project',
  user_id: 'unknown',
  name: 'Autonomous Chat',
  description: 'A personal chat with the AI.',
  status: 'In Progress',
  platform: 'Web App',
  project_type: 'conversation',
  default_model: 'gemini-2.5-flash',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

interface UseChatProps {
    user: User | null;
    geminiApiKey: string | null;
    workspaceMode: WorkspaceMode;
    adminProject?: Project | null; 
}

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = error => reject(error);
    });
};

interface Attachment {
    type: string;
    data: string;
    name: string;
}

export const useChat = ({ user, geminiApiKey, workspaceMode, adminProject }: UseChatProps) => {
    const { supabase, profile, isGuest } = useAuth();
    const { addToast } = useToast();

    const [allChats, setAllChats] = useState<ChatWithProjectData[]>([]);
    const [activeChat, setActiveChat] = useState<ChatWithProjectData | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isCreatingChat, setIsCreatingChat] = useState(false);
    
    const isSendingRef = useRef(false);
    const activeChatIdRef = useRef<string | null>(null);
    const isMountedRef = useRef(true);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    useEffect(() => {
        activeChatIdRef.current = activeChat?.id || null;
        // Immediate clear on change to prevent ghosting
        setMessages([]); 
    }, [activeChat]);

    const activeProject = useMemo(() => adminProject ?? activeChat?.projects ?? null, [adminProject, activeChat]);
    
    useEffect(() => {
        if (!supabase || (!user && !isGuest)) return;
        
        let isCancelled = false;
        
        const fetchChats = async () => {
            setIsLoading(true);
            
            const safetyTimer = setTimeout(() => {
                if (isMountedRef.current && !isCancelled) {
                    console.warn("Chat fetch timed out - releasing loading state");
                    setIsLoading(false);
                }
            }, 30000);

            try {
                let chats: ChatWithProjectData[] = [];
                if (isGuest) {
                    chats = await localChatService.getAllChats();
                } else if (adminProject) {
                    const projectChats = await getChatsForProject(supabase, adminProject.id);
                    chats = projectChats.map(c => ({...c, projects: adminProject }));
                } else if(user) {
                    chats = await getAllChatsForUser(supabase, user.id);
                }
                
                if (!isCancelled && isMountedRef.current) {
                    setAllChats(chats);
                }
            } catch (error) {
                console.error("Error fetching chats:", error);
                if (!isCancelled && isMountedRef.current) {
                    addToast("Could not load chats.", "error");
                }
            } finally {
                clearTimeout(safetyTimer);
                if (!isCancelled && isMountedRef.current) setIsLoading(false);
            }
        };
        fetchChats();
        
        return () => { isCancelled = true; };
    }, [user, supabase, addToast, adminProject, isGuest]);

    useEffect(() => {
        let isCancelled = false;
        let channel: any = null;

        const fetchMessages = async () => {
            if (activeChat) {
                const chatId = activeChat.id;
                if (!isSendingRef.current && isMountedRef.current) setIsLoading(true);
                
                const safetyTimer = setTimeout(() => {
                    if (isMountedRef.current && activeChatIdRef.current === chatId && !isCancelled) {
                        setIsLoading(false);
                    }
                }, 30000);

                try {
                    let history: Message[] = [];
                    if (isGuest) {
                        history = await localChatService.getMessages(chatId);
                    } else if (supabase) {
                        history = await getMessages(supabase, chatId);
                    }
                    
                    if (!isCancelled && isMountedRef.current && activeChatIdRef.current === chatId) {
                        setMessages(prev => {
                            const pendingOptimistic = prev.filter(p => p.id.startsWith('temp-'));
                            if (pendingOptimistic.length > 0) {
                                const merged = [...history];
                                pendingOptimistic.forEach(opt => {
                                    const exists = history.some(h => 
                                        (h.text === opt.text && h.sender === opt.sender) ||
                                        h.id === opt.id 
                                    );
                                    if (!exists) merged.push(opt);
                                });
                                return merged;
                            }
                            return history;
                        });
                    }
                } catch (error) { 
                    // Handle PGRST204 quietly if schema is momentarily out of sync
                    const errMsg = (error as any)?.message || '';
                    if (!errMsg.includes('schema cache')) {
                        console.error("Error fetching messages:", error);
                    }
                } 
                finally { 
                    clearTimeout(safetyTimer);
                    if (!isCancelled && isMountedRef.current && activeChatIdRef.current === chatId) setIsLoading(false); 
                }
            } else {
                if (isMountedRef.current) setMessages([]);
            }
        };

        fetchMessages();
        
        // Optimize Realtime: Only subscribe if we have an active chat and are not guest
        if (activeChat && supabase && !isGuest) {
            const channelName = `chat-room:${activeChat.id}`;
            channel = supabase.channel(channelName)
                .on('postgres_changes', { 
                    event: 'INSERT', 
                    schema: 'public', 
                    table: 'messages', 
                    filter: `chat_id=eq.${activeChat.id}` 
                }, (payload) => {
                    if (!isMountedRef.current) return;
                    const newMsg = payload.new as Message;
                    if (activeChatIdRef.current === activeChat.id) {
                        setMessages(prev => {
                            if (prev.some(m => m.id === newMsg.id)) return prev;
                            const filtered = prev.filter(m => {
                                if (!m.id.startsWith('temp-')) return true;
                                const contentMatch = m.text === newMsg.text && m.sender === newMsg.sender;
                                return !contentMatch;
                            });
                            return [...filtered, newMsg];
                        });
                    }
                })
                .subscribe();
        }

        return () => { 
            isCancelled = true;
            if (channel) {
                supabase.removeChannel(channel); 
            }
        };
    }, [activeChat?.id, supabase, isGuest]);

    const handleSelectChat = useCallback((chat: ChatWithProjectData) => {
        setActiveChat(chat);
    }, []);

    const handleUpdateChat = useCallback(async (chatId: string, updates: Partial<Chat>) => {
        try {
            let updatedChat: Chat;
            if (isGuest) {
                updatedChat = await localChatService.updateChat(chatId, updates);
            } else {
                if (!supabase) return;
                updatedChat = await updateDbChat(supabase, chatId, updates);
            }
            setAllChats(prev => prev.map(c => c.id === chatId ? { ...c, ...updatedChat } : c));
            setActiveChat(prev => (prev?.id === chatId ? { ...prev, ...updatedChat } : prev));
        } catch (error) { 
             console.error("Failed to update chat:", error);
        }
    }, [supabase, isGuest]);

    const handleDeleteChat = async (chatId: string) => {
        try {
            if (isGuest) {
                await localChatService.deleteChat(chatId);
            } else {
                if (!supabase) return;
                await deleteChat(supabase, chatId);
            }
            setAllChats(prev => prev.filter(c => c.id !== chatId));
            if (activeChat?.id === chatId) setActiveChat(null);
            addToast('Chat deleted.', 'info');
        } catch (error) {
            addToast('Failed to delete chat.', 'error');
        }
    };

    const handleStopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            isSendingRef.current = false;
            setIsLoading(false);
            addToast("Stopped generating.", "info");
        }
    }, [addToast]);
    
    const handleSendMessage = useCallback(async (
        text: string, 
        files: File[] | null = null, 
        chatToUse: ChatWithProjectData | null = activeChat,
        thinkingModeOrOverride: 'instant' | 'fast' | 'think' | 'deep' | string = 'fast',
        onProjectFileUpdate?: (path: string, content: string, isComplete: boolean) => void
    ): Promise<AgentExecutionResult> => {
      
      const isInstantMode = thinkingModeOrOverride === 'instant' || isGuest;
      const effectiveMode = isGuest ? 'instant' : thinkingModeOrOverride;

      // Handle custom model override string
      const modelOverride = typeof thinkingModeOrOverride === 'string' && !['instant', 'fast', 'think', 'deep'].includes(thinkingModeOrOverride) ? thinkingModeOrOverride : undefined;

      if ((!text.trim() && (!files || files.length === 0)) || (!user && !isGuest) || !chatToUse) return { messages: [] };
      if (!isInstantMode && !geminiApiKey) return { messages: [] };
      
      if (isSendingRef.current) return { messages: [] };
      isSendingRef.current = true;
      setIsLoading(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const safetyTimeout = setTimeout(() => {
          if (isSendingRef.current && !abortController.signal.aborted) {
              console.warn("Safety timeout triggered: Stream took too long.");
              abortController.abort();
              isSendingRef.current = false;
              if (isMountedRef.current) setIsLoading(false);
              addToast("Response timed out.", "error");
          }
      }, 60000);

      const tempId = `temp-ai-${Date.now()}`;
      const tempUserMsgId = `temp-user-${Date.now()}`;
      let currentText = '';

      try {
        let processedPrompt = text;
        const attachments: Attachment[] = [];
        const agentFiles: File[] = [];

        if (files && files.length > 0) {
            for (const file of files) {
                const mimeType = file.type;
                const fileName = file.name.toLowerCase();
                if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(fileName)) {
                    const b64 = await fileToBase64(file);
                    attachments.push({ type: mimeType || 'image/jpeg', data: b64, name: file.name });
                    agentFiles.push(file); 
                } else {
                    attachments.push({ type: 'application/octet-stream', data: '', name: file.name });
                    agentFiles.push(file); // Ensure all files are passed to agent
                }
            }
        }

        const displayText = text.trim() === '' && files && files.length > 0 ? "" : text;

        const userMessageData: Omit<Message, 'id' | 'created_at'> = {
          project_id: chatToUse.project_id,
          chat_id: chatToUse.id,
          user_id: user ? user.id : 'guest', 
          text: displayText, 
          sender: 'user',
        };

        if (attachments.length > 0) {
            userMessageData.image_base64 = JSON.stringify(attachments);
        }
        
        const optimisticUserMessage: Message = { ...userMessageData, id: tempUserMsgId, created_at: new Date().toISOString() };
        const tempAiMessage: Message = { id: tempId, project_id: chatToUse.project_id, chat_id: chatToUse.id, text: '', sender: 'ai' };
        
        if (isMountedRef.current && activeChatIdRef.current === chatToUse.id) {
            setMessages(prev => [...prev, optimisticUserMessage, tempAiMessage]);
        }
        
        try {
            if (isGuest) {
                await localChatService.addMessage(userMessageData);
            } else if (supabase) {
                await addMessage(supabase, userMessageData);
            }
        } catch (dbError) {
             console.error("Failed to save user message:", dbError);
        }

        const isGenericName = chatToUse.name === NEW_CHAT_NAME || chatToUse.name.startsWith("New Chat") || chatToUse.name === text.trim();
        if (isGenericName && text.trim()) {
            generateChatTitle(text.trim(), "", geminiApiKey).then(newTitle => {
                if (newTitle && newTitle !== "New Chat") {
                    handleUpdateChat(chatToUse.id, { name: newTitle });
                }
            }).catch(e => console.warn("Background title gen failed", e));
        }

        const agentHistory = messages.map(m => m);
        
        const onStreamChunk = (chunk: string) => {
            if (abortController.signal.aborted) return;
            clearTimeout(safetyTimeout);
            // Strictly check if we are still on the same chat
            if (!isMountedRef.current || activeChatIdRef.current !== chatToUse.id) return; 

            currentText += chunk;
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text: currentText } : m));
        };

        const projectForAgent = chatToUse.projects ?? { ...DUMMY_AUTONOMOUS_PROJECT, user_id: user ? user.id : 'guest' };
        
        // Priority: 1. Explicit Model Override, 2. Profile Code/Chat Preference, 3. Default
        let modelToUse = 'gemini-2.5-flash';
        if (modelOverride) {
            modelToUse = modelOverride;
        } else if (!isGuest && profile) {
             modelToUse = (workspaceMode === 'cocreator' ? (profile.preferred_code_model || profile.preferred_chat_model) : profile.preferred_chat_model) || 'gemini-2.5-flash';
        }

        const agentResult = await runAgent({
            prompt: processedPrompt, 
            files: agentFiles, 
            apiKey: geminiApiKey || '', 
            model: modelToUse,
            project: projectForAgent, 
            chat: chatToUse, 
            user: user || { id: 'guest', email: 'guest', app_metadata: {}, user_metadata: {}, aud: 'guest', created_at: '' } as any, 
            profile: profile || null, 
            supabase: supabase as any, 
            history: agentHistory, 
            onStreamChunk, 
            onFileUpdate: onProjectFileUpdate,
            workspaceMode,
            thinkingMode: effectiveMode as any,
            signal: abortController.signal
        });
        
        if (abortController.signal.aborted) {
             return { messages: [] };
        }

        const { messages: agentMessages, updatedPlan } = agentResult;
        
        const savedAiMessages: Message[] = [];
        let finalAiText = "";

        for (const messageContent of agentMessages) {
            const finalContent = messageContent.text || currentText; 
            finalAiText += finalContent + " ";
            try {
                let savedAiMessage: Message;
                const aiData = { 
                    ...messageContent, 
                    text: finalContent, 
                    project_id: chatToUse.project_id,
                    model: isGuest ? 'Instant (Free)' : modelToUse 
                };

                if (isGuest) {
                    savedAiMessage = await localChatService.addMessage(aiData);
                } else if (supabase) {
                    savedAiMessage = await addMessage(supabase, aiData);
                } else {
                    throw new Error("No storage backend available");
                }
                savedAiMessages.push(savedAiMessage);
            } catch (aiDbError) {
                console.error("Failed to save AI message:", aiDbError);
                savedAiMessages.push({ ...messageContent, id: `failed-${Date.now()}`, text: finalContent, created_at: new Date().toISOString() } as Message);
                addToast("Failed to save AI response history.", "error");
            }
        }
        
        if (supabase && (user || isGuest)) {
            const userId = user ? user.id : 'guest';
            extractAndSaveMemory(supabase, userId, text, finalAiText, chatToUse.project_id, geminiApiKey);
        }
        
        if (isMountedRef.current && activeChatIdRef.current === chatToUse.id) {
            setMessages(prev => {
                const newMessages = [...prev];
                const tempMessageIndex = newMessages.findIndex(m => m.id === tempId);
                
                if (tempMessageIndex !== -1) {
                    if (savedAiMessages.length > 0) {
                        newMessages.splice(tempMessageIndex, 1, ...savedAiMessages);
                    } else {
                        newMessages.splice(tempMessageIndex, 1);
                    }
                } else {
                     newMessages.push(...savedAiMessages);
                }
                
                if (updatedPlan) {
                    return newMessages.map(m => m.id === updatedPlan.messageId ? { ...m, plan: updatedPlan.plan } : m);
                }
                return newMessages;
            });
        }

        if (updatedPlan && !isGuest && supabase) await updateMessagePlan(supabase, updatedPlan.messageId, updatedPlan.plan);
        return agentResult;

      } catch (e: any) {
        if (abortController.signal.aborted || e.name === 'AbortError') {
             return { messages: [] };
        }
        const errorMessage = e?.message || "An unknown error occurred.";
        console.error("Message execution failed:", e);
        addToast(`Error: ${errorMessage}`, "error");
        
        if (isMountedRef.current && activeChatIdRef.current === chatToUse.id) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text: `⚠️ I encountered an error: ${errorMessage}`, sender: 'ai' } : m));
        }
        return { messages: [] };
      } finally {
        clearTimeout(safetyTimeout);
        isSendingRef.current = false;
        if (isMountedRef.current) setIsLoading(false);
      }
    }, [activeChat, supabase, user, geminiApiKey, messages, addToast, profile, workspaceMode, handleUpdateChat, isGuest]);
    
    return {
        allChats, setAllChats, activeChat, setActiveChat, messages, setMessages,
        isLoading, isCreatingChat, setIsCreatingChat, activeProject,
        handleUpdateChat, handleSelectChat, handleDeleteChat, handleSendMessage, handleStopGeneration
    };
};
