import { SupabaseClient } from '@supabase/supabase-js';
import { Project, Message, Plan, ProjectPlatform, Profile, Chat, ChatMode, Memory, ProjectType, MemoryLayer, AppSettings, ChatWithProjectData } from '../types';
import { GoogleGenAI, Type } from "@google/genai";

// Helper to extract a clean error message from various error formats.
const getErrorMessage = (error: any): string => {
    if (!error) {
        return "An unknown error occurred.";
    }
    if (typeof error === 'string') {
        return error;
    }
    // Prioritize standard error message property
    if (error && typeof error.message === 'string' && error.message.trim() !== '') {
        return error.message;
    }
    // Handle Supabase/PostgREST specific error shapes
    if (error && typeof error.details === 'string' && error.details.trim() !== '') {
        return error.details;
    }
    if (error && typeof error.error_description === 'string' && error.error_description.trim() !== '') {
        return error.error_description;
    }
    if (error && typeof error.hint === 'string' && error.hint.trim() !== '') {
        return error.hint;
    }
    // Fallback to stringifying the whole object safely
    try {
        const str = JSON.stringify(error);
        if (str !== '{}') {
            return str;
        }
    } catch (e) {
        return "A non-serializable error object was thrown. Check the developer console for details.";
    }
    return "An unknown error occurred. The error object could not be stringified.";
};


// Centralized error handler for Supabase calls to provide better user feedback.
const handleSupabaseError = (error: any, context: string): never => {
    console.error(`${context}:`, error); // Log the full error object for debugging.

    const message = getErrorMessage(error);

    // Specific check for schema cache errors, which are often transient.
    if (message.includes('schema cache')) {
        throw new Error(`There was a problem syncing with the database schema. A page refresh usually fixes this. Please refresh and try again.`);
    }
    
    // Check for common network-related fetch errors that manifest differently in browsers.
    if (message.includes('fetch') || message.includes('Load failed') || message.includes('NetworkError')) {
        throw new Error(`Network error: Could not connect to the database. Please check your internet connection and disable any ad-blockers.`);
    }
    
    // Throw a new error with a cleaner message for other database issues.
    throw new Error(`Database operation failed in ${context.toLowerCase()}. Reason: ${message}`);
};

// === App Settings ===
export const getAppSettings = async (supabase: SupabaseClient): Promise<AppSettings> => {
    const { data, error } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 1)
        .single();

    if (error) handleSupabaseError(error, 'Error fetching app settings');
    return data;
};

export const updateAppSettings = async (supabase: SupabaseClient, updates: Partial<Omit<AppSettings, 'id' | 'updated_at'>>): Promise<AppSettings> => {
    const { data, error } = await supabase
        .from('app_settings')
        .update(updates)
        .eq('id', 1)
        .select()
        .single();
    
    if (error) handleSupabaseError(error, 'Error updating app settings');
    return data;
};

// === Projects ===

export const getProjects = async (supabase: SupabaseClient, userId: string): Promise<Project[]> => {
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

    if (error) handleSupabaseError(error, 'Error fetching projects');
    return data || [];
};

export const getAllProjects = async (supabase: SupabaseClient): Promise<Project[]> => {
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) handleSupabaseError(error, 'Error fetching all projects for admin');
    return data || [];
};

export const createProject = async (supabase: SupabaseClient, userId: string, name: string, platform: ProjectPlatform, projectType: ProjectType, description?: string): Promise<Project> => {
    const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .insert({ 
            user_id: userId,
            name,
            platform,
            description: description || 'Newly created project.',
            status: 'In Progress',
            default_model: 'gemini-2.5-flash',
            project_type: projectType,
        })
        .select()
        .single();
    
    if (projectError) handleSupabaseError(projectError, 'Error creating project');
    return projectData;
}

export const updateProject = async (supabase: SupabaseClient, projectId: string, updates: Partial<Project>): Promise<Project> => {
    const { data, error } = await supabase
        .from('projects')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', projectId)
        .select()
        .single();

    if (error) handleSupabaseError(error, 'Error updating project');
    return data;
};

