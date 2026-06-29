import fs from 'fs';

// If the environment variable is undefined, fallback to the default value
export const REDIS_HOST = process.env.BBB_REDIS_HOST || '127.0.0.1';
export const REDIS_PORT = Number(process.env.BBB_REDIS_PORT) || 6379;
export const SERVER_HOST = process.env.SERVER_HOST || '127.0.0.1';
export const SERVER_PORT = Number(process.env.SERVER_PORT) || 8093;
export const MAX_BODY_SIZE = Number(process.env.MAX_BODY_SIZE) || 10485760; // 10MB
export const BBB_GRAPHQL_DB_HOST = process.env.BBB_GRAPHQL_DB_HOST || '127.0.0.1';
export const BBB_GRAPHQL_DB_PORT = Number(process.env.BBB_GRAPHQL_DB_PORT) || 5432;
export const BBB_GRAPHQL_DB_NAME = process.env.BBB_GRAPHQL_DB_NAME || 'bbb_graphql';
export const BBB_GRAPHQL_DB_USER = process.env.BBB_GRAPHQL_DB_USER || 'bbb_hasura';
export const BBB_GRAPHQL_DB_PASSWORD = process.env.BBB_GRAPHQL_DB_PASSWORD || 'bbb_hasura';
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

const normalizeTranslationProvider = (value: string | undefined): 'azure' | 'tim-ai' => {
    if (value === 'tim-ai') {
        return 'tim-ai';
    }

    if (value && value !== 'azure') {
        console.warn(`[Config] Unsupported translation provider "${value}". Falling back to azure.`);
    }

    return 'azure';
};

const parseNumberConfig = (
    name: string,
    rawValue: string | undefined,
    defaultValue: number,
    options: {
        integer?: boolean;
        min?: number;
        max?: number;
    } = {},
): number => {
    if (rawValue === undefined || rawValue === '') {
        return defaultValue;
    }

    const parsedValue = Number(rawValue);
    const { integer = false, min, max } = options;

    if (!Number.isFinite(parsedValue)) {
        console.warn(`[Config] Invalid numeric value for ${name}: "${rawValue}". Falling back to ${defaultValue}.`);
        return defaultValue;
    }

    if (integer && !Number.isInteger(parsedValue)) {
        console.warn(`[Config] Expected integer value for ${name}: "${rawValue}". Falling back to ${defaultValue}.`);
        return defaultValue;
    }

    if (min !== undefined && parsedValue < min) {
        console.warn(`[Config] Value for ${name} must be >= ${min}. Falling back to ${defaultValue}.`);
        return defaultValue;
    }

    if (max !== undefined && parsedValue > max) {
        console.warn(`[Config] Value for ${name} must be <= ${max}. Falling back to ${defaultValue}.`);
        return defaultValue;
    }

    return parsedValue;
};

if (Object.keys(bbbProperties).length > 0) {
    console.info(`[Config] Loaded ${Object.keys(bbbProperties).length} properties from ${PROPERTIES_FILE}`);
} else {
    console.warn(`[Config] No properties loaded from ${PROPERTIES_FILE}. Ensure the file exists and is readable.`);
}

console.info(
    `[Config] BBB GraphQL DB bootstrap: host=${BBB_GRAPHQL_DB_HOST} port=${BBB_GRAPHQL_DB_PORT} `
    + `database=${BBB_GRAPHQL_DB_NAME} user=${BBB_GRAPHQL_DB_USER}`,
);

// Azure Translator Configuration
export const AZURE_TRANSLATOR_ENABLED = process.env.AZURE_TRANSLATOR_ENABLED !== 'false'
    && (bbbProperties['azure.translator.enabled'] !== 'false');

export const AZURE_TRANSLATOR_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT
    || bbbProperties['azure.translator.endpoint']
    || '';

export const AZURE_TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY
    || bbbProperties['azure.translator.key']
    || '';

export const TRANSLATION_PROVIDER = normalizeTranslationProvider(
    process.env.TRANSLATION_PROVIDER
    || bbbProperties['translation.provider']
    || 'azure'
);

console.info(`[Config] Translation provider: ${TRANSLATION_PROVIDER}`);

