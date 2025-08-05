import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const UAParser = require('ua-parser-js');


// --- CONFIGURACIÓN ---
const { MONGO_URI, GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!MONGO_URI) throw new Error('MONGO_URI no está definida.');
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está definida.');

const app = express();

// --- PATRÓN DE CONEXIÓN A MONGODB PARA SERVERLESS ---
let cachedDb = null;
const mongoClient = new MongoClient(MONGO_URI);

async function connectToDatabase() {
    if (cachedDb) {
        return cachedDb;
    }
    try {
        await mongoClient.connect();
        const db = mongoClient.db("DuendeDB");
        cachedDb = db;
        console.log("Nueva conexión a DuendeDB establecida y cacheada.");
        return db;
    } catch (error) {
        console.error("Error al conectar a MongoDB:", error);
        throw error;
    }
}
// --- FIN DEL PATRÓN DE CONEXIÓN ---

// --- MIDDLEWARE ---
app.use(cors({
  origin: [
    'https://buscador.afland.es',
    'https://duende-frontend.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// --- RUTAS DE LA API ---

// RUTA DE PRUEBA PARA VERIFICAR EL DESPLIEGUE
app.get('/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).json({ 
        version: "17.0-analiticas-off", 
        timestamp: new Date().toISOString() 
    });
});

// RUTA PRINCIPAL DE BÚSQUEDA DE EVENTOS
app.get('/events', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
        const db = await connectToDatabase();
        const eventsCollection = db.collection("events");

        const { search, artist, city, country, dateFrom, dateTo, timeframe } = req.query;
        let aggregationPipeline = [];

        if (search) {
            aggregationPipeline.push({
                $search: {
                    index: 'buscador',
                    text: {
                        query: search,
                        path: {
                            'wildcard': '*'
                        },
                        fuzzy: {
                            "maxEdits": 1
                        }
                    }
                }
            });
        }
        
        const matchFilter = {};
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (!search) {
            matchFilter.date = { $gte: today.toISOString().split('T')[0] };
        }

        if (city) matchFilter.city = { $regex: new RegExp(city, 'i') };
        if (country) matchFilter.country = { $regex: new RegExp(`^${country}$`, 'i') };
        if (artist) matchFilter.artist = { $regex: new RegExp(artist, 'i') };
        if (dateFrom) matchFilter.date.$gte = dateFrom;
        if (dateTo) matchFilter.date.$lte = dateTo;
        if (timeframe === 'week' && !dateTo) {
            const nextWeek = new Date(today);
            nextWeek.setDate(today.getDate() + 7);
            matchFilter.date.$lte = nextWeek.toISOString().split('T')[0];
        }

        aggregationPipeline.push({ $match: matchFilter });
        
        if (!search) {
            aggregationPipeline.push({ $sort: { date: 1 } });
        }
        
        const events = await eventsCollection.aggregate(aggregationPipeline).toArray();
        res.json(events);

    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// RUTA PARA CONTAR EVENTOS
app.get('/events/count', async (req, res) => {
    res.setHeader('Cache-control', 'no-store, max-age=0');
    try {
        const db = await connectToDatabase();
        const eventsCollection = db.collection("events");
        const todayString = new Date().toISOString().split('T')[0];
        const count = await eventsCollection.countDocuments({ date: { $gte: todayString } });
        res.json({ total: count });
    } catch (error) {
        console.error("Error al contar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// RUTA PARA "PLANEAR NOCHE" CON GEMINI
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
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
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

// RUTA PARA EL PLANIFICADOR DE VIAJES
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
        
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
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


// --- RUTAS DE ANALÍTICAS (DESACTIVADAS TEMPORALMENTE) ---
/*
app.post('/log-search', async (req, res) => {
    try {
        if (!supabase) return res.status(200).json({ message: 'Analytics disabled.' });
    
        const startTime = Date.now();
        const { searchTerm, filtersApplied, resultsCount, sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

        const headers = req.headers;
        const uaString = headers['user-agent'];
        const ua = UAParser(uaString);
        
        const eventData = {
            search_term: searchTerm,
            filters_applied: filtersApplied,
            results_count: resultsCount,
            session_id: sessionId,
            interaction_type: 'search',
            status: 'success',
            processing_time_ms: Date.now() - startTime,
            user_agent: uaString,
            device_type: ua.device.type || 'desktop',
            os: ua.os.name,
            browser: ua.browser.name,
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
        console.error('Error no crítico en /log-search:', e.message);
        return res.status(200).json({ success: false, error: 'Log failed silently' });
    }
});

app.post('/log-interaction', async (req, res) => {
    try {
        if (!supabase) return res.status(200).json({ message: 'Analytics disabled' });

        const startTime = Date.now();
        const { interaction_type, session_id, event_details } = req.body;
        if (!interaction_type || !session_id) {
            return res.status(400).json({ error: 'interaction_type and session_id are required' });
        }

        const headers = req.headers;
        const uaString = headers['user-agent'];
        const ua = UAParser(uaString);

        const eventData = {
            session_id: session_id,
            interaction_type: interaction_type,
            filters_applied: event_details,
            status: 'success',
            processing_time_ms: Date.now() - startTime,
            user_agent: uaString,
            device_type: ua.device.type || 'desktop',
            os: ua.os.name,
            browser: ua.browser.name,
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
        console.error('Error no crítico en /log-interaction:', error.message);
        res.status(200).json({ success: false, error: 'Log failed silently' });
    }
});
*/

// Exporta la app para que Vercel la pueda usar
export default app;