export const deleteProject = async (supabase: SupabaseClient, projectId: string): Promise<void> => {
    const { data: chats, error: chatsError } = await supabase
        .from('chats')
        .select('id')
        .eq('project_id', projectId);

    if (chatsError) handleSupabaseError(chatsError, 'Error fetching chats for project deletion');

    if (chats && chats.length > 0) {
        const chatIds = chats.map(c => c.id);

        const { error: messagesError } = await supabase
            .from('messages')
            .delete()
            .in('chat_id', chatIds);

        if (messagesError) handleSupabaseError(messagesError, 'Error deleting messages for project deletion');
        
        const { error: deleteChatsError } = await supabase
            .from('chats')
            .delete()
            .eq('project_id', projectId);

        if (deleteChatsError) handleSupabaseError(deleteChatsError, 'Error deleting chats for project deletion');
    }

    const { error: projectError } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);

    if (projectError) handleSupabaseError(projectError, 'Error deleting project');
};


// === Chats ===

export const getAllChatsForUser = async (supabase: SupabaseClient, userId: string): Promise<ChatWithProjectData[]> => {
    const { data, error } = await supabase
        .from('chats')
        .select('*, projects(*)') 
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

    if (error) handleSupabaseError(error, 'Error fetching all user chats with projects');
    return (data as ChatWithProjectData[]) || [];
};


export const getChatsForProject = async (supabase: SupabaseClient, projectId: string): Promise<Chat[]> => {
    const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

    if (error) handleSupabaseError(error, 'Error fetching chats for project');
    return data || [];
};

export const createChat = async (supabase: SupabaseClient, userId: string, name: string, mode: ChatMode, projectId?: string | null): Promise<Chat> => {
    const { data, error } = await supabase
        .from('chats')
        .insert({
            project_id: projectId,
            user_id: userId,
            name: name,
            mode: mode,
            updated_at: new Date().toISOString(),
        })
        .select()
        .single();
    
    if (error) handleSupabaseError(error, 'Error creating chat');
    return data;
};

export const updateChat = async (supabase: SupabaseClient, chatId: string, updates: Partial<Chat>): Promise<Chat> => {
    const { data, error } = await supabase
        .from('chats')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', chatId)
        .select()
        .single();
    
    if (error) handleSupabaseError(error, 'Error updating chat');
    return data;
};

export const deleteChat = async (supabase: SupabaseClient, chatId: string): Promise<void> => {
    const { error } = await supabase
        .from('chats')
        .delete()
        .eq('id', chatId);
    if (error) handleSupabaseError(error, 'Error deleting chat');
};


// === Profiles ===

export const createProfile = async (supabase: SupabaseClient, userId: string, displayName: string, avatarUrl: string): Promise<Profile> => {
    const { data, error } = await supabase
        .from('profiles')
        .upsert({
            id: userId,
            roblox_username: displayName, 
            avatar_url: avatarUrl,
            roblox_id: userId, 
        })
        .select()
        .single();

    if (error) handleSupabaseError(error, 'Error creating profile');
    return data;
};

export const getUserProfile = async (supabase: SupabaseClient, userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) handleSupabaseError(error, 'Error fetching user profile');
    return data;
};

export const updateProfile = async (supabase: SupabaseClient, userId: string, updates: Partial<Profile>): Promise<Profile> => {
    const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

    if (error) handleSupabaseError(error, 'Error updating profile');
    return data;
};

export const deductUserCredits = async (supabase: SupabaseClient, userId: string, amount: number): Promise<Profile> => {
    const { data, error } = await supabase.rpc('deduct_credits', { p_user_id: userId, p_amount: amount });
    if (error) handleSupabaseError(error, 'Error deducting credits');
    const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (profileError) handleSupabaseError(profileError, 'Error fetching profile after credit deduction');
    return profile;
}


