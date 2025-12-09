
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, ExclamationTriangleIcon, CloudArrowDownIcon, CodeBracketIcon, Cog6ToothIcon, ClipboardDocumentCheckIcon, ClipboardDocumentIcon, ArrowPathIcon, CpuChipIcon, PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import { Project, Memory } from '../types';
import { CodeBlock } from '../components/ui/CodeBlock';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { getMemoriesForUser, saveMemory, deleteMemory, updateMemory } from '../services/databaseService';

interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  onSave: (projectId: string, updates: Partial<Project>) => Promise<void>;
  initialTab?: 'general' | 'roblox' | 'memories';
}

const generateRobloxPluginCode = (project: Project, accessToken: string) => {
    const projectId = project.id;
    const projectName = project.name.replace(/"/g, '\\"');
    
    // @ts-ignore
    const supabaseUrl = supabase.supabaseUrl || (supabase as any).restUrl || "";
    // @ts-ignore
    const supabaseKey = supabase.supabaseKey || (supabase as any).anonKey || "";

    return `-- [[ BUBBLE AI SYNC PLUGIN v4.0 ]]
-- AUTHOR: Bubble AI
-- DESCRIPTION: Real-time 2-way sync between Roblox Studio and Bubble AI Web App.

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local RunService = game:GetService("RunService")

-- [[ CONFIGURATION ]]
local PROJECT_ID = "${projectId}"
local API_URL = "${supabaseUrl}/rest/v1/projects?id=eq." .. PROJECT_ID
local API_KEY = "${supabaseKey}"
local ACCESS_TOKEN = "${accessToken}" -- Session token for permissions
local POLLING_INTERVAL = 2 -- Seconds between checks

-- [[ STATE ]]
local isSyncing = false
local lastSyncData = ""
local pluginWidget = nil

-- [[ UI CONSTRUCTION ]]
local toolbar = plugin:CreateToolbar("Bubble AI")
local toggleButton = toolbar:CreateButton("BubbleSync", "Open Sync Manager", "rbxassetid://11397763335")

local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Float,
    true, false, 
    300, 450, 250, 300
)
pluginWidget = plugin:CreateDockWidgetPluginGui("BubbleAI_Manager", widgetInfo)
pluginWidget.Title = "Bubble AI Sync: " .. "${projectName}"

-- Theme Handling
local function getTheme()
    local theme = settings().Studio.Theme
    return {
        bg = theme:GetColor(Enum.StudioStyleGuideColor.MainBackground),
        text = theme:GetColor(Enum.StudioStyleGuideColor.MainText),
        button = theme:GetColor(Enum.StudioStyleGuideColor.Button),
        border = theme:GetColor(Enum.StudioStyleGuideColor.Border),
        success = Color3.fromRGB(100, 255, 100),
        error = Color3.fromRGB(255, 100, 100),
        accent = Color3.fromRGB(0, 162, 255),
        warning = Color3.fromRGB(255, 200, 50)
    }
end

local colors = getTheme()

-- Main Frame
local mainFrame = Instance.new("Frame")
mainFrame.Size = UDim2.fromScale(1, 1)
mainFrame.BackgroundColor3 = colors.bg
mainFrame.Parent = pluginWidget

local listLayout = Instance.new("UIListLayout")
listLayout.Padding = UDim.new(0, 10)
listLayout.SortOrder = Enum.SortOrder.LayoutOrder
listLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
listLayout.Parent = mainFrame

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 10)
padding.PaddingBottom = UDim.new(0, 10)
padding.PaddingLeft = UDim.new(0, 10)
padding.PaddingRight = UDim.new(0, 10)
padding.Parent = mainFrame

-- Helper UI Functions
local function createButton(text, order, callback, color)
    local btn = Instance.new("TextButton")
    btn.Size = UDim2.new(1, 0, 0, 40)
    btn.LayoutOrder = order
    btn.Text = text
    btn.BackgroundColor3 = color or colors.button
    btn.TextColor3 = colors.text
    btn.Font = Enum.Font.GothamBold
    btn.TextSize = 14
    btn.Parent = mainFrame
    
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 6)
    corner.Parent = btn
    
    btn.MouseButton1Click:Connect(callback)
    return btn
end

local function createStatus(order)
    local lbl = Instance.new("TextLabel")
    lbl.Size = UDim2.new(1, 0, 0, 30)
    lbl.LayoutOrder = order
    lbl.BackgroundTransparency = 1
    lbl.Text = "Status: Idle"
    lbl.TextColor3 = colors.text
    lbl.Font = Enum.Font.Gotham
    lbl.TextSize = 12
    lbl.Parent = mainFrame
    return lbl
end

-- [[ LOGIC ]]

local statusLabel = createStatus(0)

-- Service Mapper
local function getServiceAndPath(fullPath)
    local parts = string.split(fullPath, "/")
    local serviceName = parts[1]
    local service = game:GetService("ServerScriptService") 
    
    pcall(function() service = game:GetService(serviceName) end)
    if not service then service = game:GetService("ServerScriptService") end -- Fallback

    -- Strip service name from path if present
    if parts[1] == service.Name then table.remove(parts, 1) end
    return service, parts
end

-- Smart Container Logic
local function getOrCreateContainer(parent, name)
    local existing = parent:FindFirstChild(name)
    if existing then return existing end

    local instanceType = "Folder"
    local isUI = parent:IsA("StarterGui") or parent:IsA("ScreenGui") or parent:IsA("GuiObject")
    
    if isUI then
        if parent:IsA("StarterGui") then instanceType = "ScreenGui"
        elseif string.match(name:lower(), "button") then instanceType = "TextButton"
        elseif string.match(name:lower(), "label") then instanceType = "TextLabel"
        else instanceType = "Frame" end
    end
    
    local newObj = Instance.new(instanceType)
    newObj.Name = name
    newObj.Parent = parent
    
    if isUI and instanceType ~= "ScreenGui" then
        newObj.Size = UDim2.fromOffset(100, 100)
        newObj.Visible = true
        if instanceType == "TextButton" or instanceType == "TextLabel" then
            newObj.Text = name
        end
    end
    
    return newObj
end

-- HTTP Requests
local function fetchProjectData()
    local response = HttpService:RequestAsync({
        Url = API_URL .. "&select=files",
        Method = "GET",
        Headers = {
            ["apikey"] = API_KEY,
            ["Authorization"] = "Bearer " .. ACCESS_TOKEN,
            ["Content-Type"] = "application/json"
        }
    })
    
    if response.Success then
        local data = HttpService:JSONDecode(response.Body)
        if data and data[1] then
            return data[1].files
        end
    else
        warn("Bubble Sync Error: " .. response.StatusCode .. " - " .. response.Body)
    end
    return nil
end

local function pushProjectData(filesPayload)
    local body = HttpService:JSONEncode({ files = filesPayload })
    local response = HttpService:RequestAsync({
        Url = API_URL,
        Method = "PATCH",
        Headers = {
            ["apikey"] = API_KEY,
            ["Authorization"] = "Bearer " .. ACCESS_TOKEN,
            ["Content-Type"] = "application/json",
            ["Prefer"] = "return=minimal"
        },
        Body = body
    })
    return response.Success
end

-- Apply Changes to Studio
local function applyToStudio(files)
    local count = 0
    for path, fileData in pairs(files) do
        local content = fileData.content
        local service, parts = getServiceAndPath(path)
        
        local current = service
        for i = 1, #parts - 1 do
            current = getOrCreateContainer(current, parts[i])
        end
        
        local fileName = parts[#parts]
        -- Clean filename logic
        local cleanName = fileName:gsub("%.server%.lua$", ""):gsub("%.client%.lua$", ""):gsub("%.lua$", "")
        
        local scriptType = "Script"
        if fileName:match("%.client") then scriptType = "LocalScript" 
        elseif fileName:match("Module") then scriptType = "ModuleScript" end
        
        local scriptObj = current:FindFirstChild(cleanName)
        if not scriptObj or not scriptObj:IsA(scriptType) then
            if scriptObj then scriptObj:Destroy() end
            scriptObj = Instance.new(scriptType)
            scriptObj.Name = cleanName
            scriptObj.Parent = current
        end
        
        if scriptObj.Source ~= content then
            scriptObj.Source = content
            count = count + 1
        end
    end
    return count
end

-- Collect Scripts from Studio for PUSH
local function collectScripts()
    local files = {}
    
    local function recurse(parent, pathPrefix)
        for _, child in ipairs(parent:GetChildren()) do
            local currentPath = pathPrefix .. child.Name
            
            if child:IsA("LuaSourceContainer") then
                local ext = ".lua"
                if child:IsA("LocalScript") then ext = ".client.lua"
                elseif child:IsA("ModuleScript") then ext = ".module.lua" -- Use standard module ext if preferred, or just .lua
                elseif child:IsA("Script") then ext = ".server.lua" end
                
                -- Simplify path for Bubble AI readability
                files[currentPath .. ext] = { content = child.Source }
            elseif child:IsA("Folder") or child:IsA("ScreenGui") or child:IsA("Frame") then
                recurse(child, currentPath .. "/")
            end
        end
    end
    
    -- Scan common services
    recurse(game:GetService("ServerScriptService"), "ServerScriptService/")
    recurse(game:GetService("ReplicatedStorage"), "ReplicatedStorage/")
    recurse(game:GetService("StarterPlayer").StarterPlayerScripts, "StarterPlayer/StarterPlayerScripts/")
    recurse(game:GetService("StarterGui"), "StarterGui/")
    
    return files
end

-- [[ BUTTON ACTIONS ]]

local pullBtn = createButton("PULL from Web (Force)", 1, function()
    statusLabel.Text = "Status: Pulling..."
    local files = fetchProjectData()
    if files then
        local changed = applyToStudio(files)
        statusLabel.Text = "Status: Pulled " .. changed .. " files"
        statusLabel.TextColor3 = colors.success
    else
        statusLabel.Text = "Status: Error pulling data"
        statusLabel.TextColor3 = colors.error
    end
end, colors.button)

local syncBtn
syncBtn = createButton("START Live Sync", 2, function()
    isSyncing = not isSyncing
    if isSyncing then
        syncBtn.Text = "STOP Live Sync"
        syncBtn.BackgroundColor3 = colors.error
        statusLabel.Text = "Status: Live Sync Active"
        
        task.spawn(function()
            while isSyncing do
                local files = fetchProjectData()
                if files then
                    local json = HttpService:JSONEncode(files)
                    if json ~= lastSyncData then
                        lastSyncData = json
                        local changed = applyToStudio(files)
                        if changed > 0 then
                            print("🫧 Synced " .. changed .. " changes from Bubble AI")
                        end
                    end
                end
                task.wait(POLLING_INTERVAL)
            end
        end)
    else
        syncBtn.Text = "START Live Sync"
        syncBtn.BackgroundColor3 = colors.accent
        statusLabel.Text = "Status: Idle"
    end
end, colors.accent)

local pushBtn = createButton("PUSH Studio to Web", 3, function()
    statusLabel.Text = "Status: Pushing..."
    local scripts = collectScripts()
    
    -- We need to merge with existing or overwrite? 
    -- For safety, let's fetch existing first to avoid wiping non-script assets if any (though files is usually all code)
    -- For this v1 implementation, we overwrite the 'files' column.
    
    local success = pushProjectData(scripts)
    if success then
        statusLabel.Text = "Status: Pushed Successfully"
        statusLabel.TextColor3 = colors.success
        print("✅ Project pushed to Bubble AI")
    else
        statusLabel.Text = "Status: Push Failed"
        statusLabel.TextColor3 = colors.error
        warn("Failed to push project to Bubble AI")
    end
end, colors.warning)

toggleButton.Click:Connect(function()
    pluginWidget.Enabled = not pluginWidget.Enabled
end)
`;
};

// --- Memory Management Component ---
const ProjectMemoryEditor: React.FC<{ project: Project; userId: string }> = ({ project, userId }) => {
    const [memories, setMemories] = useState<Memory[]>([]);
    const [loading, setLoading] = useState(true);
    const [editMemory, setEditMemory] = useState<Partial<Memory> | null>(null);

    const projectLayers = ['context', 'technical', 'decisions', 'progress'];

    const fetchMemories = async () => {
        setLoading(true);
        try {
            // Fetch all memories for the user, then filter locally for this project
            // Optimization: In a real app, you'd add a 'project_id' filter to the DB query
            const allMemories = await getMemoriesForUser(supabase, userId);
            const filtered = allMemories.filter(m => 
                (projectLayers.includes(m.layer) && m.metadata?.project_id === project.id)
            );
            setMemories(filtered);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMemories();
    }, [project.id]);

    const handleSave = async () => {
        if (!editMemory || !editMemory.layer || !editMemory.key || !editMemory.value) return;
        try {
            if (editMemory.id) {
                // Update
                await updateMemory(supabase, editMemory.id, { 
                    value: editMemory.value, 
                    key: editMemory.key, 
                    layer: editMemory.layer 
                } as any);
            } else {
                // Create - passing project_id as last arg to map to metadata
                await saveMemory(supabase, userId, editMemory.layer as any, editMemory.key, editMemory.value as string, project.id);
            }
            setEditMemory(null);
            fetchMemories();
        } catch(e) {
            console.error("Failed to save memory", e);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure?")) return;
        await deleteMemory(supabase, id);
        fetchMemories();
    };

    if (loading) return <div className="text-gray-500 text-center py-8">Loading memories...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-white">Project Knowledge Base</h3>
                <button 
                    onClick={() => setEditMemory({ layer: 'context', key: '', value: '' })}
                    className="flex items-center gap-2 px-3 py-1.5 bg-primary-start/20 text-primary-start rounded hover:bg-primary-start/30 transition-colors text-sm"
                >
                    <PlusIcon className="w-4 h-4" /> Add Memory
                </button>
            </div>

            {/* Editor Input */}
            {editMemory && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-lg space-y-3">
                    <div className="flex gap-2">
                        <select 
                            value={editMemory.layer}
                            onChange={(e) => setEditMemory(prev => ({ ...prev, layer: e.target.value as any }))}
                            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-sm text-white"
                        >
                            {projectLayers.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                        </select>
                        <input 
                            type="text" 
                            placeholder="Key (e.g. game_genre)" 
                            value={editMemory.key}
                            onChange={(e) => setEditMemory(prev => ({ ...prev, key: e.target.value }))}
                            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-sm text-white flex-1"
                        />
                    </div>
                    <textarea 
                        placeholder="Memory content..." 
                        value={editMemory.value}
                        onChange={(e) => setEditMemory(prev => ({ ...prev, value: e.target.value }))}
                        className="w-full bg-black/30 border border-white/10 rounded p-2 text-sm text-white h-24"
                    />
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setEditMemory(null)} className="text-gray-400 hover:text-white text-sm">Cancel</button>
                        <button onClick={handleSave} className="bg-primary-start text-white px-3 py-1 rounded text-sm hover:bg-primary-start/80">Save</button>
                    </div>
                </div>
            )}

            {/* List */}
            <div className="space-y-2">
                {memories.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No project-specific memories yet.</p>
                ) : (
                    memories.map(m => (
                        <div key={m.id} className="flex justify-between items-start p-3 bg-bg-tertiary rounded border border-white/5 hover:border-white/20 transition-colors group">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                                        m.layer === 'context' ? 'bg-blue-500/20 text-blue-400' :
                                        m.layer === 'technical' ? 'bg-orange-500/20 text-orange-400' :
                                        m.layer === 'decisions' ? 'bg-purple-500/20 text-purple-400' : 'bg-green-500/20 text-green-400'
                                    }`}>
                                        {m.layer}
                                    </span>
                                    <span className="font-mono text-xs text-gray-400">{m.key}</span>
                                </div>
                                <p className="text-sm text-gray-200 line-clamp-2">{m.value}</p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => setEditMemory(m)} className="p-1 text-gray-400 hover:text-white"><PencilIcon className="w-4 h-4" /></button>
                                <button onClick={() => handleDelete(m.id)} className="p-1 text-gray-400 hover:text-red-400"><TrashIcon className="w-4 h-4" /></button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};


export const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({ isOpen, onClose, project, onSave, initialTab = 'general' }) => {
  const { session, user } = useAuth(); // Get session to access access_token
  const [activeTab, setActiveTab] = useState<'general' | 'roblox' | 'memories'>('general');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultModel, setDefaultModel] = useState('gemini-2.5-flash');
  const [projectMemory, setProjectMemory] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pluginCode, setPluginCode] = useState('');

  const { isCopied, copy } = useCopyToClipboard(pluginCode);

  useEffect(() => {
    if (isOpen && project) {
      setName(project.name);
      setDescription(project.description);
      setDefaultModel(project.default_model || 'gemini-2.5-flash');
      setProjectMemory(project.project_memory || '');
      setIsSaving(false);
      setError(null);
      setActiveTab(initialTab);
      
      if (project.project_type === 'roblox_game' && session?.access_token) {
          setPluginCode(generateRobloxPluginCode(project, session.access_token));
      }
    }
  }, [isOpen, project, initialTab, session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !name.trim() || isSaving) return;

    setIsSaving(true);
    setError(null);
    try {
      await onSave(project.id, { 
          name: name.trim(), 
          description: description.trim(),
          default_model: defaultModel,
          project_memory: projectMemory.trim(),
      });
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to save settings: ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/50 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="w-full max-w-3xl p-0 bg-bg-secondary/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl relative flex flex-col overflow-hidden max-h-[90vh]"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-bg-tertiary/50">
                <div>
                    <h2 className="text-2xl font-bold text-white">Project Settings</h2>
                    <p className="text-gray-400 text-sm">Manage configuration for '{project?.name}'.</p>
                </div>
                <button onClick={onClose} className="p-2 text-gray-500 hover:text-white transition-colors rounded-full hover:bg-white/10">
                  <XMarkIcon className="w-6 h-6" />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex px-6 border-b border-white/10 bg-white/5">
                <button 
                    onClick={() => setActiveTab('general')}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'general' ? 'border-primary-start text-white' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                    <Cog6ToothIcon className="w-4 h-4" /> General
                </button>
                <button 
                    onClick={() => setActiveTab('memories')}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'memories' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                    <CpuChipIcon className="w-4 h-4" /> Memories
                </button>
                {project?.project_type === 'roblox_game' && (
                    <button 
                        onClick={() => setActiveTab('roblox')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'roblox' ? 'border-[#00a2ff] text-[#00a2ff]' : 'border-transparent text-gray-400 hover:text-white'}`}
                    >
                        <ArrowPathIcon className="w-4 h-4" /> Roblox Sync
                    </button>
                )}
            </div>
            
            {/* Content */}
            <div className="p-8 overflow-y-auto">
                {activeTab === 'general' && (
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div>
                        <label htmlFor="projectName" className="block text-sm font-medium text-gray-300 mb-2">Project Name</label>
                        <input type="text" id="projectName" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-2.5 bg-white/5 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-start text-white" required />
                      </div>
                      <div>
                        <label htmlFor="projectDescription" className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                        <textarea id="projectDescription" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full px-4 py-2.5 bg-white/5 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-start resize-none text-white" />
                      </div>
                       <div>
                        <label htmlFor="projectMemory" className="block text-sm font-medium text-gray-300 mb-2">
                            Quick Context 
                            <span className="text-gray-500 ml-2 font-normal text-xs">(Deprecated: Use 'Memories' tab for structured data)</span>
                        </label>
                        <textarea id="projectMemory" value={projectMemory} onChange={(e) => setProjectMemory(e.target.value)} rows={4} className="w-full font-mono text-xs px-4 py-2.5 bg-white/5 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-start resize-y text-gray-300" />
                      </div>
                       <div className="mb-6">
                            <label htmlFor="defaultModel" className="block text-sm font-medium text-gray-300 mb-2">Default AI Model</label>
                            <select id="defaultModel" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} className="w-full px-4 py-2.5 bg-white/5 border border-white/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-start text-white">
                              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                            </select>
                          </div>
                          {error && <div className="flex items-center gap-2 text-red-400 text-sm"><ExclamationTriangleIcon className="w-5 h-5" /><span>{error}</span></div>}
                          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-white/10">
                            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-lg text-gray-300 hover:bg-white/10 transition-colors">Cancel</button>
                            <button type="submit" className="px-5 py-2.5 rounded-lg bg-primary-start text-white font-medium hover:bg-primary-end transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Changes'}</button>
                          </div>
                    </form>
                )}

                {activeTab === 'memories' && project && user && (
                    <ProjectMemoryEditor project={project} userId={user.id} />
                )}

                {activeTab === 'roblox' && (
                    <div className="space-y-6">
                        <div className="bg-[#00a2ff]/10 border border-[#00a2ff]/20 p-4 rounded-lg flex items-start gap-4">
                            <CloudArrowDownIcon className="w-8 h-8 text-[#00a2ff] flex-shrink-0" />
                            <div>
                                <h3 className="text-white font-bold text-lg">Roblox Studio Plugin v4.0</h3>
                                <p className="text-sm text-gray-400 mt-1">
                                    Use this generated plugin code to sync your project. It includes a <strong>session token</strong> specific to you, allowing secure read/write access.
                                </p>
                                <p className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
                                    <ExclamationTriangleIcon className="w-3 h-3" />
                                    Token expires when you log out. Update code if sync fails.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h4 className="text-white font-semibold mb-3">Setup Instructions</h4>
                                <ol className="list-decimal ml-4 space-y-3 text-sm text-gray-300">
                                    <li>Copy the <strong>Plugin Code</strong> below.</li>
                                    <li>In Roblox Studio, go to the <strong>Plugins</strong> tab and click <strong>Plugin Folder</strong>.</li>
                                    <li>Create a new file named <code>BubbleSync.lua</code> and paste the code into it.</li>
                                    <li>Restart Studio (or reload plugins).</li>
                                    <li>Use the new <strong>BubbleSync</strong> button in your toolbar to connect!</li>
                                </ol>
                            </div>
                            <div className="bg-black/30 p-4 rounded-lg border border-white/10">
                                <h4 className="text-white font-semibold mb-2 text-sm">Plugin Features</h4>
                                <ul className="space-y-2 text-xs text-gray-400">
                                    <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Live Sync (Web to Studio)</li>
                                    <li className="flex items-center gap-2"><span className="text-green-400">✓</span> One-Click Pull</li>
                                    <li className="flex items-center gap-2"><span className="text-green-400">✓</span> <strong>NEW:</strong> Push Studio Scripts to Web</li>
                                    <li className="flex items-center gap-2"><span className="text-green-400">✓</span> Smart UI Creation</li>
                                </ul>
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                                    <CodeBracketIcon className="w-4 h-4" /> 
                                    Plugin Source Code
                                </label>
                                <button 
                                    onClick={copy} 
                                    className="flex items-center gap-1 text-xs text-primary-start hover:text-white bg-primary-start/10 hover:bg-primary-start/30 px-2 py-1 rounded transition-colors"
                                >
                                    {isCopied ? <ClipboardDocumentCheckIcon className="w-3 h-3" /> : <ClipboardDocumentIcon className="w-3 h-3" />}
                                    {isCopied ? 'Copied!' : 'Copy Code'}
                                </button>
                            </div>
                            <CodeBlock code={pluginCode} language="lua" />
                        </div>
                    </div>
                )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
