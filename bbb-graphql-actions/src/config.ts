import fs from 'fs';

// If the environment variable is undefined, fallback to the default value
export const REDIS_HOST = process.env.BBB_REDIS_HOST || '127.0.0.1';
export const REDIS_PORT = Number(process.env.BBB_REDIS_PORT) || 6379;
export const SERVER_HOST = process.env.SERVER_HOST || '127.0.0.1';
export const SERVER_PORT = Number(process.env.SERVER_PORT) || 8093;
export const MAX_BODY_SIZE = Number(process.env.MAX_BODY_SIZE) || 10485760; // 10MB
export const DEBUG = false;

// Load BigBlueButton properties
const PROPERTIES_FILE = process.env.BBB_PROPERTIES_FILE || '/etc/bigbluebutton/bigbluebutton.properties';

const loadProperties = () => {
    const props: Record<string, string> = {};
    if (fs.existsSync(PROPERTIES_FILE)) {
        try {
            const content = fs.readFileSync(PROPERTIES_FILE, 'utf-8');
            content.split('\n').forEach((line) => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const [key, ...valueParts] = trimmed.split('=');
                    props[key.trim()] = valueParts.join('=').trim();
                }
            });
        } catch (err) {
            console.error(`Error reading properties from ${PROPERTIES_FILE}:`, err);
        }
    }
    return props;
};

const bbbProperties = loadProperties();

if (Object.keys(bbbProperties).length > 0) {
    console.info(`[Config] Loaded ${Object.keys(bbbProperties).length} properties from ${PROPERTIES_FILE}`);
} else {
    console.warn(`[Config] No properties loaded from ${PROPERTIES_FILE}. Ensure the file exists and is readable.`);
}

// Azure Translator Configuration
export const AZURE_TRANSLATOR_ENABLED = process.env.AZURE_TRANSLATOR_ENABLED !== 'false'
    && (bbbProperties['azure.translator.enabled'] !== 'false');

export const AZURE_TRANSLATOR_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT
    || bbbProperties['azure.translator.endpoint']
    || '';

export const AZURE_TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY
    || bbbProperties['azure.translator.key']
    || '';

if (AZURE_TRANSLATOR_ENABLED) {
    console.info('[Config] Azure Translator enabled.');
    if (!AZURE_TRANSLATOR_ENDPOINT) console.warn('[Config] Azure Translator endpoint is missing.');
    if (!AZURE_TRANSLATOR_KEY) console.warn('[Config] Azure Translator key is missing.');
} else {
    console.info('[Config] Azure Translator is disabled.');
}

// Azure TTS (Text-to-Speech) Configuration
export const AZURE_TTS_ENABLED = process.env.AZURE_TTS_ENABLED !== 'false'
    && (bbbProperties['azure.tts.enabled'] !== 'false');

export const AZURE_TTS_ENDPOINT = process.env.AZURE_TTS_ENDPOINT
    || bbbProperties['azure.tts.endpoint']
    || '';

export const AZURE_TTS_KEY = process.env.AZURE_TTS_KEY
    || bbbProperties['azure.tts.key']
    || '';

if (AZURE_TTS_ENABLED) {
    console.info('[Config] Azure TTS enabled.');
    if (!AZURE_TTS_ENDPOINT) console.warn('[Config] Azure TTS endpoint is missing.');
    if (!AZURE_TTS_KEY) console.warn('[Config] Azure TTS key is missing.');
} else {
    console.info('[Config] Azure TTS is disabled.');
}

// Azure STT (Speech-to-Text) Configuration
export const AZURE_STT_ENABLED = process.env.AZURE_STT_ENABLED !== 'false'
    && (bbbProperties['azure.stt.enabled'] !== 'false');

export const AZURE_STT_KEY = process.env.AZURE_STT_KEY
    || bbbProperties['azure.stt.key']
    || '';

export const AZURE_STT_REGION = process.env.AZURE_STT_REGION
    || bbbProperties['azure.stt.region']
    || 'eastus';

if (AZURE_STT_ENABLED) {
    console.info('[Config] Azure STT enabled.');
    if (!AZURE_STT_KEY) console.warn('[Config] Azure STT key is missing.');
    if (!AZURE_STT_REGION) console.warn('[Config] Azure STT region is missing.');
} else {
    console.info('[Config] Azure STT is disabled.');
}