export const getAllProfiles = async (supabase: SupabaseClient): Promise<Profile[]> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('roblox_username', { ascending: true });
        
    if (error) handleSupabaseError(error, 'Error fetching all profiles for admin');
    return data || [];
};

export const updateProfileForAdmin = async (supabase: SupabaseClient, userId: string, updates: Partial<Profile>): Promise<Profile> => {
    const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

    if (error) handleSupabaseError(error, 'Error updating profile for admin');
    return data;
};

export const deleteUser = async (supabase: SupabaseClient, userId: string): Promise<void> => {
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) handleSupabaseError(error, 'Error deleting user');
};

export const incrementThinkingCount = async (supabase: SupabaseClient, userId: string): Promise<void> => {
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase.rpc('increment_thinking_count', {
      p_user_id: userId,
      p_date: today
    });
    if (error) {
        console.warn(`Could not increment thinking count for user ${userId}:`, error);
    }
};


// === Messages ===

export const getMessages = async (supabase: SupabaseClient, chatId: string): Promise<Message[]> => {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });

    if (error) handleSupabaseError(error, 'Error fetching messages');
    
    // Map database snake_case back to camelCase for the frontend if needed
    const mappedData = (data || []).map((msg: any) => ({
        ...msg,
        // If the DB has grounding_metadata, allow the frontend to see it as groundingMetadata
        groundingMetadata: msg.grounding_metadata || msg.groundingMetadata
    }));

    return mappedData;
};

export const addMessage = async (supabase: SupabaseClient, message: Omit<Message, 'id' | 'created_at'>): Promise<Message> => {
    const messageToInsert: any = { ...message };
    delete messageToInsert.imageStatus;

    // Map groundingMetadata to grounding_metadata for DB insert
    if (messageToInsert.groundingMetadata !== undefined) {
        messageToInsert.grounding_metadata = messageToInsert.groundingMetadata;
        delete messageToInsert.groundingMetadata;
    }

    const { data, error } = await supabase
        .from('messages')
        .insert(messageToInsert)
        .select()
        .single();
    
    if (error) handleSupabaseError(error, 'Error adding message');
    
    if (data && data.grounding_metadata) {
        data.groundingMetadata = data.grounding_metadata;
    }
    return data;
};

export const updateMessage = async (supabase: SupabaseClient, messageId: string, updates: Partial<Message>): Promise<Message> => {
    const updatesToInsert: any = { ...updates };
    delete updatesToInsert.imageStatus;

    if (updatesToInsert.groundingMetadata !== undefined) {
        updatesToInsert.grounding_metadata = updatesToInsert.groundingMetadata;
        delete updatesToInsert.groundingMetadata;
    }

    const { data, error } = await supabase
        .from('messages')
        .update(updatesToInsert)
        .eq('id', messageId)
        .select()
        .single();
        
    if (error) handleSupabaseError(error, 'Error updating message');
    
    if (data && data.grounding_metadata) {
        data.groundingMetadata = data.grounding_metadata;
    }
    return data;
};

export const deleteMessage = async (supabase: SupabaseClient, messageId: string): Promise<void> => {
    const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId);
    if (error) handleSupabaseError(error, 'Error deleting message');
};

export const updateMessagePlan = async (supabase: SupabaseClient, messageId: string, plan: Plan): Promise<Message> => {
    const { data, error } = await supabase
        .from('messages')
        .update({ plan })
        .eq('id', messageId)
        .select()
        .single();

    if (error) handleSupabaseError(error, 'Error updating message plan');
    return data;
};

export const updateMessageClarification = async (supabase: SupabaseClient, messageId: string, clarification: any): Promise<Message> => {
    const { data, error } = await supabase
        .from('messages')
        .update({ clarification })
        .eq('id', messageId)
        .select()
        .single();
    
    if (error) handleSupabaseError(error, 'Error updating message clarification');
    return data;
};

// === Social ===

