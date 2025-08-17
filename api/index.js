// RUTA: /api/index.js (Versión CommonJS Completa)

require('dotenv/config');
const express = require('express');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');

// Importamos nuestro fichero database.js con require
const { connectToDatabase } = require('../database.js');

// --- CONFIGURACIÓN ---
const { MONGO_URI, GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!MONGO_URI) throw new Error('MONGO_URI no está definida.');
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está definida.');

const app = express();

// --- INICIALIZACIÓN DE GEMINI ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);


// --- INICIALIZACIÓN DE SUPABASE ---
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
if (!supabase) console.warn("Supabase no configurado, las analíticas están deshabilitadas.");

// --- MIDDLEWARE ---
app.use(cors({
    origin: ['https://buscador.afland.es', 'https://duende-frontend.vercel.app', 'http://localhost:3000', 'https://afland.es'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// --- RUTAS DE LA API ---

app.get('/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({ version: "15.4-ambiguous-search", timestamp: new Date().toISOString() });
});

app.get('/events', async (req, res) => {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    try {
        const db = await connectToDatabase();
        const eventsCollection = db.collection("events");
        const { search, artist, city, country, dateFrom, dateTo, timeframe, preferredOption } = req.query; // Añadimos preferredOption
        let aggregationPipeline = [];

        // --- LISTA DE CIUDADES, PAÍSES Y TÉRMINOS AMBIGUOS ---
        const ciudadesYProvincias = [
            'Sevilla', 'Málaga', 'Granada', 'Cádiz', 'Córdoba', 'Huelva', 'Jaén', 'Almería',
            'Madrid', 'Barcelona', 'Valencia', 'Murcia', 'Alicante', 'Bilbao', 'Zaragoza',
            'Jerez', 'Úbeda', 'Baeza', 'Ronda', 'Estepona', 'Lebrija', 'Morón de la Frontera',
            'Utrera', 'Algeciras', 'Cartagena', 'Logroño', 'Santander', 'Vitoria', 'Pamplona',
            'Vigo', 'A Coruña', 'Oviedo', 'Gijón', 'León', 'Salamanca', 'Valladolid', 'Burgos',
            'Cáceres', 'Badajoz', 'Toledo', 'Cuenca', 'Guadalajara', 'Albacete'
        ];
        const paises = ['Argentina', 'España', 'Francia']; // Expandir lista según el ojeador
        const terminosAmbiguos = {
            'argentina': { type: 'multi', options: ['country', 'artist'] },
            'granaino': { type: 'multi', options: ['city', 'artist'] } // Usar 'city' para el filtro de ciudad
        };

        const matchFilter = {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Se inicializa el filtro de fechas siempre
        matchFilter.date = { $gte: today.toISOString().split('T')[0] };
        matchFilter.name = { $ne: null, $nin: ["", "N/A"] };
        matchFilter.artist = { $ne: null, $nin: ["", "N/A"] };
        matchFilter.time = { $ne: null, $nin: ["", "N/A"] };
        matchFilter.venue = { $ne: null, $nin: ["", "N/A"] };

        // --- Lógica del timeframe movida fuera del bloque 'search' ---
        if (timeframe === 'week' && !dateTo) {
            const nextWeek = new Date(today);
            nextWeek.setDate(today.getDate() + 7);
            matchFilter.date.$lte = nextWeek.toISOString().split('T')[0];
        }

        let isAmbiguous = false;

        if (search) {
            const normalizedSearch = search.trim().toLowerCase();

            if (terminosAmbiguos[normalizedSearch] && !preferredOption) {
                isAmbiguous = true;
                return res.json({
                    isAmbiguous: true,
                    searchTerm: search,
                    options: terminosAmbiguos[normalizedSearch].options
                });
            }

            let searchType = null;
            if (preferredOption) {
                searchType = preferredOption;
            } else if (ciudadesYProvincias.some(cp => cp.toLowerCase() === normalizedSearch)) {
                searchType = 'city';
            } else if (paises.some(p => p.toLowerCase() === normalizedSearch)) {
                searchType = 'country';
            } else {
                searchType = 'text';
            }

            if (searchType === 'city') {
                const locationRegex = new RegExp(search, 'i');
                matchFilter.$or = [{ city: locationRegex }, { provincia: locationRegex }];
            } else if (searchType === 'country') {
                matchFilter.country = { $regex: new RegExp(`^${search}$`, 'i') };
            } else if (searchType === 'artist') {
                aggregationPipeline.push({
                    $search: {
                        index: 'buscador',
                        text: {
                            query: search,
                            path: 'artist',
                            fuzzy: { "maxEdits": 1 }
                        }
                    }
                });
            } else { // 'text'
                aggregationPipeline.push({
                    $search: {
                        index: 'buscador',
                        text: {
                            query: search,
                            path: { 'wildcard': '*' },
                            fuzzy: { "maxEdits": 1 }
                        }
                    }
                });
            }
        }

        // Se añaden los filtros de búsqueda y tiempo al pipeline de agregación
        aggregationPipeline.unshift({ $match: matchFilter });
        aggregationPipeline.push({ $sort: { date: 1 } });

        const events = await eventsCollection.aggregate(aggregationPipeline).toArray();
        res.json({ events, isAmbiguous: false });
    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

app.get('/events/count', async (req, res) => {
    res.setHeader('Cache-control', 'no-store, max-age=0');
    try {
        const db = await connectToDatabase();
        const eventsCollection = db.collection("events");
        const todayString = new Date().toISOString().split('T')[0];
        const count = await eventsCollection.countDocuments({
            date: { $gte: todayString },
            name: { $ne: null, $nin: ["", "N/A"] },
            artist: { $ne: null, $nin: ["", "N/A"] },
            time: { $ne: null, $nin: ["", "N/A"] },
            venue: { $ne: null, $nin: ["", "N/A"] }
        });
        res.json({ total: count });
    } catch (error) {
        console.error("Error al contar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// =========================================================================
// --- NUEVO ENDPOINT INTELIGENTE PARA "PLANEAR NOCHE" ---
// =========================================================================
const nightPlanPromptTemplate = (event) => `
    Eres "Duende", un conocedor local y aficionado al flamenco. 
    Tu tarea es generar una mini-guía para una noche perfecta centrada en un evento de flamenco.
    Sé cercano, usa un lenguaje evocador y estructúralo en secciones con Markdown (usando ## para los títulos).
    EVENTO:
    - Nombre: ${event.name}
    - Artista: ${event.artist}
    - Lugar: ${event.venue}, ${event.city}
    ESTRUCTURA DE LA GUÍA:
    1.  **Un Pellizco de Sabiduría:** Aporta un dato curioso o una anécdota sobre el artista, el lugar o algún palo del flamenco relacionado.
    2.  **Calentando Motores (Antes del Espectáculo):** Recomienda 1 o 2 bares de tapas o restaurantes cercanos al lugar del evento, describiendo el ambiente.
    3.  **El Templo del Duende (El Espectáculo):** Describe brevemente qué se puede esperar del concierto, centrando en la emoción.
    4.  **Para Alargar la Magia (Después del Espectáculo):** Sugiere un lugar cercano para tomar una última copa en un ambiente relajado.
`;

app.post('/generate-night-plan', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const { eventId } = req.body;

    if (!eventId) {
        return res.status(400).json({ error: 'Falta el ID del evento.' });
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // Modelo optimizado para mayor velocidad y menor coste

        const db = await connectToDatabase();
        const eventsCollection = db.collection('events');
        const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });

        if (!event) {
            return res.status(404).json({ error: 'Evento no encontrado.' });
        }

        if (event.nightPlan) {
            console.log(`✅ Devolviendo contenido cacheado para el evento: ${event.name}`);
            return res.status(200).json({ content: event.nightPlan, source: 'cache' });
        }

        console.log(`🔥 Generando nuevo contenido "Planear Noche" para: ${event.name}`);
        const prompt = nightPlanPromptTemplate(event);
        const result = await model.generateContent(prompt);
        const generatedContent = result.response.text();

        await eventsCollection.updateOne(
            { _id: new ObjectId(eventId) },
            { $set: { nightPlan: generatedContent } }
        );
        console.log(`💾 Contenido para "${event.name}" guardado en la base de datos.`);

        return res.status(200).json({ content: generatedContent, source: 'generated' });

    } catch (error) {
        console.error("Error en el endpoint de 'Planear Noche':", error);
        return res.status(500).json({ error: 'Error al generar el contenido.' });
    }
});
// =========================================================================


app.post('/gemini', async (req, res) => {
    const { event } = req.body;
    if (!event) {
        return res.status(400).json({ error: 'Faltan los datos del evento' });
    }
    const prompt = `Actúa como un aficionado al flamenco con 'duende', un guía local apasionado que comparte secretos. Tu tarea es crear un plan detallado y evocador para una noche de flamenco inolvidable en ${event.city} centrada en el espectáculo de ${event.artist} en ${event.venue}.

Quiero que la respuesta siga ESTRICTAMENTE esta estructura de secciones con Markdown:

### Un Pellizco de Sabiduría
Un dato curioso o histórico sobre el artista, el palo flamenco principal del espectáculo o el lugar. Algo que nadie más sabe.

### Calentando Motores: Antes del Espectáculo
Recomienda 1-2 bares de tapas o bodegas cercanas al lugar. Para cada uno, indica el ambiente y un rango de precio estimado usando €, €€ o €€€.

### El Templo del Duende: El Espectáculo
Describe brevemente el estilo del artista (${event.artist}). **Usa la descripción del evento ('${event.description}') para identificar si es cantaor, bailaor, guitarrista, etc., y menciónalo**. Describe también qué se puede esperar del ambiente del tablao (${event.venue}).

### Para Alargar la Magia: Después del Espectáculo
Sugiere un lugar cercano para tomar una última copa, explicando por qué encaja con la atmósfera de la noche.

### Consejos Prácticos
Una lista corta con 2-3 consejos útiles: ¿Necesita reserva? ¿Código de vestimenta? ¿Mejor forma de llegar?

Para cada lugar recomendado, envuelve su nombre entre corchetes: [Nombre del Lugar].
Usa un tono cercano, poético y apasionado. Asegúrate de que los párrafos no sean demasiado largos para facilitar la lectura en móvil.`;

    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
        const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!geminiResponse.ok) {
            console.error('Error desde la API de Gemini:', await geminiResponse.text());
            return res.status(geminiResponse.status).json({ error: 'Error al contactar la API de Gemini' });
        }
        const data = await geminiResponse.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        res.status(200).json({ text: text });
    } catch (error) {
        console.error('Error interno del servidor en la ruta /gemini:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.post('/trip-planner', async (req, res) => {
    const { destination, startDate, endDate } = req.body;

    if (!destination || !startDate || !endDate) {
        return res.status(400).json({ error: 'Faltan datos para el plan de viaje.' });
    }

    try {
        const db = await connectToDatabase();
        const eventsCollection = db.collection("events");
        const filter = {
            city: { $regex: new RegExp(destination, 'i') },
            date: { $gte: startDate, $lte: endDate }
        };
        const events = await eventsCollection.find(filter).sort({ date: 1 }).toArray();

        if (events.length === 0) {
            return res.json({ text: "¡Qué pena! No se han encontrado eventos de flamenco para estas fechas y destino. Te sugiero probar con otro rango de fechas o explorar peñas flamencas y tablaos locales en la ciudad." });
        }

        const eventList = events.map(ev => `- ${new Date(ev.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })}: "${ev.name}" con ${ev.artist} en ${ev.venue}.`).join('\n');

        const tripPrompt = `Actúa como el mejor planificador de viajes de flamenco de Andalucía. Eres amigable, experto y apasionado. Un viajero quiere visitar ${destination} desde el ${startDate} hasta el ${endDate}. Su lista de espectáculos disponibles es:
${eventList}

Tu tarea es crear un itinerario detallado y profesional. Sigue ESTRICTAMENTE estas reglas:

1.  **Estructura por Días:** Organiza el plan por día.
2.  **Títulos Temáticos:** Dale a cada día un título temático y evocador (ej. "Martes: Inmersión en el Sacromonte", "Miércoles: Noche de Cante Jondo").
3.  **Días con Eventos:** Haz que el espectáculo de la lista sea el punto culminante del día, sugiriendo actividades que lo complementen.
4.  **Días Libres:** Para los días sin espectáculos, ofrece dos alternativas claras: un "Plan A" (una actividad cultural principal como visitar un museo, un barrio emblemático o una tienda de guitarras) y un "Plan B" (una opción más relajada o diferente, como una clase de compás o un lugar con vistas para relajarse).
5.  **Glosario Final:** Al final de todo el itinerario, incluye una sección \`### Glosario Flamenco para el Viajero\` donde expliques brevemente 2-3 términos clave que hayas usado (ej. peña, tablao, duende, tercio).

Usa un tono inspirador y práctico. Sigue envolviendo los nombres de lugares recomendados entre corchetes: [Nombre del Lugar].`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
        const payload = { contents: [{ role: "user", parts: [{ text: tripPrompt }] }] };
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            throw new Error('La IA no pudo generar el plan de viaje.');
        }

        const data = await geminiResponse.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        res.status(200).json({ text: text });

    } catch (error) {
        console.error("Error en el planificador de viajes:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});


app.post('/log-search', async (req, res) => {
    if (!supabase) return res.status(200).json({ message: 'Analytics disabled.' });

    const startTime = Date.now();
    try {
        const { searchTerm, filtersApplied, resultsCount, sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

        const headers = req.headers;
        const uaString = headers['user-agent'];

        // Esta parte necesita 'ua-parser-js' que no está importado con ES Modules
        // const ua = parser(uaString);

        const eventData = {
            search_term: searchTerm,
            filters_applied: filtersApplied,
            results_count: resultsCount,
            session_id: sessionId,
            interaction_type: 'search',
            status: 'success',
            processing_time_ms: Date.now() - startTime,
            user_agent: uaString,
            // device_type: ua.device.type || 'desktop',
            // os: ua.os.name,
            // browser: ua.browser.name,
            country: headers['x-vercel-ip-country'] || null,
            referrer: headers['referer'] || null,
            geo: {
                city: headers['x-vercel-ip-city'] || null,
                region: headers['x-vercel-ip-country-region'] || null
            }
        };

        await supabase.from('search_events').insert([eventData]);
        return res.status(201).json({ success: true });
    } catch (e) {
        console.error('Log search error:', e.message);
        return res.status(200).json({ success: false });
    }
});

app.post('/log-interaction', async (req, res) => {
    if (!supabase) return res.status(200).json({ message: 'Analytics disabled' });

    const startTime = Date.now();
    try {
        const { interaction_type, session_id, event_details } = req.body;
        if (!interaction_type || !session_id) {
            return res.status(400).json({ error: 'interaction_type and session_id are required' });
        }

        const headers = req.headers;
        const uaString = headers['user-agent'];

        // Esta parte necesita 'ua-parser-js'
        // const ua = parser(uaString);

        const eventData = {
            session_id: session_id,
            interaction_type: interaction_type,
            filters_applied: event_details,
            status: 'success',
            processing_time_ms: Date.now() - startTime,
            user_agent: uaString,
            // device_type: ua.device.type || 'desktop',
            // os: ua.os.name,
            // browser: ua.browser.name,
            country: headers['x-vercel-ip-country'] || null,
            referrer: headers['referer'] || null,
            geo: {
                city: headers['x-vercel-ip-city'] || null,
                region: headers['x-vercel-ip-country-region'] || null
            }
        };

        const { error } = await supabase.from('search_events').insert([eventData]);
        if (error) throw error;

        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Error logging interaction:', error);
        res.status(200).json({ success: false, message: error.message });
    }
});

// Exporta la app para que Vercel la pueda usar
module.exports = app;