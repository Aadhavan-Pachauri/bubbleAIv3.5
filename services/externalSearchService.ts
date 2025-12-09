
// services/externalSearchService.ts

export type WebSearchResult = {
    title: string;
    url: string;
    snippet?: string;
    content?: string;
};

const SEARCH_TIMEOUT_MS = 8000; // Increased slightly for better fetch success
const DEFAULT_MCP_ENDPOINT = 'https://mcp-search-public.onrender.com/search'; 

/**
 * Determines if we should trigger the external search pipeline.
 */
export function shouldUseExternalSearch(userMessage: string, modelSupportsSearch: boolean, hasSearchTag: boolean): boolean {
    if (modelSupportsSearch) return false; 

    const lower = userMessage.toLowerCase();
    
    // Expanded keyword list as requested
    const keywordHit =
        lower.includes("search online") ||
        lower.includes("search the web") ||
        lower.includes("browse") ||
        lower.includes("look this up") ||
        lower.includes("check the internet") ||
        lower.includes("check online") ||
        lower.includes("latest") ||
        lower.includes("today") ||
        lower.includes("news") ||
        lower.includes("price") ||
        lower.includes("online result") ||
        lower.includes("on the net") ||
        lower.includes("reference") ||
        lower.includes("inspiration") ||
        lower.includes("find info") ||
        lower.includes("current");

    return keywordHit || hasSearchTag;
}

/**
 * Runs a web search using an MCP-compatible HTTP endpoint.
 * Falls back to a direct DuckDuckGo call if MCP fails.
 */
export async function runMcpWebSearch(query: string, limit: number = 20): Promise<WebSearchResult[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); 

    // Enforce a higher hard cap (25) to allow for 15+ results as requested
    const effectiveLimit = Math.min(limit, 25); 

    try {
        const response = await fetch(`${DEFAULT_MCP_ENDPOINT}?q=${encodeURIComponent(query)}&limit=${effectiveLimit}`, {
            signal: controller.signal
        });

        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
                return data.slice(0, effectiveLimit).map((item: any) => ({
                    title: item.title || 'No Title',
                    url: item.url,
                    snippet: item.snippet || item.body || ''
                }));
            }
        }
        throw new Error("MCP Endpoint unavailable");
    } catch (error) {
        // Fallback: DuckDuckGo
        try {
            console.log(`Fallback search for: ${query}`);
            const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;
            const ddgResponse = await fetch(ddgUrl);
            const ddgData = await ddgResponse.json();
            
            const results: WebSearchResult[] = [];
            
            if (ddgData.AbstractURL) {
                results.push({
                    title: ddgData.Heading || query,
                    url: ddgData.AbstractURL,
                    snippet: ddgData.Abstract
                });
            }
            
            if (ddgData.RelatedTopics) {
                const flattenTopics = (topics: any[]) => {
                    topics.forEach((t: any) => {
                        if (results.length >= effectiveLimit) return;
                        
                        if (t.FirstURL && t.Text) {
                            results.push({
                                title: t.Text.split(' - ')[0] || 'Result',
                                url: t.FirstURL,
                                snippet: t.Text
                            });
                        } else if (t.Topics && Array.isArray(t.Topics)) {
                            flattenTopics(t.Topics);
                        }
                    });
                };
                flattenTopics(ddgData.RelatedTopics);
            }
            
            return results.slice(0, effectiveLimit);
        } catch (fallbackError) {
            console.warn("Search fallback failed:", fallbackError);
            return [];
        }
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function fetchPageContentWithJina(url: string): Promise<string> {
    try {
        const jinaUrl = `https://r.jina.ai/${url}`;
        const response = await fetch(jinaUrl, {
            headers: {
                'X-With-Images-Summary': 'true',
                'X-Retain-Images': 'none'
            }
        });
        
        if (!response.ok) return "";
        return await response.text();
    } catch (error) {
        console.warn(`Jina fetch failed for ${url}`, error);
        return "";
    }
}

export async function fetchContentsForResults(results: WebSearchResult[], limit: number = 20): Promise<WebSearchResult[]> {
    const top = results.slice(0, limit);
    
    const timeoutPromise = new Promise<WebSearchResult[]>((_, reject) => 
        setTimeout(() => reject(new Error("Jina fetch timeout")), SEARCH_TIMEOUT_MS)
    );

    const fetchPromise = Promise.allSettled(
        top.map(async (r) => {
            const content = await fetchPageContentWithJina(r.url);
            return { ...r, content: content.slice(0, 15000) }; // Increased content limit for better context
        })
    ).then(settled => 
        settled
            .filter(s => s.status === "fulfilled")
            .map((s: any) => s.value)
            .filter(r => r.content && r.content.trim().length > 50)
    );

    try {
        return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
        console.warn("Content fetch timed out, returning partial results.");
        return top; // Return just the snippets if fetch fails
    }
}