export const getFriendships = async (supabase: SupabaseClient, userId: string): Promise<any[]> => {
    const { data: friendships, error } = await supabase
        .from('friendships')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'accepted');

    if (error) handleSupabaseError(error, 'Error fetching friendships');
    if (!friendships || friendships.length === 0) return [];

    const friendIds = friendships.map((f: any) => f.friend_id);
    const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', friendIds);
    
    if (profileError) handleSupabaseError(profileError, 'Error fetching friend profiles');

    return friendships.map((f: any) => ({
        ...f,
        other_user: profiles?.find((p: any) => p.id === f.friend_id) || null
    }));
};

export const getPendingFriendRequests = async (supabase: SupabaseClient, userId: string): Promise<any[]> => {
    const { data: requests, error } = await supabase
        .from('friendships')
        .select('*')
        .eq('friend_id', userId)
        .eq('status', 'pending');

    if (error) handleSupabaseError(error, 'Error fetching pending requests');
    if (!requests || requests.length === 0) return [];

    const senderIds = requests.map((r: any) => r.user_id);
    const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', senderIds);

    if (profileError) handleSupabaseError(profileError, 'Error fetching requester profiles');

    return requests.map((r: any) => ({
        ...r,
        sender: profiles?.find((p: any) => p.id === r.user_id) || null
    }));
};

export const getOutgoingFriendRequests = async (supabase: SupabaseClient, userId: string): Promise<any[]> => {
    const { data, error } = await supabase
        .from('friendships')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending');

    if (error) handleSupabaseError(error, 'Error fetching outgoing requests');
    return data || [];
};

export const sendFriendRequest = async (supabase: SupabaseClient, userId: string, targetId: string): Promise<void> => {
    const { error } = await supabase
        .from('friendships')
        .insert({ user_id: userId, friend_id: targetId, status: 'pending' });
    if (error) handleSupabaseError(error, 'Error sending friend request');
};

export const updateFriendRequest = async (supabase: SupabaseClient, friendshipId: string, status: 'accepted' | 'blocked'): Promise<void> => {
    const { error } = await supabase
        .from('friendships')
        .update({ status })
        .eq('id', friendshipId);
    if (error) handleSupabaseError(error, 'Error updating friend request');
    
    if (status === 'accepted' && !error) {
         const { data: friendship } = await supabase.from('friendships').select('*').eq('id', friendshipId).single();
         if (friendship) {
             const { error: reverseError } = await supabase.from('friendships').insert({
                 user_id: friendship.friend_id,
                 friend_id: friendship.user_id,
                 status: 'accepted'
             });
             // Ignore unique constraint error if relation already exists
             if (reverseError && reverseError.code !== '23505') {
                 console.warn("Could not create reciprocal friendship", reverseError);
             }
         }
    }
};

