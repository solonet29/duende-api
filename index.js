// index.js - VERSIÓN 100% COMPLETA Y DEFINITIVA (CON ENRIQUECIMIENTO)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import uaparser from 'ua-parser-js'; // <-- LIBRERÍA DE PARSEO

// --- CONFIGURACIÓN ---
const { MONGO_URI, GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!MONGO_URI) throw new Error('MONGO_URI no está definida.');
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no está definida.');

const app = express();
const mongoClient = new MongoClient(MONGO_URI);
let db;

const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
if (!supabase) {
    console.warn("Supabase analytics is disabled. Environment variables are not set.");
}

// Conectar a la base de datos una sola vez al inicio
await mongoClient.connect();
db = mongoClient.db("DuendeDB");
console.log("Conectado a MongoDB.");

// --- MIDDLEWARE ---
// --- MIDDLEWARE ---
// Usamos una configuración de CORS final y explícita
app.use(cors({
  origin: [
    'https://buscador.afland.es',
    'https://duende-frontend.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'], // Permitimos los métodos necesarios
  allowedHeaders: ['Content-Type', 'Authorization'] // Permitimos las cabeceras comunes
}));

app.use(express.json());

// --- RUTAS DE LA API ---

// RUTA PRINCIPAL DE BÚSQUEDA DE EVENTOS
app.get('/events', async (req, res) => {
    const { search, artist, city, country, dateFrom, dateTo, timeframe } = req.query;
    
    try {
        const eventsCollection = db.collection("events");
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const filter = {
            date: { $gte: today.toISOString().split('T')[0] }
        };

        if (city) {
            const cityRegex = new RegExp(city, 'i');
            filter.$or = [ { city: cityRegex }, { provincia: cityRegex } ];
        }
        if (country) {
            filter.country = { $regex: new RegExp(`^${country}$`, 'i') };
        }
        if (artist) {
            filter.artist = { $regex: new RegExp(artist, 'i') };
        }
        if (dateFrom) {
            filter.date.$gte = dateFrom;
        }
        if (dateTo) {
            filter.date.$lte = dateTo;
        }
        if (timeframe === 'week' && !dateTo) {
            const nextWeek = new Date(today);
            nextWeek.setDate(today.getDate() + 7);
            filter.date.$lte = nextWeek.toISOString().split('T')[0];
        }
        if (search) {
            const searchTerms = search.split(' ').map(term => `"${term}"`).join(' ');
            filter.$text = { 
                $search: searchTerms,
                $language: 'spanish'
            };
        }
        
        const aggregationPipeline = [
            { $match: filter },
            { $sort: { date: 1, verified: -1, sourceURL: -1 } },
            {
                $group: {
                    _id: { artist: "$artist", date: "$date", time: "$time" },
                    doc: { $first: "$$ROOT" }
                }
            },
            { $replaceRoot: { newRoot: "$doc" } },
            { $sort: { date: 1 } }
        ];
        
        const events = await eventsCollection.aggregate(aggregationPipeline).toArray();
        res.json(events);

    } catch (error) {
        console.error("Error al buscar eventos:", error);
        res.status(500).json({ error: "Error interno del servidor." });
    }
});

// RUTA PARA CONTAR EVENTOS
app.get('/events/count', async (req, res) => {
    try {
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

Usa un tono inspirador y práctico. Sigue envolviendo los nombres de lugares recomendados entre corchetes [Nombre del Lugar].`;
        
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


// --- RUTAS DE ANALÍTICAS (MODIFICADAS CON ENRIQUECIMIENTO) ---

// RUTA PARA REGISTRAR EVENTOS DE BÚSQUEDA
app.post('/log-search', async (req, res) => {
    if (!supabase) return res.status(200).json({ message: 'Analytics disabled.' });
    
    const startTime = Date.now();
    try {
        const { searchTerm, filtersApplied, resultsCount, sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

        // --- INICIO: BLOQUE DE ENRIQUECIMIENTO DE DATOS ---
        const headers = req.headers;
        const uaString = headers['user-agent'];
        const ua = uaparser(uaString);
        
        const eventData = {
            // Datos originales
            search_term: searchTerm,
            filters_applied: filtersApplied,
            results_count: resultsCount,
            session_id: sessionId,
            interaction_type: 'search',
            
            // Nuevos datos enriquecidos
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
        // --- FIN: BLOQUE DE ENRIQUECIMIENTO DE DATOS ---

        await supabase.from('search_events').insert([eventData]);
        
        return res.status(201).json({ success: true });
    } catch (e) {
        console.error('Log search error:', e.message);
        return res.status(200).json({ success: false });
    }
});

// RUTA PARA REGISTRAR CLICS EN BOTONES
app.post('/log-interaction', async (req, res) => {
    if (!supabase) return res.status(200).json({ message: 'Analytics disabled' });

    const startTime = Date.now();
    try {
        const { interaction_type, session_id, event_details } = req.body;
        if (!interaction_type || !session_id) {
            return res.status(400).json({ error: 'interaction_type and session_id are required' });
        }

        // --- INICIO: BLOQUE DE ENRIQUECIMIENTO DE DATOS ---
        const headers = req.headers;
        const uaString = headers['user-agent'];
        const ua = uaparser(uaString);

        const eventData = {
            // Datos originales
            session_id: session_id,
            interaction_type: interaction_type,
            filters_applied: event_details,

            // Nuevos datos enriquecidos
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
        // --- FIN: BLOQUE DE ENRIQUECIMIENTO DE DATOS ---

        const { error } = await supabase.from('search_events').insert([eventData]);

        if (error) throw error;

        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Error logging interaction:', error);
        res.status(200).json({ success: false, message: error.message });
    }
});

// Exporta la app para que Vercel la pueda usar
export default app;