if (AZURE_TRANSLATOR_ENABLED) {
    console.info('[Config] Azure Translator enabled.');
    if (TRANSLATION_PROVIDER === 'azure') {
        if (!AZURE_TRANSLATOR_ENDPOINT) console.warn('[Config] Azure Translator endpoint is missing.');
        if (!AZURE_TRANSLATOR_KEY) console.warn('[Config] Azure Translator key is missing.');
    }
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

// Tim AI (OmniVoice) TTS (Text-to-Speech) Configuration
export const TIMAI_TTS_ENABLED = process.env.TIMAI_TTS_ENABLED !== 'false'
    && (bbbProperties['timai.tts.enabled'] !== 'false');

export const TIMAI_TTS_URL = process.env.TIMAI_TTS_URL
    || bbbProperties['timai.tts.url']
    || 'http://localhost:8000/api/v1/tts';

if (TIMAI_TTS_ENABLED) {
    console.info('[Config] Tim AI TTS enabled.');
    console.info(`[Config] Tim AI TTS URL: ${TIMAI_TTS_URL}`);
} else {
    console.info('[Config] Tim AI TTS is disabled.');
}

// Tim AI (OmniVoice) STT (Speech-to-Text) Configuration
export const TIMAI_STT_ENABLED = process.env.TIMAI_STT_ENABLED !== 'false'
    && (bbbProperties['timai.stt.enabled'] !== 'false');

export const TIMAI_STT_URL = process.env.TIMAI_STT_URL
    || bbbProperties['timai.stt.url']
    || 'ws://localhost:8000/api/v1/stt-stream';

export const TIMAI_STT_ENERGY_THRESHOLD = parseNumberConfig(
    'timai.stt.energyThreshold',
    process.env.TIMAI_STT_ENERGY_THRESHOLD || bbbProperties['timai.stt.energyThreshold'],
    0.01,
    { min: 0 },
);

export const TIMAI_STT_MIN_CHUNK_MS = parseNumberConfig(
    'timai.stt.minChunkMs',
    process.env.TIMAI_STT_MIN_CHUNK_MS || bbbProperties['timai.stt.minChunkMs'],
    500,
    { integer: true, min: 0 },
);

export const TIMAI_STT_MIN_VOICED_MS = parseNumberConfig(
    'timai.stt.minVoicedMs',
    process.env.TIMAI_STT_MIN_VOICED_MS || bbbProperties['timai.stt.minVoicedMs'],
    400,
    { integer: true, min: 0 },
);

export const TIMAI_STT_DUPLICATE_WINDOW_MS = parseNumberConfig(
    'timai.stt.duplicateWindowMs',
    process.env.TIMAI_STT_DUPLICATE_WINDOW_MS || bbbProperties['timai.stt.duplicateWindowMs'],
    6000,
    { integer: true, min: 0 },
);

export const TIMAI_STT_DUPLICATE_MAX_WORDS = parseNumberConfig(
    'timai.stt.duplicateMaxWords',
    process.env.TIMAI_STT_DUPLICATE_MAX_WORDS || bbbProperties['timai.stt.duplicateMaxWords'],
    4,
    { integer: true, min: 0 },
);

export const TIMAI_STT_CHUNK_DURATION_MS = parseNumberConfig(
    'timai.stt.chunkDurationMs',
    process.env.TIMAI_STT_CHUNK_DURATION_MS || bbbProperties['timai.stt.chunkDurationMs'],
    2000,
    { integer: true, min: 100 },
);

export const TIMAI_STT_INTERIM_INTERVAL_MS = parseNumberConfig(
    'timai.stt.interimIntervalMs',
    process.env.TIMAI_STT_INTERIM_INTERVAL_MS || bbbProperties['timai.stt.interimIntervalMs'],
    500,
    { integer: true, min: 100 },
);

export const TIMAI_STT_REPETITION_THRESHOLD = parseNumberConfig(
    'timai.stt.repetitionThreshold',
    process.env.TIMAI_STT_REPETITION_THRESHOLD || bbbProperties['timai.stt.repetitionThreshold'],
    0.6,
    { min: 0, max: 1 },
);

if (TIMAI_STT_ENABLED) {
    console.info('[Config] Tim AI STT enabled.');
    console.info(`[Config] Tim AI STT URL: ${TIMAI_STT_URL}`);
    console.info(
        `[Config] Tim AI STT gating: energyThreshold=${TIMAI_STT_ENERGY_THRESHOLD}, `
        + `minChunkMs=${TIMAI_STT_MIN_CHUNK_MS}, minVoicedMs=${TIMAI_STT_MIN_VOICED_MS}`,
    );
    console.info(
        `[Config] Tim AI STT duplicate suppression: duplicateWindowMs=${TIMAI_STT_DUPLICATE_WINDOW_MS}, `
        + `duplicateMaxWords=${TIMAI_STT_DUPLICATE_MAX_WORDS}`,
    );
    console.info(
        `[Config] Tim AI STT streaming: chunkDurationMs=${TIMAI_STT_CHUNK_DURATION_MS}, `
        + `interimIntervalMs=${TIMAI_STT_INTERIM_INTERVAL_MS}`,
    );
} else {
    console.info('[Config] Tim AI STT is disabled.');
}

// Tim AI (OmniVoice) Translation Configuration
export const TIMAI_TRANSLATE_ENABLED = process.env.TIMAI_TRANSLATE_ENABLED !== 'false'
    && (bbbProperties['timai.translate.enabled'] !== 'false');

export const TIMAI_TRANSLATE_URL = process.env.TIMAI_TRANSLATE_URL
    || bbbProperties['timai.translate.url']
    || 'ws://localhost:8000/api/v1/translate-stream';

if (TIMAI_TRANSLATE_ENABLED) {
    console.info('[Config] Tim AI translation enabled.');
    if (TRANSLATION_PROVIDER === 'tim-ai') {
        console.info(`[Config] Tim AI translation URL: ${TIMAI_TRANSLATE_URL}`);
    }
} else {
    console.info('[Config] Tim AI translation is disabled.');
}