export const getNotifications = async (supabase: SupabaseClient, userId: string): Promise<any[]> => {
    const { data, error } = await supabase
        .from('notifications')
        .select('*, related_user:related_user_id(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) handleSupabaseError(error, 'Error fetching notifications');
    return data || [];
};

export const searchUsers = async (supabase: SupabaseClient, query: string, currentUserId: string): Promise<Profile[]> => {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', currentUserId)
        .ilike('roblox_username', `%${query}%`)
        .limit(20);

    if (error) handleSupabaseError(error, 'Error searching users');
    return data || [];
};

// === Memories (New AI-Controlled System) ===

export const extractAndSaveMemory = async (supabase: SupabaseClient, userId: string, userText: string, aiText: string, projectId?: string | null, apiKey?: string | null): Promise<void> => {
    let effectiveKey = apiKey;
    if (!effectiveKey) {
        const { data: profileData } = await supabase
            .from('profiles')
            .select('gemini_api_key')
            .eq('id', userId)
            .single();
        effectiveKey = profileData?.gemini_api_key;
    }
    
    if (!effectiveKey) return; 

    const ai = new GoogleGenAI({ apiKey: effectiveKey });

    const instruction = `You are an AI assistant that extracts important facts from a conversation to be saved to a long-term memory system.
Analyze the user's message and the AI's response. Identify any new, significant information that should be remembered.
If you find something to save, format it as a JSON object. If there is nothing to save, return an empty JSON object.

The memory system has 4 layers: 'personal', 'project', 'codebase', 'aesthetic'.

Respond with a JSON object containing a single key "memoriesToCreate", which is an array of memory objects.
Each memory object must have "layer", "key", and "value".
The "key" should be a concise identifier.
The "value" is the information to store.

If nothing needs to be saved, output: { "memoriesToCreate": [] }
`;
    
    const schema = {
        type: Type.OBJECT,
        properties: {
            memoriesToCreate: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        layer: { type: Type.STRING, enum: ['personal', 'project', 'codebase', 'aesthetic'] },
                        key: { type: Type.STRING },
                        value: { type: Type.STRING }
                    },
                    required: ["layer", "key", "value"]
                }
            }
        },
        required: ["memoriesToCreate"]
    };

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `PROJECT_ID: ${projectId || 'N/A'}\nCONVERSATION TURN:\nUser: "${userText}"\nAI: "${aiText}"`,
            config: {
                systemInstruction: instruction,
                responseMimeType: "application/json",
                responseSchema: schema
            }
        });
        
        const result = JSON.parse(response.text);
        
        if (result.memoriesToCreate && result.memoriesToCreate.length > 0) {
            for (const mem of result.memoriesToCreate) {
                await saveMemory(supabase, userId, mem.layer, mem.key, mem.value, projectId);
            }
        }
    } catch (error) {
        console.warn("Failed to extract and save memory (background):", error);
    }
};


export const loadMemoriesForPrompt = async (supabase: SupabaseClient, userId: string, prompt: string, projectId?: string | null): Promise<string> => {
    const { data, error } = await supabase
        .from('memories')
        .select('layer, content, metadata')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
    
    if (error) handleSupabaseError(error, 'Failed to load memories');
    
    if (!data || data.length === 0) {
        return "=== MEMORIES LOADED ===\nNone yet!\n=======================";
    }

    const relevantMemories = data.filter(m => {
        if (m.layer === 'personal' || m.layer === 'aesthetic') return true;
        if (projectId && (m.layer === 'project' || m.layer === 'codebase')) {
            const memoryProjectId = m.metadata?.project_id;
            return memoryProjectId === projectId;
        }
        return false;
    });
    
    let finalMemories = relevantMemories;

    if (relevantMemories.length > 50) {
        const keywords = prompt.toLowerCase().split(/\s+/).filter(word => word.length > 2);
        const scoredMemories = relevantMemories.map(memory => {
            const content = memory.content?.toLowerCase() || '';
            const key = memory.metadata?.memory_key?.toLowerCase() || '';
            let score = 0;
            if (memory.layer === 'personal' || memory.layer === 'aesthetic') score += 100;
            for (const keyword of keywords) {
                if (key.includes(keyword)) score += 5;
                if (content.includes(keyword)) score += 1;
            }
            return { memory, score };
        });
        scoredMemories.sort((a, b) => b.score - a.score);
        finalMemories = scoredMemories.slice(0, 50).map(item => item.memory);
    }
    
    if (finalMemories.length === 0) {
        return "=== MEMORIES LOADED ===\nNone relevant to this context yet.\n=======================";
    }

    const byLayer: Record<string, string[]> = { personal: [], project: [], codebase: [], aesthetic: [] };
    
    finalMemories.forEach(m => {
        const key = m.metadata?.memory_key || m.metadata?.key;
        const value = m.content;
        if (m.layer && key && value) {
           byLayer[m.layer as MemoryLayer]?.push(`[${key}]\n${value}`);
        }
    });
    
    return `
=== MEMORIES LOADED ===
PERSONAL:
${byLayer.personal.join('\n\n') || 'None'}
PROJECT:
${byLayer.project.join('\n\n') || 'None'}
CODEBASE:
${byLayer.codebase.join('\n\n') || 'None'}
AESTHETIC:
${byLayer.aesthetic.join('\n\n') || 'None'}
========================
    `.trim();
};

