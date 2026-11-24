import { Tool } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'
import { secureFetch } from '../../../src/httpSecurity'

const defaultName = 'keenable-fetch'
const defaultDesc =
    'Fetches a web page with Keenable and returns its content as clean Markdown. Useful for reading a page found by a search. Input should be a single URL.'
const DEFAULT_BASE_URL = 'https://api.keenable.ai'
const DEFAULT_MAX_CHARS = 10000

interface KeenableFetchResponse {
    error?: { status?: number; message?: string; error?: string }

    url?: string
    title?: string
    content?: string
    truncated?: boolean
}

class KeenableFetch_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Keenable Fetch'
        this.name = 'keenableFetch'
        this.version = 1.0
        this.type = 'KeenableFetch'
        this.icon = 'keenable.svg'
        this.category = 'Tools'
        this.description =
            'Wrapper around the Keenable Fetch API - reads a web page as clean Markdown for AI agents. Works without an API key (keyless free tier).'
        this.inputs = [
            {
                label: 'Max Characters',
                name: 'maxChars',
                type: 'number',
                default: DEFAULT_MAX_CHARS,
                description: 'Maximum number of characters of page content to return to the agent.',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Live',
                name: 'live',
                type: 'boolean',
                default: false,
                description: 'Fetch the live page (`retrieval.max_age_hours: 0`) instead of the indexed copy. Requires an API key.',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Base URL',
                name: 'apiBase',
                type: 'string',
                default: DEFAULT_BASE_URL,
                description: 'Keenable API base URL (HTTPS).',
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Name',
                name: 'toolName',
                type: 'string',
                default: defaultName,
                additionalParams: true,
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'toolDescription',
                type: 'string',
                rows: 4,
                default: defaultDesc,
                additionalParams: true,
                optional: true
            }
        ]
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['keenableApi'],
            optional: true
        }
        this.baseClasses = [this.type, ...getBaseClasses(KeenableFetchTool)]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const apiKey = getCredentialParam('keenableApiKey', credentialData, nodeData) as string
        const maxChars = nodeData.inputs?.maxChars as string

        return new KeenableFetchTool({
            apiKey,
            apiBase: nodeData.inputs?.apiBase as string,
            maxChars: maxChars ? parseInt(maxChars, 10) : undefined,
            live: nodeData.inputs?.live as boolean,
            toolName: nodeData.inputs?.toolName as string,
            toolDescription: nodeData.inputs?.toolDescription as string
        })
    }
}

class KeenableFetchTool extends Tool {
    static lc_name() {
        return 'KeenableFetchTool'
    }

    name = defaultName

    description = defaultDesc

    protected apiKey?: string

    protected apiBase: string = DEFAULT_BASE_URL

    protected maxChars: number = DEFAULT_MAX_CHARS

    protected live: boolean = false

    get lc_secrets(): { [key: string]: string } | undefined {
        return {
            apiKey: 'KEENABLE_API_KEY'
        }
    }

    constructor({
        apiKey,
        apiBase,
        maxChars,
        live,
        toolName,
        toolDescription
    }: {
        apiKey?: string
        apiBase?: string
        maxChars?: number
        live?: boolean
        toolName?: string
        toolDescription?: string
    }) {
        super(...arguments)

        this.apiKey = (apiKey || '').trim() || undefined
        if (apiBase) this.apiBase = apiBase.replace(/\/$/, '')
        if (typeof maxChars === 'number' && !Number.isNaN(maxChars) && maxChars > 0) this.maxChars = maxChars
        this.live = live === true || (live as any) === 'true'

        if (this.live && !this.apiKey) {
            throw new Error('Keenable live fetch requires an API key.')
        }

        if (toolName) this.name = toolName
        if (toolDescription) this.description = toolDescription
    }

    async _call(input: string): Promise<string> {
        const target = (input || '').trim()
        if (!target) return 'No URL given.'

        // Keyless public endpoint by default; keyed endpoint + X-API-Key with a key.
        // POST /v1/fetch: GET is deprecated and sunsets 1 Mar 2027.
        const path = this.apiKey ? '/v1/fetch' : '/v1/fetch/public'
        const body: Record<string, unknown> = {
            urls: [target],
            content: { max_chars: this.maxChars }
        }
        if (this.live) body.retrieval = { max_age_hours: 0 }

        const headers: Record<string, string> = {
            'User-Agent': 'keenable-keelflow',
            'Content-Type': 'application/json',
            // App name, required by the keyless endpoint.
            'X-Keenable-Title': 'Keelflow'
        }
        if (this.apiKey) headers['X-API-Key'] = this.apiKey

        const resp = await secureFetch(`${this.apiBase}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60 * 1000) as any
        })

        if (!resp.ok) {
            throw new Error(`Keenable request failed: ${resp.status} ${resp.statusText}`)
        }

        const envelope = await resp.json()
        const res: KeenableFetchResponse | undefined = Array.isArray(envelope?.results) ? envelope.results[0] : undefined
        if (res?.error) {
            const err = res.error
            throw new Error(err.message || err.error || 'Keenable fetch failed')
        }
        if (!res?.content) return 'No content found.'

        const title = res.title ? `# ${res.title}\n\n` : ''
        return `${title}${res.content}`
    }
}

module.exports = { nodeClass: KeenableFetch_Tools }