function validateMemoryLength(key: string, content: string): { valid: boolean; warning?: string } {
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
    if (paragraphs.length > 2) return { valid: false, warning: `Memory "${key}" is too long (>2 paragraphs).` };
    if (content.length > 2000) return { valid: false, warning: `Memory "${key}" exceeds 2000 chars.` };
    return { valid: true };
}

export const saveMemory = async (supabase: SupabaseClient, userId: string, layer: MemoryLayer, key: string, value: string, projectId?: string | null): Promise<Memory> => {
    const validation = validateMemoryLength(key, value);
    if (!validation.valid) console.warn(`Memory validation warning: ${validation.warning}`);

    const { data: existing, error: findError } = await supabase
        .from('memories')
        .select('id')
        .eq('user_id', userId)
        .eq('layer', layer)
        .eq('metadata->>memory_key', key)
        .limit(1);

    if (findError) handleSupabaseError(findError, 'Failed to check memory');

    const metadata: any = { memory_key: key };
    if (projectId) metadata.project_id = projectId;

    const memoryPayload = {
        user_id: userId,
        layer,
        content: value,
        metadata: metadata,
        updated_at: new Date().toISOString()
    };

    let savedData;
    if (existing && existing.length > 0) {
        const { data, error } = await supabase
            .from('memories')
            .update(memoryPayload)
            .eq('id', existing[0].id)
            .select()
            .single();
        if (error) handleSupabaseError(error, 'Failed to update memory');
        savedData = data;
    } else {
        const { data, error } = await supabase
            .from('memories')
            .insert(memoryPayload)
            .select()
            .single();
        if (error) handleSupabaseError(error, 'Failed to create memory');
        savedData = data;
    }
    
    return {
        ...savedData,
        key: savedData.metadata?.memory_key || key,
        value: savedData.content || value
    };
};

export const getMemoriesForUser = async (supabase: SupabaseClient, userId: string): Promise<Memory[]> => {
    const { data, error } = await supabase
        .from('memories')
        .select('*')
        .eq('user_id', userId)
        .order('layer')
        .order('updated_at', { ascending: false });
        
    if (error) handleSupabaseError(error, 'Failed to get memories');
    
    return (data || []).map((dbMemory: any) => ({
        ...dbMemory,
        key: dbMemory.metadata?.memory_key || dbMemory.metadata?.key || '[No Key]',
        value: dbMemory.content,
    }));
};

export const updateMemory = async (supabase: SupabaseClient, memoryId: string, updates: Partial<Omit<Memory, 'id' | 'user_id' | 'created_at'>>): Promise<Memory> => {
    const dbUpdates: any = { updated_at: new Date().toISOString() };

    if (updates.layer) dbUpdates.layer = updates.layer;
    if (updates.value) dbUpdates.content = updates.value as string;

    if (updates.key) {
        const { data: existing } = await supabase.from('memories').select('metadata').eq('id', memoryId).single();
        const newMetadata = { ...(existing?.metadata || {}), memory_key: updates.key };
        dbUpdates.metadata = newMetadata;
    }
    
    const { data, error } = await supabase
        .from('memories')
        .update(dbUpdates)
        .eq('id', memoryId)
        .select()
        .single();
    if (error) handleSupabaseError(error, 'Failed to update memory');
    
    return {
        ...data,
        key: data.metadata?.memory_key || '[No Key]',
        value: data.content,
    };
};

export const deleteMemory = async (supabase: SupabaseClient, memoryId: string): Promise<void> => {
    const { error } = await supabase.from('memories').delete().eq('id', memoryId);
    if (error) handleSupabaseError(error, 'Error deleting memory');
};

export type { ChatWithProjectData };
